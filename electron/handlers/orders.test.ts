import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'

import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}))

const {
  allowedDownloadUrl,
  downloadToFile,
  exportToFolder,
  exportToZip,
  safeExportName,
  safeExportPath,
  validateExportRequest,
  zipTargetFor,
} = await import('./orders')

const HASH = 'a'.repeat(64)
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')

describe('safeExportPath', () => {
  it('keeps plain relative paths', () => {
    expect(safeExportPath('BR-1_RevA.step')).toBe('BR-1_RevA.step')
    expect(safeExportPath('drawings/BR-1 (2).pdf')).toBe('drawings/BR-1 (2).pdf')
  })

  it('refuses traversal, absolute paths, drive letters and backslashes', () => {
    for (const bad of ['../x.pdf', 'a/../../x.pdf', '/etc/x', 'C:/x.pdf', 'C:x.pdf', 'a\\b.pdf', './x.pdf', 'a//b.pdf', '']) {
      expect(safeExportPath(bad), bad).toBeNull()
    }
  })

  it('refuses names Windows refuses', () => {
    for (const bad of ['con', 'NUL.txt', 'com1.step', 'a?.pdf', 'a:b.pdf', 'trailing.', 'trailing ', 'tab\there', 'x'.repeat(300)]) {
      expect(safeExportPath(bad), bad).toBeNull()
    }
    expect(safeExportPath(42)).toBeNull()
  })
})

describe('safeExportName / allowedDownloadUrl', () => {
  it('cleans the base name', () => {
    expect(safeExportName('ORD-0001')).toBe('ORD-0001')
    expect(safeExportName('../ORD:1.')).toBe('_ORD_1')
    expect(safeExportName('')).toBe('order')
    expect(safeExportName('con')).toBe('order')
  })

  it('takes https, and plain http only to this machine', () => {
    expect(allowedDownloadUrl('https://x.supabase.co/storage/v1/object/sign/a?token=t')).toBe(true)
    expect(allowedDownloadUrl('http://127.0.0.1:54321/storage/v1/object/a')).toBe(true)
    expect(allowedDownloadUrl('http://example.com/a')).toBe(false)
    expect(allowedDownloadUrl('file:///C:/Windows/win.ini')).toBe(false)
    expect(allowedDownloadUrl('https://user:pw@x.co/a')).toBe(false)
    expect(allowedDownloadUrl('not a url')).toBe(false)
  })
})

describe('validateExportRequest', () => {
  const file = (p: string, extra: Record<string, unknown> = {}) => ({ path: p, url: 'https://x.co/a', sha256: HASH, size: 1, ...extra })

  it('accepts a valid request and lower-cases hashes', () => {
    const request = validateExportRequest({
      mode: 'zip',
      name: 'ORD-1',
      files: [file('a.step', { sha256: HASH.toUpperCase() })],
      texts: [{ path: 'ORD-1.csv', content: 'x' }],
    })
    expect(request.files[0].sha256).toBe(HASH)
    expect(request.name).toBe('ORD-1')
  })

  it('refuses two files at one path, in any case', () => {
    expect(() =>
      validateExportRequest({ mode: 'zip', name: 'o', files: [file('A.step'), file('a.STEP')], texts: [] }),
    ).toThrow(/Two files/)
  })

  it('refuses a bad path, URL, hash, size or mode', () => {
    const cases: unknown[] = [
      { mode: 'zip', name: 'o', files: [file('../a.step')], texts: [] },
      { mode: 'zip', name: 'o', files: [file('a.step', { url: 'http://evil.example/a' })], texts: [] },
      { mode: 'zip', name: 'o', files: [file('a.step', { sha256: 'abc' })], texts: [] },
      { mode: 'zip', name: 'o', files: [file('a.step', { size: -1 })], texts: [] },
      { mode: 'tar', name: 'o', files: [file('a.step')], texts: [] },
      { mode: 'zip', name: 'o', files: [], texts: [] },
      null,
    ]
    for (const c of cases) expect(() => validateExportRequest(c)).toThrow()
  })

  it('takes a zip past 4 GiB (ZIP64) and refuses either mode past the export limit', () => {
    const big = Array.from({ length: 3 }, (_, i) => file(`f${i}.step`, { size: 2 * 1024 ** 3 }))
    expect(validateExportRequest({ mode: 'zip', name: 'o', files: big, texts: [] }).files).toHaveLength(3)
    const huge = Array.from({ length: 26 }, (_, i) => file(`f${i}.step`, { size: 2 * 1024 ** 3 }))
    expect(() => validateExportRequest({ mode: 'zip', name: 'o', files: huge, texts: [] })).toThrow(/larger/)
    expect(() => validateExportRequest({ mode: 'folder', name: 'o', files: huge, texts: [] })).toThrow(/larger/)
  })
})

describe('exports', () => {
  const bodies: Record<string, Buffer> = {
    '/a': Buffer.from('STEP bytes A'),
    '/b': Buffer.from('PDF bytes B'),
  }
  let server: http.Server
  let base = ''
  let dir = ''

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const body = bodies[req.url ?? '']
      if (!body) {
        res.statusCode = 404
        res.end()
        return
      }
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'orders-export-test-'))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  const request = (mode: 'zip' | 'folder', hashB = sha(bodies['/b'])) => ({
    mode,
    name: 'ORD-0001',
    files: [
      { path: 'A.step', url: `${base}/a`, sha256: sha(bodies['/a']), size: 12 },
      { path: 'B.pdf', url: `${base}/b`, sha256: hashB, size: 11 },
    ],
    texts: [{ path: 'ORD-0001.csv', content: 'line\r\n1\r\n' }],
  })

  it('downloads and verifies a file, removing it on a mismatch', async () => {
    const target = path.join(dir, 'one.bin')
    expect(await downloadToFile(`${base}/a`, target, sha(bodies['/a']), 1024)).toBe(12)
    const wrong = path.join(dir, 'wrong.bin')
    await expect(downloadToFile(`${base}/a`, wrong, HASH, 1024)).rejects.toThrow(/does not match/)
    expect(fs.existsSync(wrong)).toBe(false)
    await expect(downloadToFile(`${base}/a`, path.join(dir, 'big.bin'), sha(bodies['/a']), 4)).rejects.toThrow(/larger/)
  })

  it('writes a folder, in a new subfolder each time', async () => {
    const progress = vi.fn()
    const first = await exportToFolder(request('folder'), dir, progress)
    const second = await exportToFolder(request('folder'), dir, progress)
    expect(path.basename(first.path)).toBe('ORD-0001')
    expect(path.basename(second.path)).toBe('ORD-0001 (2)')
    expect(fs.readFileSync(path.join(first.path, 'B.pdf'), 'utf8')).toBe('PDF bytes B')
    expect(fs.readFileSync(path.join(first.path, 'ORD-0001.csv'), 'utf8')).toBe('line\r\n1\r\n')
    expect(progress).toHaveBeenCalledWith({ phase: 'downloading', completed: 2, total: 2 })
  })

  it('leaves no folder behind when one file does not match', async () => {
    const parent = await fs.promises.mkdtemp(path.join(dir, 'p-'))
    await expect(exportToFolder(request('folder', HASH), parent, () => undefined)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    })
    expect(fs.readdirSync(parent)).toEqual([])
  })

  it('streams a zip with every file and text', async () => {
    const zipPath = path.join(dir, 'ORD-0001.zip')
    const done = await exportToZip(request('zip'), zipPath, () => undefined)
    expect(done.bytes).toBe(23)
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
    expect(Object.keys(zip.files).sort()).toEqual(['A.step', 'B.pdf', 'ORD-0001.csv'])
    expect(await zip.file('A.step')!.async('string')).toBe('STEP bytes A')
    expect(await zip.file('ORD-0001.csv')!.async('string')).toBe('line\r\n1\r\n')
  })

  it('refuses a zip whose real bytes pass the limit, whatever sizes were declared', async () => {
    const zipPath = path.join(dir, 'big.zip')
    // Declared sizes say 1 byte each; the downloads are 12 and 11.
    const lying = { ...request('zip'), files: request('zip').files.map((f) => ({ ...f, size: 1 })) }
    await expect(exportToZip(lying, zipPath, () => undefined, { maxBytes: 15 })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    // The files fit, the CSV pushes it over.
    await expect(exportToZip(request('zip'), zipPath, () => undefined, { maxBytes: 25 })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('big.zip'))).toEqual([])
  })

  it('adds .zip without overwriting a file the dialog never asked about', async () => {
    const chosen = path.join(dir, 'Picked')
    expect(await zipTargetFor(`${chosen}.ZIP`)).toBe(`${chosen}.ZIP`)
    expect(await zipTargetFor(chosen)).toBe(`${chosen}.zip`)
    fs.writeFileSync(`${chosen}.zip`, 'keep me')
    expect(await zipTargetFor(chosen)).toBe(`${chosen} (2).zip`)
    expect(fs.readFileSync(`${chosen}.zip`, 'utf8')).toBe('keep me')
  })

  it('writes no zip when one file does not match', async () => {
    const zipPath = path.join(dir, 'bad.zip')
    await expect(exportToZip(request('zip', HASH), zipPath, () => undefined)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    })
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('bad.zip'))).toEqual([])
  })
})
