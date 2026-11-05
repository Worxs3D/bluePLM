/**
 * "Open with its references" (5.13.0): the per-version cache a checked-in version and its exact
 * dependency closure are staged into, so an old assembly opens in SOLIDWORKS against the versions
 * it was checked in with instead of whatever the vault holds today.
 *
 * The cache lives under userData (`version-open-cache`), never in a vault working folder. Each
 * version gets one entry folder named by a short key of its id (`entryKey`, kept short because
 * SOLIDWORKS paths must stay under MAX_PATH with the vault-relative path below it). The renderer
 * stages the files through the ordinary download channels, retargets them, sets them read-only and
 * writes the entry's marker last (`MARKER_NAME`); a marker therefore means a finished entry.
 *
 * Bounded for weeks-long sessions: every prepare prunes the cache (and once shortly after start).
 * An entry unused for `MAX_AGE_MS` goes, and while the cache is over `MAX_BYTES` or `MAX_ENTRIES`
 * the least recently used go first, but never an entry used within `KEEP_RECENT_MS` (it may be
 * open in SOLIDWORKS right now; a locked file would also refuse the remove and wait for a later
 * prune). Every channel takes a version id or a path that must resolve to an entry folder directly
 * under the cache root, so none can be pointed anywhere else.
 */
import { app, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'

export const CACHE_DIR = 'version-open-cache'
export const MARKER_NAME = '.blueplm-version.json'
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const KEEP_RECENT_MS = 24 * 60 * 60 * 1000
export const MAX_BYTES = 10 * 1024 * 1024 * 1024
export const MAX_ENTRIES = 40
const MAX_MARKER_BYTES = 8 * 1024 * 1024
const STARTUP_PRUNE_DELAY_MS = 90 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTRY_KEY = /^v[0-9a-f]{12}$/

let log: (message: string, data?: unknown) => void = () => undefined
let logError: (message: string, data?: unknown) => void = () => undefined
let startupPrune: NodeJS.Timeout | null = null

export interface VersionOpenHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The entry folder name of a version: `v` + the first 12 hex digits of its id, or null for
 * anything that is not a version id. The marker names the full id, and a marker of another id
 * makes the renderer restage, so a (2^-48) key collision costs a download, never a wrong file.
 */
export function entryKey(fileVersionId: unknown): string | null {
  if (typeof fileVersionId !== 'string' || !UUID.test(fileVersionId)) return null
  return `v${fileVersionId.replace(/-/g, '').slice(0, 12).toLowerCase()}`
}

/** Whether `dir` is an entry folder directly under `root` (resolved, case-insensitive). */
export function isCacheEntry(dir: unknown, root: string): boolean {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return false
  const resolved = path.resolve(dir)
  return (
    path.dirname(resolved).toLowerCase() === path.resolve(root).toLowerCase() &&
    ENTRY_KEY.test(path.basename(resolved))
  )
}

const OPENABLE = /\.(sldprt|sldasm|slddrw)$/i

/**
 * Whether `filePath` is a SOLIDWORKS part, assembly or drawing inside an entry folder under
 * `root`: the only thing `version-open:open-root` hands to the shell. A file row's name and path
 * come from other members, so the path that is opened is the one checked, never a display name.
 */
export function isOpenableCacheFile(filePath: unknown, root: string): boolean {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  const relative = path.relative(path.resolve(root), path.resolve(filePath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  const segments = relative.split(path.sep)
  return segments.length >= 2 && ENTRY_KEY.test(segments[0]) && OPENABLE.test(path.basename(filePath))
}

export interface CacheEntryInfo {
  key: string
  /** Last use: the marker's mtime (touched on every prepare), else the folder's. */
  lastUsedMs: number
  bytes: number
}

export interface PruneLimits {
  maxAgeMs: number
  keepRecentMs: number
  maxBytes: number
  maxEntries: number
}

export const DEFAULT_LIMITS: PruneLimits = {
  maxAgeMs: MAX_AGE_MS,
  keepRecentMs: KEEP_RECENT_MS,
  maxBytes: MAX_BYTES,
  maxEntries: MAX_ENTRIES,
}

/**
 * The entries to remove. Pure. `keep` (the entry being prepared) and entries used within
 * `keepRecentMs` are never removed; otherwise entries older than `maxAgeMs` go, then the least
 * recently used until the rest fit `maxBytes` and `maxEntries`.
 */
export function planPrune(
  entries: ReadonlyArray<CacheEntryInfo>,
  now: number,
  limits: PruneLimits = DEFAULT_LIMITS,
  keep: string | null = null,
): string[] {
  const protectedKey = (e: CacheEntryInfo) => e.key === keep || now - e.lastUsedMs < limits.keepRecentMs
  const remove = new Set<string>()
  for (const e of entries) {
    if (!protectedKey(e) && now - e.lastUsedMs >= limits.maxAgeMs) remove.add(e.key)
  }
  const left = entries.filter((e) => !remove.has(e.key))
  let bytes = left.reduce((sum, e) => sum + e.bytes, 0)
  let count = left.length
  const oldestFirst = [...left].sort((a, b) => a.lastUsedMs - b.lastUsedMs)
  for (const e of oldestFirst) {
    if (bytes <= limits.maxBytes && count <= limits.maxEntries) break
    if (protectedKey(e)) continue
    remove.add(e.key)
    bytes -= e.bytes
    count--
  }
  return entries.filter((e) => remove.has(e.key)).map((e) => e.key)
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await folderBytes(full)
    else if (entry.isFile()) {
      const stat = await fs.promises.stat(full).catch(() => null)
      if (stat) total += stat.size
    }
  }
  return total
}

/** Clear read-only bits below `dir`, so files can be overwritten or removed on Windows. */
async function makeWritable(dir: string): Promise<void> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await makeWritable(full)
    else await fs.promises.chmod(full, 0o666).catch(() => undefined)
  }
}

async function readEntries(root: string): Promise<CacheEntryInfo[]> {
  const dirents = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
  const out: CacheEntryInfo[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !ENTRY_KEY.test(dirent.name)) continue
    const full = path.join(root, dirent.name)
    const marker = await fs.promises.stat(path.join(full, MARKER_NAME)).catch(() => null)
    const folder = marker ?? (await fs.promises.stat(full).catch(() => null))
    if (!folder) continue
    out.push({ key: dirent.name, lastUsedMs: folder.mtimeMs, bytes: await folderBytes(full) })
  }
  return out
}

/** Prune the cache under `root`. Returns the number of entries removed. */
export async function pruneCache(
  root: string,
  keep: string | null,
  now: number = Date.now(),
  limits: PruneLimits = DEFAULT_LIMITS,
): Promise<number> {
  const entries = await readEntries(root)
  let removed = 0
  for (const key of planPrune(entries, now, limits, keep)) {
    const full = path.join(root, key)
    try {
      await makeWritable(full)
      await fs.promises.rm(full, { recursive: true, force: true, maxRetries: 2 })
      removed++
    } catch (err) {
      // Locked by SOLIDWORKS (or anything else): a later prune takes it.
      log('[VersionOpen] Cache entry kept for now', { key, error: errorMessage(err) })
    }
  }
  return removed
}

function cacheRoot(): string {
  return path.join(app.getPath('userData'), CACHE_DIR)
}

export function registerVersionOpenHandlers(deps: VersionOpenHandlerDependencies): void {
  log = deps.log
  logError = deps.logError

  // The entry of one version, created if missing, with its marker when it has one. Prunes the
  // rest of the cache first and marks this entry as just used.
  ipcMain.handle('version-open:prepare-entry', async (_, fileVersionId: unknown) => {
    const key = entryKey(fileVersionId)
    if (!key) return { success: false, error: 'Invalid version id' }
    try {
      const root = cacheRoot()
      await fs.promises.mkdir(root, { recursive: true })
      const removed = await pruneCache(root, key)
      if (removed > 0) log('[VersionOpen] Pruned the version cache', { removed })
      const dir = path.join(root, key)
      await fs.promises.mkdir(dir, { recursive: true })
      const markerPath = path.join(dir, MARKER_NAME)
      let marker: string | null = null
      const stat = await fs.promises.stat(markerPath).catch(() => null)
      if (stat && stat.isFile() && stat.size <= MAX_MARKER_BYTES) {
        marker = await fs.promises.readFile(markerPath, 'utf8').catch(() => null)
        const now = new Date()
        await fs.promises.utimes(markerPath, now, now).catch(() => undefined)
      }
      return { success: true, path: dir, marker }
    } catch (err) {
      logError('[VersionOpen] Version cache unavailable', { error: errorMessage(err) })
      return { success: false, error: errorMessage(err) }
    }
  })

  // Before staging again: the marker goes (the entry is unfinished until it is rewritten) and
  // every file becomes writable, so downloads and retargeting can replace them.
  ipcMain.handle('version-open:begin-restage', async (_, entryPath: unknown) => {
    if (!isCacheEntry(entryPath, cacheRoot())) return { success: false, error: 'Not a version cache entry' }
    const dir = path.resolve(entryPath as string)
    try {
      await fs.promises.rm(path.join(dir, MARKER_NAME), { force: true })
      await makeWritable(dir)
      return { success: true }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  })

  // The last step of staging: the marker (JSON the renderer built) is written into the entry.
  ipcMain.handle('version-open:write-marker', async (_, entryPath: unknown, content: unknown) => {
    if (!isCacheEntry(entryPath, cacheRoot())) return { success: false, error: 'Not a version cache entry' }
    if (typeof content !== 'string' || content.length > MAX_MARKER_BYTES) {
      return { success: false, error: 'Invalid marker' }
    }
    try {
      JSON.parse(content)
    } catch {
      return { success: false, error: 'Invalid marker' }
    }
    try {
      const dir = path.resolve(entryPath as string)
      if (!fs.existsSync(dir)) return { success: false, error: 'Version cache entry not found' }
      await fs.promises.writeFile(path.join(dir, MARKER_NAME), content, 'utf8')
      return { success: true }
    } catch (err) {
      logError('[VersionOpen] Failed to write the cache marker', { error: errorMessage(err) })
      return { success: false, error: errorMessage(err) }
    }
  })

  // Open the staged root in SOLIDWORKS. Only a .sldprt/.sldasm/.slddrw inside an entry: the
  // general fs:open-file would run whatever the path names.
  ipcMain.handle('version-open:open-root', async (_, filePath: unknown) => {
    if (!isOpenableCacheFile(filePath, cacheRoot())) {
      return { success: false, error: 'Not a SOLIDWORKS file in the version cache' }
    }
    const target = path.resolve(filePath as string)
    if (!fs.existsSync(target)) return { success: false, error: 'The staged file is missing' }
    const error = await shell.openPath(target)
    if (error) {
      logError('[VersionOpen] Could not open the staged version', { target, error })
      return { success: false, error }
    }
    return { success: true }
  })

  startupPrune = setTimeout(() => {
    startupPrune = null
    const root = cacheRoot()
    if (!fs.existsSync(root)) return
    void pruneCache(root, null)
      .then((removed) => {
        if (removed > 0) log('[VersionOpen] Pruned the version cache at start', { removed })
      })
      .catch((err) => logError('[VersionOpen] Startup prune failed', { error: errorMessage(err) }))
  }, STARTUP_PRUNE_DELAY_MS)
  startupPrune.unref?.()
}

export function unregisterVersionOpenHandlers(): void {
  if (startupPrune) clearTimeout(startupPrune)
  startupPrune = null
  ipcMain.removeHandler('version-open:prepare-entry')
  ipcMain.removeHandler('version-open:begin-restage')
  ipcMain.removeHandler('version-open:write-marker')
  ipcMain.removeHandler('version-open:open-root')
}
