import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webDownload', () => ({ WEB_DOWNLOAD_MAX_BYTES: 2 * 1024 ** 3, WEB_DOWNLOAD_MAX_FILES: 2000 }))

import type { OrderExportPlan } from './exportPlan'
import { exportToWebFolder, pickWebExportFolder, webFolderExportSupported, WebFolderExportError } from './exportWebFolder'

/** An in-memory File System Access directory, enough for the export. */
class FakeFile {
  data: string | null = null
  writes = 0
  constructor(readonly name: string) {}
  async createWritable() {
    let pending: string | null = null
    return {
      write: async (d: Blob | string) => {
        pending = typeof d === 'string' ? d : await d.text()
      },
      close: async () => {
        this.data = pending
        this.writes++
      },
      abort: async () => undefined,
    }
  }
}

class FakeDir {
  readonly entries = new Map<string, FakeDir | FakeFile>()
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    const e = this.entries.get(name)
    if (e instanceof FakeDir) return e
    if (e) throw new DOMException('A file', 'TypeMismatchError')
    if (!options?.create) throw new DOMException('Not found', 'NotFoundError')
    const dir = new FakeDir(name)
    this.entries.set(name, dir)
    return dir
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFile> {
    const e = this.entries.get(name)
    if (e instanceof FakeFile) return e
    if (e) throw new DOMException('A folder', 'TypeMismatchError')
    if (!options?.create) throw new DOMException('Not found', 'NotFoundError')
    const file = new FakeFile(name)
    this.entries.set(name, file)
    return file
  }
  async removeEntry(name: string): Promise<void> {
    this.entries.delete(name)
  }
}

function readAt(root: FakeDir, path: string): string | null {
  const parts = path.split('/')
  let dir: FakeDir | undefined = root
  for (const p of parts.slice(0, -1)) {
    const next: FakeDir | FakeFile | undefined = dir?.entries.get(p)
    dir = next instanceof FakeDir ? next : undefined
  }
  const f = dir?.entries.get(parts[parts.length - 1])
  return f instanceof FakeFile ? f.data : null
}

const asHandle = (d: FakeDir) => d as unknown as FileSystemDirectoryHandle

const contents: Record<string, string> = { h1: 'STEP A', h2: 'PDF B' }

function plan(): OrderExportPlan {
  return {
    baseName: 'ORD-0007',
    entries: [
      { zipPath: 'A.step', storageHash: 'h1', fileSize: 6 },
      { zipPath: 'drawings/B.pdf', storageHash: 'h2', fileSize: 5 },
      { zipPath: 'A copy.step', storageHash: 'h1', fileSize: 6 },
    ],
    csv: { name: 'ORD-0007.csv', content: 'line\r\n' },
    json: { name: 'order.json', content: '{}' },
    missing: [{ lineId: 'l2', kinds: ['dxf'] }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('exportToWebFolder', () => {
  it('writes every file into a new subfolder, fetching each content once', async () => {
    const root = new FakeDir('Downloads')
    const fetchVerified = vi.fn(async (hash: string) => new Blob([contents[hash]]))
    const progress = vi.fn()
    const result = await exportToWebFolder(asHandle(root), plan(), { fetchVerified }, progress)
    expect(result).toEqual({ status: 'saved', path: 'Downloads/ORD-0007', files: 3, missing: 1 })
    const folder = root.entries.get('ORD-0007') as FakeDir
    expect(readAt(folder, 'A.step')).toBe('STEP A')
    expect(readAt(folder, 'A copy.step')).toBe('STEP A')
    expect(readAt(folder, 'drawings/B.pdf')).toBe('PDF B')
    expect(readAt(folder, 'ORD-0007.csv')).toBe('line\r\n')
    expect(readAt(folder, 'order.json')).toBe('{}')
    expect(fetchVerified).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalledWith({ phase: 'downloading', completed: 3, total: 3 })
  })

  it('never writes into an existing folder', async () => {
    const root = new FakeDir('Downloads')
    await root.getDirectoryHandle('ORD-0007', { create: true })
    await root.getFileHandle('ORD-0007 (2)', { create: true })
    const result = await exportToWebFolder(asHandle(root), plan(), { fetchVerified: async (h) => new Blob([contents[h]]) })
    expect(result).toMatchObject({ path: 'Downloads/ORD-0007 (3)' })
    expect((root.entries.get('ORD-0007') as FakeDir).entries.size).toBe(0)
  })

  it('removes the new folder when one content does not match', async () => {
    const root = new FakeDir('Downloads')
    const fetchVerified = vi.fn(async (hash: string, name: string) => {
      if (hash === 'h2') throw new WebFolderExportError('HASH_MISMATCH', `${name} does not match`, [name])
      return new Blob([contents[hash]])
    })
    await expect(exportToWebFolder(asHandle(root), plan(), { fetchVerified })).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(root.entries.size).toBe(0)
  })

  it('refuses a content too large to hash in the browser before creating anything', async () => {
    const root = new FakeDir('Downloads')
    const big = plan()
    big.entries[0].fileSize = 3 * 1024 ** 3
    await expect(exportToWebFolder(asHandle(root), big, { fetchVerified: vi.fn() })).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(root.entries.size).toBe(0)
  })
})

describe('the folder picker', () => {
  it('is supported only where the browser has showDirectoryPicker', async () => {
    vi.stubGlobal('window', {})
    expect(webFolderExportSupported()).toBe(false)
    await expect(pickWebExportFolder()).rejects.toMatchObject({ code: 'DESKTOP_ONLY' })
    const picked = new FakeDir('Picked')
    const showDirectoryPicker = vi.fn(async () => picked)
    vi.stubGlobal('window', { showDirectoryPicker })
    expect(webFolderExportSupported()).toBe(true)
    expect(await pickWebExportFolder()).toBe(picked)
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite', id: 'blueplm-order-export' })
  })

  it('answers a cancelled picker with null', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError')
      },
    })
    expect(await pickWebExportFolder()).toBeNull()
  })
})
