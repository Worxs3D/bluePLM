/**
 * Local Sync Index - IndexedDB-based tracking of previously synced files
 *
 * This module tracks which files have been synced to each vault. When a file
 * exists locally but is not on the server AND is in the sync index, it means
 * another user deleted it from the vault - these are "orphaned" files.
 *
 * This allows distinguishing between:
 * - Files the user created locally (genuinely new) - NOT in sync index
 * - Files that were previously synced but deleted by another user (orphaned) - IN sync index
 *
 * The sync index is updated when:
 * - Files are synced (first check-in)
 * - Files are downloaded
 * - Files are checked out
 * - Server file list is loaded (all server files are marked as "known synced")
 * - Files are deleted from server (removed from index)
 * - Orphaned files are discarded (removed from index)
 *
 * A path that leaves the server while the file is still on disk is kept as a
 * tombstone rather than pruned, because "was previously synced" is the only
 * evidence that distinguishes an orphan from a file the user authored. Without it
 * the answer survived exactly one load after the server row disappeared.
 */

import { log } from '@/lib/logger'

const DB_NAME = 'blueplm-sync-index'
const DB_VERSION = 3
const STORE_NAME = 'sync-index'

/**
 * How long a tombstone keeps asserting that a path was once synced.
 *
 * The assertion is what allows the file to be deleted from disk, so it must not
 * outlive the confidence behind it: after a month unaddressed, the likelier reading
 * of a local file at a path the server dropped is that the path was reused. Expiry
 * reclassifies the file as 'added', which is the direction that leaves work in place.
 */
const ORPHAN_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface SyncIndexEntry {
  key: string // vaultId:relativePath (compound key)
  vaultId: string
  relativePath: string // lowercase for case-insensitive matching
  lastSyncedAt: number // timestamp
  ino?: number // NTFS file index number (survives renames)
  localVersion?: number // last known synced version (survives app restart)
  localHash?: string // last known content hash (survives app restart)
  // Size and modified time (ms) of the file localHash was computed from. Without them a
  // restart cannot tell a hash still true of the disk from one the user's edits since made
  // stale. Absent on entries written before 4.7.5, and whenever localHash was written
  // without a known stamp.
  hashSize?: number
  hashMtimeMs?: number
  // Path the index knows only from local state: the old server path of a file moved
  // on disk, or its new local path before the move reaches the server. Carrying the
  // inode at both paths is what keeps rename detection working across loads, so these
  // entries must survive the server prune - but they are not evidence of a sync, so
  // orphan detection must never see them.
  localOnly?: boolean
  // When this path was first observed missing from the server while the file was still
  // on disk. Set only for paths that were server-backed, so it means "the server row
  // for a file we hold went away", not "this path is unknown to the server".
  orphanedAt?: number
}

/** Size and modified time (ms) of the file a stored hash was computed from. */
export interface HashStamp {
  size: number
  mtimeMs: number
}

/** Version and hash state restored from the sync index on load. */
export interface SavedVersionData {
  localVersion?: number
  localHash?: string
  hashStamp?: HashStamp
}

/** What the loader needs about a path the sync index knows. */
export interface SyncIndexPathInfo {
  /** Set only on tombstoned paths: when the server row was first seen gone. */
  orphanedAt?: number
}

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Open or create the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      log.error('[SyncIndex]', 'Failed to open IndexedDB', { error: request.error })
      reject(request.error)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Non-destructive: only create the store if it doesn't exist.
      // New optional fields (localVersion, localHash) don't need schema changes
      // because IndexedDB records are schemaless.
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('vaultId', 'vaultId', { unique: false })
        store.createIndex('relativePath', 'relativePath', { unique: false })
      }
    }
  })

  return dbPromise
}

/** One entry for updateInodes. */
export interface InodeUpdate {
  path: string
  ino: number
  localVersion?: number
  localHash?: string
  hashStamp?: HashStamp
  localOnly?: boolean
}

/** At or above this many entries updateInodes reads the vault's entries once instead of one by one. */
const BULK_READ_MIN_ENTRIES = 256

/**
 * Puts queued per callback by updateInodes' bulk path. Each put clones its entry on the main
 * thread; a first load writes every entry, and 30k puts in one callback blocked for 1-2 s right
 * after the vault came up (render-perf nightly). Each chunk is queued from the last request
 * callback of the one before, which keeps the transaction open, so the write stays atomic.
 */
export const INODE_WRITE_CHUNK = 200

/** True when two entries of a server-backed path hold the same data, ignoring lastSyncedAt. */
function isSameServerBackedEntry(existing: SyncIndexEntry, next: SyncIndexEntry): boolean {
  return (
    existing.relativePath === next.relativePath &&
    !existing.localOnly &&
    existing.orphanedAt === undefined &&
    existing.ino === next.ino &&
    existing.localVersion === next.localVersion &&
    existing.localHash === next.localHash &&
    existing.hashSize === next.hashSize &&
    existing.hashMtimeMs === next.hashMtimeMs
  )
}

/**
 * The entry `update` turns `existing` into, or null when that is what is stored already. A hash
 * written without a stamp clears the stored stamp, so a stamp never vouches for a hash it was not
 * taken with.
 */
function applyInodeUpdate(
  key: string,
  vaultId: string,
  existing: SyncIndexEntry | undefined,
  { path, ino, localVersion, localHash, hashStamp, localOnly }: InodeUpdate,
): SyncIndexEntry | null {
  if (!existing) {
    return {
      key,
      vaultId,
      relativePath: path.toLowerCase(),
      lastSyncedAt: Date.now(),
      ino,
      localVersion,
      localHash,
      hashSize: localHash !== undefined ? hashStamp?.size : undefined,
      hashMtimeMs: localHash !== undefined ? hashStamp?.mtimeMs : undefined,
      localOnly,
    }
  }

  const next: SyncIndexEntry = { ...existing, ino }
  if (localVersion !== undefined) next.localVersion = localVersion
  if (localHash !== undefined) {
    next.localHash = localHash
    next.hashSize = hashStamp?.size
    next.hashMtimeMs = hashStamp?.mtimeMs
  }
  if (localOnly) {
    next.localOnly = true
  } else {
    delete next.localOnly
  }

  const unchanged =
    existing.ino === next.ino &&
    existing.localVersion === next.localVersion &&
    existing.localHash === next.localHash &&
    existing.hashSize === next.hashSize &&
    existing.hashMtimeMs === next.hashMtimeMs &&
    Boolean(existing.localOnly) === Boolean(next.localOnly)
  return unchanged ? null : next
}

/**
 * The vault's entries, read once for every caller that asks while the read is still running. A
 * load asks for the sync index, the inode map and the version map at the same moment, and three
 * separate reads cloned every entry three times. A write starting drops the shared read, so a
 * caller after it reads afresh.
 */
const inFlightVaultReads = new Map<string, Promise<SyncIndexEntry[]>>()

function readVaultEntries(db: IDBDatabase, vaultId: string): Promise<SyncIndexEntry[]> {
  const shared = inFlightVaultReads.get(vaultId)
  if (shared) return shared

  const read = new Promise<SyncIndexEntry[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).index('vaultId').getAll(IDBKeyRange.only(vaultId))
    request.onsuccess = () => resolve(request.result as SyncIndexEntry[])
    request.onerror = () => reject(request.error)
  })
  inFlightVaultReads.set(vaultId, read)
  const forget = () => {
    if (inFlightVaultReads.get(vaultId) === read) inFlightVaultReads.delete(vaultId)
  }
  read.then(forget, forget)
  return read
}

/**
 * Generate compound key for sync index entry
 */
function makeKey(vaultId: string, relativePath: string): string {
  return `${vaultId}:${relativePath.toLowerCase()}`
}

/**
 * Get the sync index for a vault - previously synced paths (lowercase) keyed for
 * `has()` lookups, with tombstone detail for the paths that carry it.
 * This is the main function used during file loading to detect orphaned files.
 *
 * Local-only paths are excluded: they record an inode for rename detection, not a
 * sync, and treating one as evidence of a sync would classify a moved file as an
 * orphan. Tombstones past their TTL are excluded for the same reason the prune
 * would drop them on the next write.
 */
export async function getSyncIndex(vaultId: string): Promise<Map<string, SyncIndexPathInfo>> {
  try {
    const db = await openDB()

    return readVaultEntries(db, vaultId).then(
      (entries) => {
        const now = Date.now()
        const paths = new Map<string, SyncIndexPathInfo>()
        let tombstoned = 0

        for (const entry of entries) {
          if (entry.localOnly) continue
          if (entry.orphanedAt !== undefined) {
            if (now - entry.orphanedAt > ORPHAN_TOMBSTONE_TTL_MS) continue
            tombstoned++
          }
          paths.set(entry.relativePath, { orphanedAt: entry.orphanedAt })
        }

        log.info(
          '[SyncIndex]',
          `Loaded ${paths.size} synced paths (${tombstoned} orphan tombstones) for vault ${vaultId}`,
        )
        return paths
      },
      (error: unknown) => {
        log.error('[SyncIndex]', 'Failed to read sync index', { error })
        return new Map()
      },
    )
  } catch (error) {
    log.error('[SyncIndex]', 'Error reading sync index', { error })
    return new Map()
  }
}

/**
 * Add paths to the sync index for a vault.
 * Called after successful sync, download, checkout, or when loading server files.
 *
 * @param vaultId - The vault ID
 * @param paths - Array of relative paths (will be lowercased for storage)
 */
export async function addToSyncIndex(vaultId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return

  inFlightVaultReads.delete(vaultId)
  try {
    const db = await openDB()
    const now = Date.now()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      let completed = 0
      let errors = 0

      for (const path of paths) {
        const normalizedPath = path.toLowerCase()
        const entry: SyncIndexEntry = {
          key: makeKey(vaultId, path),
          vaultId,
          relativePath: normalizedPath,
          lastSyncedAt: now,
        }

        const request = store.put(entry)
        request.onsuccess = () => {
          completed++
          if (completed + errors === paths.length) {
            log.info('[SyncIndex]', `Added ${completed} paths to sync index for vault ${vaultId}`)
            resolve()
          }
        }
        request.onerror = () => {
          errors++
          if (completed + errors === paths.length) {
            if (errors > 0) {
              log.warn('[SyncIndex]', `Added ${completed} paths with ${errors} errors`)
            }
            resolve()
          }
        }
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error adding to sync index', { error })
  }
}

/**
 * Remove paths from the sync index for a vault.
 * Called when files are deleted from server or when orphaned files are discarded.
 *
 * @param vaultId - The vault ID
 * @param paths - Array of relative paths to remove
 */
export async function removeFromSyncIndex(vaultId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return

  inFlightVaultReads.delete(vaultId)
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      let completed = 0
      let errors = 0

      for (const path of paths) {
        const key = makeKey(vaultId, path)
        const request = store.delete(key)

        request.onsuccess = () => {
          completed++
          if (completed + errors === paths.length) {
            log.info(
              '[SyncIndex]',
              `Removed ${completed} paths from sync index for vault ${vaultId}`,
            )
            resolve()
          }
        }
        request.onerror = () => {
          errors++
          if (completed + errors === paths.length) {
            resolve()
          }
        }
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error removing from sync index', { error })
  }
}

/**
 * Clear the entire sync index for a vault.
 * Called when a vault is disconnected.
 *
 * @param vaultId - The vault ID to clear
 */
export async function clearSyncIndex(vaultId: string): Promise<void> {
  inFlightVaultReads.delete(vaultId)
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('vaultId')

      // First get all keys for this vault
      const keysRequest = index.getAllKeys(IDBKeyRange.only(vaultId))

      keysRequest.onsuccess = () => {
        const keys = keysRequest.result

        if (keys.length === 0) {
          log.info('[SyncIndex]', `No entries to clear for vault ${vaultId}`)
          resolve()
          return
        }

        let deleted = 0
        for (const key of keys) {
          const deleteRequest = store.delete(key)
          deleteRequest.onsuccess = () => {
            deleted++
            if (deleted === keys.length) {
              log.info('[SyncIndex]', `Cleared ${deleted} entries for vault ${vaultId}`)
              resolve()
            }
          }
          deleteRequest.onerror = () => {
            deleted++
            if (deleted === keys.length) {
              resolve()
            }
          }
        }
      }

      keysRequest.onerror = () => {
        log.error('[SyncIndex]', 'Failed to get keys for clearing', { error: keysRequest.error })
        resolve()
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error clearing sync index', { error })
  }
}

/**
 * Bulk update the sync index with all server files.
 * This is an optimized version that replaces the entire index for a vault.
 * Called during file loading to ensure all server files are tracked.
 *
 * A path that is no longer on the server is either dropped or tombstoned, depending
 * on whether the file is still on disk. Callers that cannot say what is on disk get
 * the plain drop, so a caller with a partial view can never tombstone.
 *
 * @param vaultId - The vault ID
 * @param serverPaths - Array of all server file paths
 * @param localPaths - Lowercased relative paths present on disk, from a complete scan
 */
export async function updateSyncIndexFromServer(
  vaultId: string,
  serverPaths: string[],
  localPaths?: ReadonlySet<string>,
): Promise<void> {
  if (serverPaths.length === 0) return

  inFlightVaultReads.delete(vaultId)
  try {
    const db = await openDB()
    const now = Date.now()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const vaultIndex = store.index('vaultId')

      // Pre-read existing entries to preserve ino, localVersion, and localHash values.
      // store.put() replaces the entire record, so without this those fields
      // would be wiped on every load.
      const existingRequest = vaultIndex.getAll(IDBKeyRange.only(vaultId))
      existingRequest.onsuccess = () => {
        const existingEntries = existingRequest.result as SyncIndexEntry[]
        const existingByKey = new Map(existingEntries.map((e) => [e.key, e]))

        // Resolve entries whose paths are no longer on the server. Stale paths
        // accumulate from renames and prevent correct inode detection, so most are
        // dropped - but a path whose file is still on disk is the only record that
        // the file was ever synced, and dropping it makes an orphan indistinguishable
        // from a file the user authored.
        const serverKeySet = new Set(serverPaths.map((p) => makeKey(vaultId, p)))
        let tombstonesCreated = 0
        let tombstonesDropped = 0

        for (const existing of existingEntries) {
          if (serverKeySet.has(existing.key)) continue

          // Owned by rename detection, which needs the inode at both paths. The prune
          // and updateInodes used to delete and recreate these on every load.
          if (existing.localOnly) continue

          // Gone from disk as well: nothing left to classify, and keeping the record
          // would make a future file at this path look like an orphan.
          if (!localPaths?.has(existing.relativePath)) {
            store.delete(existing.key)
            if (existing.orphanedAt !== undefined) tombstonesDropped++
            continue
          }

          if (existing.orphanedAt === undefined) {
            store.put({ ...existing, orphanedAt: now })
            tombstonesCreated++
          } else if (now - existing.orphanedAt > ORPHAN_TOMBSTONE_TTL_MS) {
            store.delete(existing.key)
            tombstonesDropped++
          }
        }

        // Rebuilt from scratch, so a path back on the server loses both localOnly
        // and orphanedAt. That is the exit for a reconciled move and for a file
        // another user restored, and it is why a stored flag is never authoritative.
        // An entry that would come out the same is not written: this runs after every
        // committed load, watcher refreshes included, and rewriting all ~27k entries
        // each time was most of the IndexedDB traffic of a refresh that changed one
        // file. lastSyncedAt, read only by getSyncIndexStats, then records the last
        // change rather than the last load.
        const writes: SyncIndexEntry[] = []
        for (const path of serverPaths) {
          const key = makeKey(vaultId, path)
          const existing = existingByKey.get(key)
          const entry: SyncIndexEntry = {
            key,
            vaultId,
            relativePath: path.toLowerCase(),
            lastSyncedAt: now,
            ino: existing?.ino,
            localVersion: existing?.localVersion,
            localHash: existing?.localHash,
            hashSize: existing?.hashSize,
            hashMtimeMs: existing?.hashMtimeMs,
          }
          if (existing && isSameServerBackedEntry(existing, entry)) continue
          writes.push(entry)
        }

        const finish = () => {
          log.info('[SyncIndex]', `Updated sync index with ${serverPaths.length} server paths`, {
            written: writes.length,
            tombstonesCreated,
            tombstonesDropped,
          })
          resolve()
        }
        if (writes.length === 0) {
          finish()
          return
        }

        let completed = 0
        for (const entry of writes) {
          const request = store.put(entry)
          request.onsuccess = () => {
            completed++
            if (completed === writes.length) finish()
          }
          request.onerror = () => {
            completed++
            if (completed === writes.length) resolve()
          }
        }
      }

      existingRequest.onerror = () => {
        log.error(
          '[SyncIndex]',
          'Failed to pre-read existing entries, falling back to no-ino update',
        )
        let completed = 0
        for (const path of serverPaths) {
          const entry: SyncIndexEntry = {
            key: makeKey(vaultId, path),
            vaultId,
            relativePath: path.toLowerCase(),
            lastSyncedAt: now,
          }
          const request = store.put(entry)
          request.onsuccess = () => {
            completed++
            if (completed === serverPaths.length) resolve()
          }
          request.onerror = () => {
            completed++
            if (completed === serverPaths.length) resolve()
          }
        }
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error updating sync index from server', { error })
  }
}

/**
 * Check if a specific path is in the sync index for a vault.
 *
 * @param vaultId - The vault ID
 * @param relativePath - The relative path to check
 * @returns True if the path was previously synced
 */
export async function isInSyncIndex(vaultId: string, relativePath: string): Promise<boolean> {
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const key = makeKey(vaultId, relativePath)
      const request = store.get(key)

      request.onsuccess = () => {
        resolve(!!request.result)
      }

      request.onerror = () => {
        log.error('[SyncIndex]', 'Failed to check sync index', { error: request.error })
        resolve(false)
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error checking sync index', { error })
    return false
  }
}

/**
 * Get a map of inode -> relativePath for all entries that have an inode recorded.
 * Used during file loading for rename detection: if a local file's inode matches
 * a previously-synced path's inode, it was renamed (not a new file).
 */
export async function getInodeMap(vaultId: string): Promise<Map<number, string[]>> {
  try {
    const db = await openDB()

    return readVaultEntries(db, vaultId).then(
      (entries) => {
        const map = new Map<number, string[]>()
        for (const entry of entries) {
          if (entry.ino && entry.ino > 0) {
            const existing = map.get(entry.ino)
            if (existing) {
              existing.push(entry.relativePath)
            } else {
              map.set(entry.ino, [entry.relativePath])
            }
          }
        }
        log.info(
          '[SyncIndex]',
          `Loaded inode map: ${map.size} entries with inodes for vault ${vaultId}`,
        )
        return map
      },
      (error: unknown) => {
        log.error('[SyncIndex]', 'Failed to read inode map', { error })
        return new Map()
      },
    )
  } catch (error) {
    log.error('[SyncIndex]', 'Error reading inode map', { error })
    return new Map()
  }
}

/**
 * Batch-update inodes (and optionally localVersion/localHash) for sync index entries.
 * Called after file loading to persist the current inode for each matched file,
 * so the next load can use inodes for rename detection and version/hash for
 * accurate outdated status on app restart.
 *
 * Creates new entries if none exist (upsert) so files from any entry path
 * (SolidWorks DM API extension, manual copy, etc.) get inode tracking.
 *
 * `hashStamp` is the size and modified time of the file `localHash` was computed from. A
 * hash written without one also clears any stored stamp, so a stamp never vouches for a
 * hash it was not taken with.
 *
 * `localOnly` must be passed for every entry whose path is not on the server on this
 * load, and left absent otherwise. It is derived per load and written unconditionally
 * so a path that becomes server-backed loses the flag; a stored flag is never trusted.
 */
export async function updateInodes(vaultId: string, entries: InodeUpdate[]): Promise<void> {
  if (entries.length === 0) return

  inFlightVaultReads.delete(vaultId)
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      // A load passes every matched file, and most of them have not changed since the last
      // load. Writing those back unchanged was most of the IndexedDB traffic of a watcher
      // refresh, so only an entry that comes out different is put.
      const write = (key: string, existing: SyncIndexEntry | undefined, update: InodeUpdate) => {
        const next = applyInodeUpdate(key, vaultId, existing, update)
        if (next) store.put(next)
        return next ?? existing
      }

      if (entries.length >= BULK_READ_MIN_ENTRIES) {
        // One read of the vault's entries instead of a get per entry.
        const request = store.index('vaultId').getAll(IDBKeyRange.only(vaultId))
        request.onsuccess = () => {
          const existingByKey = new Map(
            (request.result as SyncIndexEntry[]).map((entry) => [entry.key, entry]),
          )
          let next = 0
          const writeChunk = () => {
            let puts = 0
            let lastRequest: IDBRequest | null = null
            while (next < entries.length && puts < INODE_WRITE_CHUNK) {
              const update = entries[next++]
              const key = makeKey(vaultId, update.path)
              const before = existingByKey.get(key)
              const updated = applyInodeUpdate(key, vaultId, before, update)
              if (updated) {
                lastRequest = store.put(updated)
                existingByKey.set(key, updated)
                puts++
              }
            }
            if (next >= entries.length) {
              resolve()
              return
            }
            // A chunk always ends on a put, so there is a request to continue from.
            if (lastRequest) {
              lastRequest.onsuccess = writeChunk
              // A failed put aborts the transaction: nothing more will be written, and the load
              // must not wait on it.
              lastRequest.onerror = () => {
                log.error('[SyncIndex]', 'Failed to write inode updates', { error: lastRequest?.error })
                resolve()
              }
            }
          }
          writeChunk()
        }
        request.onerror = () => {
          log.error('[SyncIndex]', 'Failed to read entries for inode update', { error: request.error })
          resolve()
        }
        return
      }

      let completed = 0
      for (const update of entries) {
        const key = makeKey(vaultId, update.path)
        const getRequest = store.get(key)

        getRequest.onsuccess = () => {
          completed++
          write(key, getRequest.result as SyncIndexEntry | undefined, update)
          if (completed === entries.length) {
            resolve()
          }
        }

        getRequest.onerror = () => {
          completed++
          if (completed === entries.length) {
            resolve()
          }
        }
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error updating inodes', { error })
  }
}

/**
 * Get a map of relativePath -> { localVersion, localHash } for all entries that have
 * version or hash data. Used during file loading to restore version/hash state after
 * app restart, preventing false-positive "outdated" (purple) highlights.
 */
export async function getVersionMap(vaultId: string): Promise<Map<string, SavedVersionData>> {
  try {
    const db = await openDB()

    return readVaultEntries(db, vaultId).then(
      (entries) => {
        const map = new Map<string, SavedVersionData>()
        for (const entry of entries) {
          if (entry.localVersion !== undefined || entry.localHash) {
            map.set(entry.relativePath, {
              localVersion: entry.localVersion,
              localHash: entry.localHash,
              hashStamp:
                entry.localHash && entry.hashSize !== undefined && entry.hashMtimeMs !== undefined
                  ? { size: entry.hashSize, mtimeMs: entry.hashMtimeMs }
                  : undefined,
            })
          }
        }
        log.info(
          '[SyncIndex]',
          `Loaded version map: ${map.size} entries with version/hash data for vault ${vaultId}`,
        )
        return map
      },
      (error: unknown) => {
        log.error('[SyncIndex]', 'Failed to read version map', { error })
        return new Map()
      },
    )
  } catch (error) {
    log.error('[SyncIndex]', 'Error reading version map', { error })
    return new Map()
  }
}

/**
 * Get statistics about the sync index for a vault.
 * Useful for debugging and UI display.
 */
export async function getSyncIndexStats(
  vaultId: string,
): Promise<{ count: number; oldestSync: number | null; newestSync: number | null }> {
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('vaultId')
      const request = index.getAll(IDBKeyRange.only(vaultId))

      request.onsuccess = () => {
        const entries = request.result as SyncIndexEntry[]
        if (entries.length === 0) {
          resolve({ count: 0, oldestSync: null, newestSync: null })
          return
        }

        let oldest = entries[0].lastSyncedAt
        let newest = entries[0].lastSyncedAt

        for (const entry of entries) {
          if (entry.lastSyncedAt < oldest) oldest = entry.lastSyncedAt
          if (entry.lastSyncedAt > newest) newest = entry.lastSyncedAt
        }

        resolve({
          count: entries.length,
          oldestSync: oldest,
          newestSync: newest,
        })
      }

      request.onerror = () => {
        resolve({ count: 0, oldestSync: null, newestSync: null })
      }
    })
  } catch (error) {
    log.error('[SyncIndex]', 'Error getting stats', { error })
    return { count: 0, oldestSync: null, newestSync: null }
  }
}
