/**
 * The `orders:export` handler end to end (5.13.0, gap 4): a real local HTTP server serves the
 * fixture bytes in chunks, the handler writes a real zip (yazl, streamed) or folder into a temp
 * dir, and the zip is reopened and every entry's bytes hashed against its fixture. Covers the
 * prefetch path (small files), the streaming path (files over `ZIP_PREFETCH_MAX_BYTES`), a size
 * recorded too small, ZIP64 entries, a hash mismatch, an oversize stream, a cut connection and a
 * missing file; a failed export leaves nothing behind.
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import os from 'os'
import path from 'path'

import type { IpcMainInvokeEvent } from 'electron'
import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}))

const { dialog } = await import('electron')
const { exportToFolder, exportToZip, handleOrderExport, ZIP_PREFETCH_MAX_BYTES } = await import('./orders')

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const CHUNK = 64 * 1024

interface Fixture {
  path: string
  url: string
  body: Buffer
  /** The size the request declares (the recorded one, which can be wrong). */
  size: number
}

const bodies = new Map<string, Buffer>()
let server: http.Server
let base = ''
let dir = ''
/** Requests the server has answered, by URL path. */
const served: string[] = []

function fixture(filePath: string, key: string, body: Buffer, size = body.length): Fixture {
  bodies.set(`/${key}`, body)
  return { path: filePath, url: `${base}/${key}`, body, size }
}

function exportRequest(mode: 'zip' | 'folder', files: Fixture[], hashOf: (f: Fixture) => string = (f) => sha(f.body)) {
  return {
    mode,
    name: 'ORD-0042',
    files: files.map((f) => ({ path: f.path, url: f.url, sha256: hashOf(f), size: f.size })),
    texts: [
      { path: 'ORD-0042.csv', content: 'position,file\r\n1,A\r\n' },
      { path: 'order.json', content: '{"format":"blueplm-order/1"}' },
    ],
  }
}

function event(): IpcMainInvokeEvent & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    sent,
    sender: { isDestroyed: () => false, send: (_channel: string, payload: unknown) => sent.push(payload) },
  } as unknown as IpcMainInvokeEvent & { sent: unknown[] }
}

async function zipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
  const out = new Map<string, Buffer>()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out.set(name, await entry.async('nodebuffer'))
  }
  return out
}

function listTree(root: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? ''
    served.push(url)
    if (url === '/cut') {
      // Some bytes, then the connection drops.
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.write(Buffer.alloc(CHUNK, 1), () => setTimeout(() => res.destroy(), 10))
      return
    }
    const body = bodies.get(url)
    if (!body) {
      res.statusCode = 404
      res.end()
      return
    }
    // Chunked, with a turn of the event loop between chunks, like a real transfer.
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    let offset = 0
    const pump = () => {
      while (offset < body.length) {
        const chunk = body.subarray(offset, offset + CHUNK)
        offset += chunk.length
        if (!res.write(chunk)) {
          res.once('drain', () => setImmediate(pump))
          return
        }
      }
      res.end()
    }
    pump()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'orders-export-it-'))
})

afterAll(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.promises.rm(dir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.mocked(dialog.showSaveDialog).mockReset()
  vi.mocked(dialog.showOpenDialog).mockReset()
})

function orderFixtures(): Fixture[] {
  const small = Array.from({ length: 12 }, (_, i) =>
    fixture(`parts/P-${String(i).padStart(3, '0')}.step`, `small-${i}`, crypto.randomBytes(1 + i * 4099)),
  )
  const big = crypto.randomBytes(ZIP_PREFETCH_MAX_BYTES + 3 * CHUNK + 17)
  const shared = crypto.randomBytes(5000)
  return [
    fixture('Top Assembly.step', 'big', big),
    ...small,
    // Recorded as 100 bytes, really over the prefetch limit: it must stream in its turn.
    fixture('Bracket.stl', 'understated', crypto.randomBytes(ZIP_PREFETCH_MAX_BYTES + 1), 100),
    // One content at two paths.
    fixture('drawings/Bracket.pdf', 'shared', shared),
    fixture('drawings/Bracket copy.pdf', 'shared', shared),
    fixture('empty.dxf', 'empty', Buffer.alloc(0)),
  ]
}

describe('orders:export handler, zip', () => {
  it('writes a zip whose every entry hashes to its fixture', async () => {
    const files = orderFixtures()
    const zipPath = path.join(dir, 'picked.zip')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: zipPath })
    const ev = event()

    const result = await handleOrderExport(ev, exportRequest('zip', files))

    expect(result).toMatchObject({ success: true, path: zipPath, files: files.length })
    if (!result.success) throw new Error('export failed')
    expect(result.bytes).toBe(files.reduce((sum, f) => sum + f.body.length, 0))
    const entries = await zipEntries(zipPath)
    expect([...entries.keys()].sort()).toEqual([...files.map((f) => f.path), 'ORD-0042.csv', 'order.json'].sort())
    for (const f of files) expect(sha(entries.get(f.path)!), f.path).toBe(sha(f.body))
    expect(entries.get('ORD-0042.csv')!.toString('utf8')).toBe('position,file\r\n1,A\r\n')
    expect(entries.get('order.json')!.toString('utf8')).toBe('{"format":"blueplm-order/1"}')
    // Entries are stored, in the order given.
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).slice(0, 2)).toEqual(['Top Assembly.step', 'parts/P-000.step'])
    expect(ev.sent).toContainEqual({ phase: 'downloading', completed: files.length, total: files.length })
    expect(ev.sent).toContainEqual({ phase: 'writing', completed: 1, total: 1 })
    expect(fs.readdirSync(dir).filter((n) => n.includes('.partial-'))).toEqual([])
  })

  it('writes ZIP64 entries a reader takes', async () => {
    // Small files only: random bytes of a large one could hold the field's bytes by chance.
    const files = orderFixtures().slice(1, 7)
    const zipPath = path.join(dir, 'zip64.zip')
    await exportToZip(exportRequest('zip', files), zipPath, () => undefined, { forceZip64: true })
    const raw = fs.readFileSync(zipPath)
    // The ZIP64 extended information extra field (tag 0x0001, 24 bytes of sizes and offset).
    expect(raw.includes(Buffer.from([0x01, 0x00, 0x18, 0x00]))).toBe(true)
    const entries = await zipEntries(zipPath)
    for (const f of files) expect(sha(entries.get(f.path)!), f.path).toBe(sha(f.body))
  })

  it('refuses the whole zip when one file does not match, and leaves nothing', async () => {
    const files = orderFixtures()
    const parent = await fs.promises.mkdtemp(path.join(dir, 'mismatch-'))
    const zipPath = path.join(parent, 'ORD-0042.zip')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: zipPath })
    // A small (prefetched) file late in the order is not the content it names.
    const wrong = files[8]

    const result = await handleOrderExport(event(), exportRequest('zip', files, (f) => (f === wrong ? 'b'.repeat(64) : sha(f.body))))

    expect(result).toMatchObject({ success: false, code: 'HASH_MISMATCH' })
    if (result.success || result.canceled) throw new Error('expected a failure')
    expect(result.error).toContain(wrong.path)
    expect(fs.readdirSync(parent)).toEqual([])
  })

  it('refuses a mismatch of a streamed file too', async () => {
    const files = orderFixtures()
    const parent = await fs.promises.mkdtemp(path.join(dir, 'mismatch-big-'))
    await expect(
      exportToZip(exportRequest('zip', files, (f) => (f.path === 'Top Assembly.step' ? 'c'.repeat(64) : sha(f.body))), path.join(parent, 'o.zip'), () => undefined),
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(fs.readdirSync(parent)).toEqual([])
  })

  it('stops an oversize stream as TOO_LARGE, whatever size was declared', async () => {
    const big = fixture('Huge.step', 'huge', crypto.randomBytes(3 * 1024 * 1024), 10)
    const parent = await fs.promises.mkdtemp(path.join(dir, 'oversize-'))
    await expect(
      exportToZip(exportRequest('zip', [big]), path.join(parent, 'o.zip'), () => undefined, { maxBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(fs.readdirSync(parent)).toEqual([])
    await expect(exportToFolder({ ...exportRequest('folder', [big]) }, parent, () => undefined, 1024 * 1024)).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
    expect(fs.readdirSync(parent)).toEqual([])
  })

  it('fails a cut connection or a missing file as DOWNLOAD_FAILED', async () => {
    const ok = fixture('A.step', 'ok-a', crypto.randomBytes(1000))
    const parent = await fs.promises.mkdtemp(path.join(dir, 'cut-'))
    const cut = { path: 'Cut.step', url: `${base}/cut`, body: Buffer.alloc(0), size: CHUNK * 4 }
    await expect(
      exportToZip(exportRequest('zip', [cut, ok], (f) => (f === cut ? 'd'.repeat(64) : sha(f.body))), path.join(parent, 'o.zip'), () => undefined),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    const gone = { path: 'Gone.step', url: `${base}/nothing-here`, body: Buffer.alloc(0), size: 1 }
    await expect(
      exportToZip(exportRequest('zip', [ok, gone], (f) => (f === gone ? 'e'.repeat(64) : sha(f.body))), path.join(parent, 'p.zip'), () => undefined),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(fs.readdirSync(parent)).toEqual([])
  })

  it('answers a cancelled dialog without downloading', async () => {
    const files = [fixture('A.step', 'cancel-a', crypto.randomBytes(10))]
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    const before = served.length
    expect(await handleOrderExport(event(), exportRequest('zip', files))).toEqual({ success: false, canceled: true })
    expect(served.length).toBe(before)
  })
})

describe('orders:export handler, folder', () => {
  it('writes a new folder whose every file hashes to its fixture', async () => {
    const files = orderFixtures()
    const parent = await fs.promises.mkdtemp(path.join(dir, 'folder-'))
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [parent] })

    const first = await handleOrderExport(event(), exportRequest('folder', files))
    const second = await handleOrderExport(event(), exportRequest('folder', files))

    expect(first).toMatchObject({ success: true, path: path.join(parent, 'ORD-0042') })
    expect(second).toMatchObject({ success: true, path: path.join(parent, 'ORD-0042 (2)') })
    const root = path.join(parent, 'ORD-0042')
    expect(listTree(root)).toEqual([...files.map((f) => f.path), 'ORD-0042.csv', 'order.json'].sort())
    for (const f of files) expect(sha(fs.readFileSync(path.join(root, ...f.path.split('/')))), f.path).toBe(sha(f.body))
  })

  it('leaves no folder behind when one file does not match', async () => {
    const files = orderFixtures()
    const parent = await fs.promises.mkdtemp(path.join(dir, 'folder-bad-'))
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [parent] })
    const result = await handleOrderExport(
      event(),
      exportRequest('folder', files, (f) => (f.path === 'Bracket.stl' ? 'f'.repeat(64) : sha(f.body))),
    )
    expect(result).toMatchObject({ success: false, code: 'HASH_MISMATCH' })
    expect(fs.readdirSync(parent)).toEqual([])
  })
})
