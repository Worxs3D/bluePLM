import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'

import {
  extensionInstallDir,
  installPackage,
  readInstalledPackages,
  removeInstalledPackage,
} from './install'

const manifest = {
  id: 'acme.tool',
  name: 'Tool',
  version: '1.0.0',
  publisher: 'acme',
}

async function pack(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'uint8array' })
}

let extensionsPath: string

beforeEach(() => {
  extensionsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bpx-install-'))
})

afterEach(() => {
  fs.rmSync(extensionsPath, { recursive: true, force: true })
})

describe('installPackage', () => {
  it('installs a store package and records its hash', async () => {
    const data = await pack({ 'extension.json': JSON.stringify(manifest), 'client/index.js': '' })
    const pkg = await installPackage(data, {
      extensionsPath,
      source: 'store',
      expectedId: 'acme.tool',
      sha256: 'a'.repeat(64),
    })
    expect(pkg.dir).toBe(path.join(extensionsPath, 'acme-tool'))
    expect(pkg.verification).toBe('community')
    const metadata = JSON.parse(fs.readFileSync(path.join(pkg.dir, '.metadata.json'), 'utf-8'))
    expect(metadata.sha256).toBe('a'.repeat(64))
    expect(fs.existsSync(path.join(pkg.dir, '.sideloaded'))).toBe(false)
  })

  it('marks a file install as sideloaded', async () => {
    const data = await pack({ 'extension.json': JSON.stringify(manifest) })
    const pkg = await installPackage(data, { extensionsPath, source: 'file' })
    expect(pkg.verification).toBe('sideloaded')
    expect(fs.existsSync(path.join(pkg.dir, '.sideloaded'))).toBe(true)
  })

  it('refuses a manifest id that would escape the extensions directory, before any write', async () => {
    const data = await pack({
      'extension.json': JSON.stringify({ ...manifest, id: '../../outside' }),
    })
    await expect(installPackage(data, { extensionsPath, source: 'file' })).rejects.toThrow(
      /Invalid manifest: id/,
    )
    expect(fs.readdirSync(extensionsPath)).toEqual([])
  })

  it('refuses a package whose id is not the one requested', async () => {
    const data = await pack({ 'extension.json': JSON.stringify(manifest) })
    await expect(
      installPackage(data, { extensionsPath, source: 'store', expectedId: 'acme.other' }),
    ).rejects.toThrow(/does not match/)
  })

  it('refuses native extensions on every per-machine path', async () => {
    const data = await pack({
      'extension.json': JSON.stringify({ ...manifest, category: 'native' }),
    })
    await expect(installPackage(data, { extensionsPath, source: 'store' })).rejects.toThrow(
      /Native extensions/,
    )
    await expect(installPackage(data, { extensionsPath, source: 'file' })).rejects.toThrow(
      /Native extensions/,
    )
  })

  it('keeps the installed version when an update package is unsafe', async () => {
    await installPackage(await pack({ 'extension.json': JSON.stringify(manifest) }), {
      extensionsPath,
      source: 'file',
    })
    const bad = await pack({
      'extension.json': JSON.stringify({ ...manifest, version: '2.0.0' }),
      '../../evil.js': 'pwned',
    })
    await expect(installPackage(bad, { extensionsPath, source: 'file' })).rejects.toThrow()
    const [pkg] = readInstalledPackages(extensionsPath)
    expect(pkg.manifest.version).toBe('1.0.0')
  })
})

describe('removeInstalledPackage', () => {
  it('deletes the folder of an installed extension', async () => {
    await installPackage(await pack({ 'extension.json': JSON.stringify(manifest) }), {
      extensionsPath,
      source: 'file',
    })
    expect(removeInstalledPackage(extensionsPath, 'acme.tool')).toBe(true)
    expect(fs.existsSync(path.join(extensionsPath, 'acme-tool'))).toBe(false)
    expect(removeInstalledPackage(extensionsPath, 'acme.tool')).toBe(false)
  })

  it.each(['..', '../x.y', 'a.b/../..', ''])('refuses id %j without touching disk', (id) => {
    expect(() => removeInstalledPackage(extensionsPath, id)).toThrow(/Invalid extension id/)
  })

  it('keeps install folders inside the extensions directory', () => {
    expect(path.dirname(extensionInstallDir(extensionsPath, 'acme.tool'))).toBe(
      path.resolve(extensionsPath),
    )
  })
})

describe('readInstalledPackages', () => {
  it('skips staging folders and folders that do not match their manifest id', () => {
    const write = (folder: string, content: object) => {
      fs.mkdirSync(path.join(extensionsPath, folder), { recursive: true })
      fs.writeFileSync(path.join(extensionsPath, folder, 'extension.json'), JSON.stringify(content))
    }
    write('acme-tool', manifest)
    write('.acme-tool.staging-123', manifest)
    write('renamed', manifest)
    write('acme-bad', { ...manifest, id: 'Bad Id' })

    const skipped: string[] = []
    const found = readInstalledPackages(extensionsPath, (folder) => skipped.push(folder))
    expect(found.map((p) => p.manifest.id)).toEqual(['acme.tool'])
    expect(skipped.sort()).toEqual(['acme-bad', 'renamed'])
  })

  it('never trusts a "verified" claim written on disk', () => {
    fs.mkdirSync(path.join(extensionsPath, 'acme-tool'))
    fs.writeFileSync(path.join(extensionsPath, 'acme-tool', 'extension.json'), JSON.stringify(manifest))
    fs.writeFileSync(
      path.join(extensionsPath, 'acme-tool', '.metadata.json'),
      JSON.stringify({ verification: 'verified' }),
    )
    expect(readInstalledPackages(extensionsPath)[0].verification).toBe('community')
  })
})
