import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
let userData = ''

const openedPaths: string[] = []

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  shell: {
    openPath: async (p: string) => {
      openedPaths.push(p)
      return ''
    },
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

const {
  CACHE_DIR,
  MARKER_NAME,
  entryKey,
  isCacheEntry,
  isOpenableCacheFile,
  planPrune,
  pruneCache,
  registerVersionOpenHandlers,
  unregisterVersionOpenHandlers,
} = await import('./versionOpen')

const ID = '0f8e4c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b'
const DAY = 24 * 60 * 60 * 1000

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({}, ...args) as Promise<T>
}

describe('entryKey', () => {
  it('names a version by a short key and refuses anything else', () => {
    expect(entryKey(ID)).toBe('v0f8e4c2a1b3d')
    expect(entryKey(ID.toUpperCase())).toBe('v0f8e4c2a1b3d')
    expect(entryKey('../../etc')).toBeNull()
    expect(entryKey('')).toBeNull()
    expect(entryKey(42)).toBeNull()
    expect(entryKey(`${ID}/..`)).toBeNull()
  })
})

describe('isCacheEntry', () => {
  const root = path.resolve('/cache-root')
  it('accepts only an entry folder directly under the cache root', () => {
    expect(isCacheEntry(path.join(root, 'v0f8e4c2a1b3d'), root)).toBe(true)
    expect(isCacheEntry(path.join(root, 'v0f8e4c2a1b3d', 'sub'), root)).toBe(false)
    expect(isCacheEntry(path.join(root, 'other'), root)).toBe(false)
    expect(isCacheEntry(root, root)).toBe(false)
    expect(isCacheEntry(path.join(root, 'v0f8e4c2a1b3d', '..', '..', 'v0f8e4c2a1b3d'), root)).toBe(false)
    expect(isCacheEntry('relative/v0f8e4c2a1b3d', root)).toBe(false)
    expect(isCacheEntry(undefined, root)).toBe(false)
  })
})

describe('isOpenableCacheFile', () => {
  const root = path.resolve('/cache-root')
  const entry = path.join(root, 'v0f8e4c2a1b3d')
  it('accepts only a SOLIDWORKS document inside an entry', () => {
    expect(isOpenableCacheFile(path.join(entry, 'Top', 'Frame.SLDASM'), root)).toBe(true)
    expect(isOpenableCacheFile(path.join(entry, 'a.sldprt'), root)).toBe(true)
    expect(isOpenableCacheFile(path.join(entry, 'a.SLDDRW'), root)).toBe(true)
    expect(isOpenableCacheFile(path.join(entry, 'x.exe'), root)).toBe(false)
    expect(isOpenableCacheFile(path.join(entry, 'x.sldasm.exe'), root)).toBe(false)
    expect(isOpenableCacheFile(path.join(entry, 'x.bat'), root)).toBe(false)
    expect(isOpenableCacheFile(path.join(root, 'a.sldasm'), root)).toBe(false)
    expect(isOpenableCacheFile(path.join(root, 'other', 'a.sldasm'), root)).toBe(false)
    expect(isOpenableCacheFile(path.join(entry, '..', '..', 'a.sldasm'), root)).toBe(false)
    expect(isOpenableCacheFile(path.resolve('/elsewhere/v0f8e4c2a1b3d/a.sldasm'), root)).toBe(false)
    expect(isOpenableCacheFile('relative/a.sldasm', root)).toBe(false)
    expect(isOpenableCacheFile(undefined, root)).toBe(false)
  })
})

describe('planPrune', () => {
  const limits = { maxAgeMs: 30 * DAY, keepRecentMs: DAY, maxBytes: 100, maxEntries: 3 }
  const now = 100 * DAY

  it('removes entries past the age limit', () => {
    const entries = [
      { key: 'vold', lastUsedMs: now - 31 * DAY, bytes: 1 },
      { key: 'vnew', lastUsedMs: now - 2 * DAY, bytes: 1 },
    ]
    expect(planPrune(entries, now, limits)).toEqual(['vold'])
  })

  it('removes the least recently used until size and count fit', () => {
    const entries = [
      { key: 'va', lastUsedMs: now - 5 * DAY, bytes: 60 },
      { key: 'vb', lastUsedMs: now - 4 * DAY, bytes: 30 },
      { key: 'vc', lastUsedMs: now - 3 * DAY, bytes: 30 },
    ]
    expect(planPrune(entries, now, limits)).toEqual(['va'])
    const many = ['v1', 'v2', 'v3', 'v4', 'v5'].map((key, i) => ({ key, lastUsedMs: now - (10 - i) * DAY, bytes: 1 }))
    expect(planPrune(many, now, limits)).toEqual(['v1', 'v2'])
  })

  it('never removes the entry being prepared or one used within a day', () => {
    const entries = [
      { key: 'vkeep', lastUsedMs: now - 40 * DAY, bytes: 500 },
      { key: 'vrecent', lastUsedMs: now - DAY / 2, bytes: 500 },
      { key: 'vother', lastUsedMs: now - 3 * DAY, bytes: 10 },
    ]
    expect(planPrune(entries, now, limits, 'vkeep')).toEqual(['vother'])
  })
})

describe('version cache on disk', () => {
  beforeAll(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'blueplm-version-open-test-'))
    registerVersionOpenHandlers({ log: () => undefined, logError: () => undefined })
  })
  afterAll(() => {
    unregisterVersionOpenHandlers()
    fs.rmSync(userData, { recursive: true, force: true })
  })

  it('prepares an entry under userData, reads its marker back and refuses bad ids', async () => {
    const first = await invoke<{ success: boolean; path: string; marker: string | null }>('version-open:prepare-entry', ID)
    expect(first.success).toBe(true)
    expect(first.path).toBe(path.join(userData, CACHE_DIR, 'v0f8e4c2a1b3d'))
    expect(first.marker).toBeNull()

    const wrote = await invoke<{ success: boolean }>('version-open:write-marker', first.path, '{"a":1}')
    expect(wrote.success).toBe(true)
    const again = await invoke<{ marker: string | null }>('version-open:prepare-entry', ID)
    expect(again.marker).toBe('{"a":1}')

    await expect(invoke('version-open:prepare-entry', '../x')).resolves.toMatchObject({ success: false })
  })

  it('writes markers only into an entry, and only JSON', async () => {
    const entry = path.join(userData, CACHE_DIR, 'v0f8e4c2a1b3d')
    await expect(invoke('version-open:write-marker', entry, 'not json')).resolves.toMatchObject({ success: false })
    await expect(invoke('version-open:write-marker', userData, '{}')).resolves.toMatchObject({ success: false })
    await expect(
      invoke('version-open:write-marker', path.join(entry, 'sub'), '{}'),
    ).resolves.toMatchObject({ success: false })
    await expect(invoke('version-open:begin-restage', os.tmpdir())).resolves.toMatchObject({ success: false })
  })

  it('begin-restage removes the marker and makes read-only files writable', async () => {
    const prepared = await invoke<{ path: string }>('version-open:prepare-entry', ID)
    const file = path.join(prepared.path, 'Parts', 'a.sldprt')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x')
    fs.chmodSync(file, 0o444)
    await invoke('version-open:write-marker', prepared.path, '{}')

    const result = await invoke<{ success: boolean }>('version-open:begin-restage', prepared.path)
    expect(result.success).toBe(true)
    expect(fs.existsSync(path.join(prepared.path, MARKER_NAME))).toBe(false)
    fs.writeFileSync(file, 'y')
    expect(fs.readFileSync(file, 'utf8')).toBe('y')
  })

  it('open-root opens a staged SOLIDWORKS file and refuses anything else', async () => {
    const prepared = await invoke<{ path: string }>('version-open:prepare-entry', ID)
    const asm = path.join(prepared.path, 'Top', 'Frame.SLDASM')
    const exe = path.join(prepared.path, 'Top', 'x.exe')
    fs.mkdirSync(path.dirname(asm), { recursive: true })
    fs.writeFileSync(asm, 'a')
    fs.writeFileSync(exe, 'MZ')

    await expect(invoke('version-open:open-root', exe)).resolves.toMatchObject({ success: false })
    await expect(invoke('version-open:open-root', path.join(prepared.path, 'Top', 'Gone.sldasm'))).resolves.toMatchObject({
      success: false,
    })
    expect(openedPaths).toEqual([])
    await expect(invoke('version-open:open-root', asm)).resolves.toEqual({ success: true })
    expect(openedPaths).toEqual([path.resolve(asm)])
  })

  it('pruneCache removes old read-only entries and keeps recent ones', async () => {
    const root = path.join(userData, CACHE_DIR)
    const old = path.join(root, 'vaaaaaaaaaaaa')
    fs.mkdirSync(path.join(old, 'Sub'), { recursive: true })
    const oldFile = path.join(old, 'Sub', 'b.sldasm')
    fs.writeFileSync(oldFile, 'z')
    fs.chmodSync(oldFile, 0o444)
    fs.writeFileSync(path.join(old, MARKER_NAME), '{}')
    const longAgo = new Date(Date.now() - 60 * DAY)
    fs.utimesSync(path.join(old, MARKER_NAME), longAgo, longAgo)
    // Not an entry name: never touched.
    fs.mkdirSync(path.join(root, 'something-else'), { recursive: true })

    const removed = await pruneCache(root, null)
    expect(removed).toBe(1)
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(path.join(root, 'v0f8e4c2a1b3d'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'something-else'))).toBe(true)
  })
})
