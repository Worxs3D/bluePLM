import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'

import {
  inspectNativePackage,
  prepareNativePackage,
  pruneNativeCache,
  resolveNativeAsset,
  satisfiesEngineRange,
} from './nativeCache'
import { sha256Hex } from './integrity'

const manifest = {
  id: 'acme.tool',
  name: 'Tool',
  version: '1.0.0',
  publisher: 'acme',
  category: 'native',
  main: 'client/index.js',
  serverMain: 'server/index.js',
  engines: { blueplm: '^4.7.0' },
  contributes: {
    permissions: [{ resource: 'module:tool', label: 'Tool', actions: ['view', 'admin'] }],
  },
}

async function pack(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'uint8array' })
}

const fixtureFiles = {
  'extension.json': JSON.stringify(manifest),
  'client/index.js': 'export function activate() {}',
  'client/app.css': 'body{}',
  'server/index.js': 'export function register() {}',
  'sql/02-b.sql': 'select 2;',
  'sql/01-a.sql': 'select 1;',
}

let cacheDir: string

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpx-native-'))
})

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true })
})

describe('prepareNativePackage', () => {
  it('downloads, verifies, extracts and returns the client entry URL', async () => {
    const data = await pack(fixtureFiles)
    const sha = sha256Hex(data)
    const download = vi.fn(async () => data)
    const prepared = await prepareNativePackage(
      cacheDir,
      { extensionId: 'acme.tool', version: '1.0.0', sha256: sha },
      download,
    )
    expect(prepared.clientEntryUrl).toBe(`blueplm-ext://${sha}/client/index.js`)
    expect(prepared.cached).toBe(false)
    expect(fs.readFileSync(path.join(cacheDir, sha, 'client', 'index.js'), 'utf-8')).toContain(
      'activate',
    )
    expect(fs.existsSync(path.join(cacheDir, `${sha}.bpx`))).toBe(true)

    // Second prepare reuses the cache without downloading.
    const again = await prepareNativePackage(
      cacheDir,
      { extensionId: 'acme.tool', version: '1.0.0', sha256: sha },
      download,
    )
    expect(again.cached).toBe(true)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('refuses a download that does not match the recorded SHA-256 and writes nothing', async () => {
    const data = await pack(fixtureFiles)
    await expect(
      prepareNativePackage(
        cacheDir,
        { extensionId: 'acme.tool', version: '1.0.0', sha256: 'f'.repeat(64) },
        async () => data,
      ),
    ).rejects.toThrow(/does not match the SHA-256/)
    expect(fs.readdirSync(cacheDir)).toEqual([])
  })

  it('discards a cached package that no longer matches and downloads again', async () => {
    const data = await pack(fixtureFiles)
    const sha = sha256Hex(data)
    fs.writeFileSync(path.join(cacheDir, `${sha}.bpx`), 'tampered')
    const download = vi.fn(async () => data)
    const prepared = await prepareNativePackage(
      cacheDir,
      { extensionId: 'acme.tool', version: '1.0.0', sha256: sha },
      download,
    )
    expect(download).toHaveBeenCalledTimes(1)
    expect(prepared.cached).toBe(false)
  })

  it('refuses a package whose manifest is not the installed row', async () => {
    const data = await pack(fixtureFiles)
    const sha = sha256Hex(data)
    await expect(
      prepareNativePackage(
        cacheDir,
        { extensionId: 'acme.other', version: '1.0.0', sha256: sha },
        async () => data,
      ),
    ).rejects.toThrow(/does not match the installed extension/)
  })

  it('refuses a sandboxed package', async () => {
    const data = await pack({
      ...fixtureFiles,
      'extension.json': JSON.stringify({ ...manifest, category: 'sandboxed' }),
    })
    await expect(
      prepareNativePackage(
        cacheDir,
        { extensionId: 'acme.tool', version: '1.0.0', sha256: sha256Hex(data) },
        async () => data,
      ),
    ).rejects.toThrow(/not a native extension/)
  })

  it('refuses a zip-slip package even when its hash matches', async () => {
    const data = await pack({ ...fixtureFiles, '../../evil.js': 'pwned' })
    await expect(
      prepareNativePackage(
        cacheDir,
        { extensionId: 'acme.tool', version: '1.0.0', sha256: sha256Hex(data) },
        async () => data,
      ),
    ).rejects.toThrow()
    expect(fs.existsSync(path.join(path.dirname(cacheDir), 'evil.js'))).toBe(false)
  })

  it.each([
    [{ extensionId: '../x', version: '1.0.0', sha256: 'a'.repeat(64) }, /Invalid extension id/],
    [{ extensionId: 'acme.tool', version: 'latest', sha256: 'a'.repeat(64) }, /version/],
    [{ extensionId: 'acme.tool', version: '1.0.0', sha256: 'nope' }, /SHA-256/],
  ])('validates the request %#', async (request, message) => {
    await expect(prepareNativePackage(cacheDir, request, async () => new Uint8Array())).rejects.toThrow(
      message,
    )
  })
})

describe('pruneNativeCache', () => {
  it('removes only hash-named entries that are not kept', () => {
    const keep = 'a'.repeat(64)
    const drop = 'b'.repeat(64)
    fs.mkdirSync(path.join(cacheDir, keep))
    fs.writeFileSync(path.join(cacheDir, `${keep}.bpx`), '')
    fs.mkdirSync(path.join(cacheDir, drop))
    fs.writeFileSync(path.join(cacheDir, `${drop}.bpx`), '')
    fs.mkdirSync(path.join(cacheDir, `.${drop}.staging-123`))
    fs.writeFileSync(path.join(cacheDir, 'unrelated.txt'), '')

    expect(pruneNativeCache(cacheDir, [keep])).toEqual([drop])
    expect(fs.readdirSync(cacheDir).sort()).toEqual([keep, `${keep}.bpx`, 'unrelated.txt'].sort())
  })
})

describe('resolveNativeAsset', () => {
  const sha = 'c'.repeat(64)
  let root: string

  beforeEach(() => {
    root = path.join(cacheDir, sha)
    fs.mkdirSync(path.join(root, 'client'), { recursive: true })
    fs.writeFileSync(path.join(root, 'client', 'index.js'), '')
    fs.writeFileSync(path.join(root, 'client', 'app.css'), '')
    fs.writeFileSync(path.join(root, 'icon.png'), '')
    fs.writeFileSync(path.join(root, '.blueplm-verified'), sha)
    fs.writeFileSync(path.join(cacheDir, 'secret.txt'), 'outside')
  })

  const verified = () => new Set([sha])

  it.each([
    ['client/index.js', 'text/javascript; charset=utf-8'],
    ['client/app.css', 'text/css; charset=utf-8'],
    ['icon.png', 'image/png'],
  ])('serves %s as %s', (file, mime) => {
    const result = resolveNativeAsset(cacheDir, verified(), `blueplm-ext://${sha}/${file}`)
    expect(result).toEqual({ ok: true, filePath: path.join(root, ...file.split('/')), mimeType: mime })
  })

  it('refuses a hash that was not prepared this session', () => {
    expect(resolveNativeAsset(cacheDir, new Set(), `blueplm-ext://${sha}/client/index.js`)).toEqual({
      ok: false,
      status: 403,
    })
  })

  it.each([
    `blueplm-ext://${sha}/..%2Fsecret.txt`,
    `blueplm-ext://${sha}/client/..%2F..%2Fsecret.txt`,
    `blueplm-ext://${sha}/%2E%2E/secret.txt`,
    `blueplm-ext://${sha}/C:%5Cwindows%5Cwin.ini`,
  ])('refuses an escape: %s', (url) => {
    const result = resolveNativeAsset(cacheDir, verified(), url)
    expect(result.ok).toBe(false)
  })

  it.each([
    [`blueplm-ext://not-a-sha/client/index.js`, 400],
    [`https://${sha}/client/index.js`, 400],
    [`blueplm-ext://${sha}/`, 404],
    [`blueplm-ext://${sha}/.blueplm-verified`, 404],
    [`blueplm-ext://${sha}/client`, 404],
    [`blueplm-ext://${sha}/missing.js`, 404],
  ])('answers %s with %i', (url, status) => {
    expect(resolveNativeAsset(cacheDir, verified(), url)).toEqual({ ok: false, status })
  })
})

describe('satisfiesEngineRange', () => {
  it.each([
    ['^4.8.0', '4.8.0', true],
    ['^4.8.0', '4.9.2', true],
    ['^4.8.0', '4.7.5', false],
    ['^4.8.0', '5.0.0', false],
    ['~4.8.0', '4.8.3', true],
    ['~4.8.0', '4.9.0', false],
    ['>=4.0.0', '4.7.5', true],
    ['>=4.0.0 <5.0.0', '5.1.0', false],
    ['4.7.5', '4.7.5', true],
    ['*', '1.0.0', true],
    ['^0.2.0', '0.3.0', false],
    ['garbage', '1.0.0', false],
  ])('%s vs %s → %s', (range, version, expected) => {
    expect(satisfiesEngineRange(range, version)).toBe(expected)
  })
})

describe('inspectNativePackage', () => {
  it('returns the manifest, hash and SQL files in order', async () => {
    const data = await pack(fixtureFiles)
    const inspected = await inspectNativePackage(data, '4.7.5')
    expect(inspected.sha256).toBe(sha256Hex(data))
    expect(inspected.manifest.id).toBe('acme.tool')
    expect(inspected.sqlFiles.map((f) => f.name)).toEqual(['sql/01-a.sql', 'sql/02-b.sql'])
  })

  it.each([
    [{ ...manifest, category: undefined }, /not a native extension/],
    [{ ...manifest, engines: { blueplm: '^9.0.0' } }, /requires BluePLM/],
    [{ ...manifest, main: undefined }, /no "main"/],
    [
      { ...manifest, contributes: { permissions: [{ resource: 'bad', label: 'x', actions: [] }] } },
      /contributes\.permissions/,
    ],
  ])('refuses a bad manifest %#', async (bad, message) => {
    const data = await pack({ ...fixtureFiles, 'extension.json': JSON.stringify(bad) })
    await expect(inspectNativePackage(data, '4.7.5')).rejects.toThrow(message)
  })

  it('refuses a package missing its entries', async () => {
    const { 'client/index.js': _drop, ...rest } = fixtureFiles
    await expect(inspectNativePackage(await pack(rest), '4.7.5')).rejects.toThrow(/client entry/)
  })
})
