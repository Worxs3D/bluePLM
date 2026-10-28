import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Cost of the real-disk vault paths, measured in filesystem calls rather than time: a scan
// is one pass, a hash is read once and a valid hash stamp is never re-read. The vault is
// ~2,000 small generated files in a real temp directory. The one wall-clock ceiling carries
// a margin of well over 10x over what the scan takes on a CI runner.

const { ipcHandlers } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    },
    on: () => {},
    removeHandler: () => {},
    removeListener: () => {},
  },
  shell: { trashItem: async () => {} },
  dialog: {},
  nativeImage: { createFromDataURL: () => ({}) },
  BrowserWindow: class {},
}))

vi.mock('./solidworks', () => ({
  findLockingProcessViaService: async () => null,
}))

vi.mock('./fsWatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fsWatcher')>()
  return { ...actual, createVaultWatcher: () => ({ close: async () => {} }) }
})

import { clearHashCache, registerFsHandlers } from './fs'

interface ScanEntry {
  path: string
  relativePath: string
  isDirectory: boolean
  size: number
  modifiedTime: string
  hash?: string
}

const FOLDERS = 40
const FILES_PER_FOLDER = 50
const FILE_COUNT = FOLDERS * FILES_PER_FOLDER

let vault: string

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`${channel} was never registered`)
  const event = { sender: { isDestroyed: () => false, send: () => {} } }
  return Promise.resolve(handler(event, ...args) as T)
}

async function scan(): Promise<ScanEntry[]> {
  const result = await invoke<{ files: ScanEntry[] }>('fs:list-working-files')
  return result.files
}

function hashRequest(files: ScanEntry[]) {
  return files
    .filter((file) => !file.isDirectory)
    .map((file) => ({
      path: file.path,
      relativePath: file.relativePath,
      size: file.size,
      mtime: new Date(file.modifiedTime).getTime(),
    }))
}

/** Count the calls a handler makes to the fs functions it walks and reads with. */
async function counting<T>(run: () => Promise<T>) {
  const readdirSync = vi.spyOn(fs, 'readdirSync')
  const statSync = vi.spyOn(fs, 'statSync')
  const readFileSync = vi.spyOn(fs, 'readFileSync')
  const createReadStream = vi.spyOn(fs, 'createReadStream')
  const stat = vi.spyOn(fs.promises, 'stat')
  try {
    const result = await run()
    return {
      result,
      readdirSync: readdirSync.mock.calls.length,
      statSync: statSync.mock.calls.length,
      readFileSync: readFileSync.mock.calls.length,
      createReadStream: createReadStream.mock.calls.length,
      stat: stat.mock.calls.length,
      readPaths: readFileSync.mock.calls.map(([target]) => String(target)),
    }
  } finally {
    vi.restoreAllMocks()
  }
}

beforeAll(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'blueplm-fsperf-'))
  for (let folder = 0; folder < FOLDERS; folder++) {
    const dir = path.join(vault, `Folder ${folder}`)
    fs.mkdirSync(dir)
    for (let file = 0; file < FILES_PER_FOLDER; file++) {
      fs.writeFileSync(path.join(dir, `part-${file}.sldprt`), `folder ${folder} part ${file}`)
    }
  }

  registerFsHandlers({} as Electron.BrowserWindow, {
    log: () => {},
    logDebug: () => {},
    logError: () => {},
    logWarn: () => {},
    isFileBeingThumbnailed: () => false,
    thumbnailsInProgress: new Set(),
    restoreMainWindowFocus: () => {},
  })
  clearHashCache()
  await invoke('working-dir:set', vault)
})

afterAll(async () => {
  await invoke('working-dir:clear')
  fs.rmSync(vault, { recursive: true, force: true })
})

describe('real-disk vault paths', () => {
  it('scans the vault in one pass: one readdir per folder, one stat per entry, no reads', async () => {
    const started = Date.now()
    const counts = await counting(scan)
    const elapsed = Date.now() - started

    expect(counts.result.filter((f) => !f.isDirectory)).toHaveLength(FILE_COUNT)
    expect(counts.readdirSync).toBe(FOLDERS + 1)
    expect(counts.statSync).toBe(FILE_COUNT + FOLDERS)
    expect(counts.readFileSync).toBe(0)
    expect(counts.createReadStream).toBe(0)
    // ~100ms on a CI runner; the ceiling only catches an accidental quadratic walk
    expect(elapsed).toBeLessThan(10_000)
  })

  it('hashes each file exactly once, then trusts the stamps on a second pass', async () => {
    const files = await scan()
    const request = hashRequest(files)

    const first = await counting(() =>
      invoke<{ results: Array<{ relativePath: string; hash: string }> }>('fs:compute-file-hashes', request),
    )
    expect(first.result.results).toHaveLength(FILE_COUNT)
    expect(first.readFileSync).toBe(FILE_COUNT)
    expect(new Set(first.readPaths).size).toBe(FILE_COUNT)

    const second = await counting(() =>
      invoke<{ results: Array<{ relativePath: string; hash: string }> }>('fs:compute-file-hashes', request),
    )
    expect(second.result.results).toEqual(first.result.results)
    expect(second.readFileSync).toBe(0)

    // A rescan hands the stamped hashes back without reading a byte
    const rescan = await counting(scan)
    expect(rescan.result.filter((f) => !f.isDirectory && f.hash)).toHaveLength(FILE_COUNT)
    expect(rescan.readFileSync).toBe(0)
    expect(rescan.statSync).toBe(FILE_COUNT + FOLDERS)
  })

  it('re-reads only the file that changed', async () => {
    const files = await scan()
    await invoke('fs:compute-file-hashes', hashRequest(files))

    const changed = path.join(vault, 'Folder 7', 'part-3.sldprt')
    fs.writeFileSync(changed, 'a different, longer body')
    const request = hashRequest(await scan())

    const counts = await counting(() => invoke('fs:compute-file-hashes', request))
    expect(counts.readPaths).toEqual([changed])
  })

  it('a delta refresh stats only the reported paths and walks no folders', async () => {
    await scan()
    const reported = ['Folder 1/part-1.sldprt', 'Folder 2/part-2.sldprt', 'Folder 3/part-3.sldprt']

    const counts = await counting(() =>
      invoke<{ files: ScanEntry[]; wasFullScan: boolean }>('fs:list-working-files-delta', reported),
    )
    expect(counts.result.wasFullScan).toBe(false)
    expect(counts.result.files.filter((f) => !f.isDirectory)).toHaveLength(FILE_COUNT)
    expect(counts.stat).toBe(reported.length)
    expect(counts.readdirSync).toBe(0)
    expect(counts.readFileSync).toBe(0)
  })
})
