import type { HashStamp, SyncIndexPathInfo } from '@/lib/cache/localSyncIndex'
import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'
import { judgeCachedHash, stampOf } from './cachedHashValidity'

/**
 * The rules that decide a local file's `diffStatus` and the version shown for it.
 *
 * The full load, the folder refresh and the background hash pass all classify through these
 * functions. Each used to carry its own copy of the rules, and the copies drifted: the hash pass
 * dropped a file's 'moved' badge and its pending-metadata 'modified' status, and the folder
 * refresh never stamped the server version onto a file whose hash matched.
 */

/**
 * Without a hash, a file checked out by this user counts as edited only when its modified time
 * is this much newer than the server row, so the server's own write time does not read as an edit.
 */
export const MODIFIED_TOLERANCE_MS = 5000

/** The server row facts the classification reads. */
export type ServerRowFacts = Pick<
  PDMFile,
  'content_hash' | 'updated_at' | 'version' | 'checked_out_by'
>

export type ServerRowStatus = 'modified' | 'outdated' | 'moved' | undefined
export type UntrackedStatus = 'ignored' | 'deleted_remote' | 'added'

export interface ServerRowClassificationInput {
  row: ServerRowFacts
  /** The file sits at a path the server does not record for it yet (a move awaiting check-in). */
  moved: boolean
  /** The hash of the file on disk, when one is known to describe it. */
  localHash: string | undefined
  modifiedTime: string
  /** The version tracked as being on disk before this pass. */
  localVersion: number | undefined
  userId: string | undefined
  /** Unsaved metadata edits: the file needs a check-in whatever its content says. */
  hasPendingMetadata: boolean
}

export interface ServerRowClassification {
  diffStatus: ServerRowStatus
  localVersion: number | undefined
}

function timeMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0
}

/** Which side changed when the hashes differ: the newer write wins. */
function newerSide(modifiedTime: string, serverUpdatedAt: string | null): 'modified' | 'outdated' {
  return new Date(modifiedTime).getTime() > timeMs(serverUpdatedAt) ? 'modified' : 'outdated'
}

/**
 * Status of a local file that has a server row.
 *
 * With both hashes, the hashes decide. Without a local hash, the tracked local version decides
 * outdated, and only a checked-out-by-me file whose modified time is clearly newer counts as
 * modified; anything else stays synced until the background hash pass reads the disk. Timestamps
 * alone never mark a file outdated: unrelated server activity bumps `updated_at`.
 *
 * `localVersion` takes the server version only when the hashes verifiably match. It is never
 * stamped without disk evidence, which is how a file once showed "2/2" over older content.
 */
export function classifyAgainstServerRow(
  input: ServerRowClassificationInput,
): ServerRowClassification {
  const { row, localHash, modifiedTime, localVersion } = input
  let diffStatus: ServerRowStatus

  if (input.moved) {
    diffStatus = 'moved'
  } else if (row.content_hash && localHash) {
    if (row.content_hash !== localHash) {
      diffStatus = newerSide(modifiedTime, row.updated_at)
    }
  } else if (row.content_hash) {
    const localModTime = new Date(modifiedTime).getTime()
    const editedWhileCheckedOut =
      row.checked_out_by === input.userId &&
      localModTime > timeMs(row.updated_at) + MODIFIED_TOLERANCE_MS
    if (localVersion !== undefined && row.version !== undefined) {
      if (localVersion < row.version) {
        diffStatus = 'outdated'
      } else if (localVersion === row.version && editedWhileCheckedOut) {
        diffStatus = 'modified'
      }
      // A local version above the server's should not happen; the status is left alone.
    } else if (editedWhileCheckedOut) {
      diffStatus = 'modified'
    }
  }

  // Pending metadata is a change the hash cannot see, so it wins over every status above.
  if (input.hasPendingMetadata) diffStatus = 'modified'

  const syncedWithServer =
    !diffStatus && !!row.content_hash && !!localHash && row.content_hash === localHash
  return {
    diffStatus,
    localVersion:
      syncedWithServer && !(localVersion !== undefined && localVersion >= row.version)
        ? row.version
        : localVersion,
  }
}

export interface UntrackedClassificationInput {
  ignored: boolean
  /** The sync index entry for the path: present when the file was synced before. */
  syncIndexEntry: SyncIndexPathInfo | undefined
  modifiedTime: string
}

export interface UntrackedClassification {
  diffStatus: UntrackedStatus
  /**
   * The orphan's file was written after its server row was first seen gone, so it may hold work
   * that exists nowhere else. Read by the auto-discard, which keeps such files.
   */
  editedSinceOrphaned: boolean
}

/**
 * Status of a local file with no server row: ignored, an orphan whose row another user deleted
 * (the sync index remembers it was synced), or new.
 */
export function classifyWithoutServerRow(
  input: UntrackedClassificationInput,
): UntrackedClassification {
  if (input.ignored) return { diffStatus: 'ignored', editedSinceOrphaned: false }
  const entry = input.syncIndexEntry
  if (!entry) return { diffStatus: 'added', editedSinceOrphaned: false }
  if (entry.orphanedAt === undefined) {
    return { diffStatus: 'deleted_remote', editedSinceOrphaned: false }
  }
  const modifiedTimeMs = new Date(input.modifiedTime).getTime()
  // An unreadable mtime can't prove the file is untouched, so it is treated the same as a
  // provably-later one: possibly edited, kept.
  return {
    diffStatus: 'deleted_remote',
    editedSinceOrphaned: Number.isNaN(modifiedTimeMs) || modifiedTimeMs > entry.orphanedAt,
  }
}

export interface LocalHashResolution {
  localHash: string | undefined
  /** The cached hash is stale or unverified: hash the file again and never stamp the cached one. */
  rehash: boolean
}

/**
 * The hash a load may use for a file: the scan's own, else a cached one that is still true of the
 * file on disk (see cachedHashValidity.ts). An unverified hash is used but re-checked.
 */
export function resolveLocalHash(
  scannedHash: string | undefined,
  cachedHash: string | undefined,
  cachedStamp: HashStamp | undefined,
  file: Pick<LocalFile, 'size' | 'modifiedTime'>,
): LocalHashResolution {
  if (scannedHash) return { localHash: scannedHash, rehash: false }
  const verdict = judgeCachedHash(cachedHash, cachedStamp, file)
  return {
    localHash: verdict === 'stale' ? undefined : cachedHash,
    rehash: verdict === 'stale' || verdict === 'unverified',
  }
}

/** Rows that stand for a file on disk. Cloud rows and moved-away stubs have nothing to hash. */
export function hasLocalContent(file: Pick<LocalFile, 'diffStatus'>): boolean {
  return (
    file.diffStatus !== 'cloud' &&
    file.diffStatus !== 'deleted' &&
    file.diffStatus !== 'moved_away'
  )
}

function hasPendingMetadata(file: Pick<LocalFile, 'pendingMetadata'>): boolean {
  return !!file.pendingMetadata && Object.keys(file.pendingMetadata).length > 0
}

/**
 * A store row re-classified with a hash just computed from disk, or `undefined` when the hash
 * does not apply to it.
 *
 * `hashedFrom` is the size and modified time the hash request was made with. A reload during
 * hashing may already hold a newer copy of the file; the hash describes the copy that was read,
 * so it is not applied to another.
 */
export function classifyWithComputedHash(
  file: LocalFile,
  computedHash: string,
  hashedFrom: HashStamp | undefined,
  userId: string | undefined,
): LocalFile | undefined {
  if (file.isDirectory || !hasLocalContent(file)) return undefined
  const current = stampOf(file)
  if (
    !hashedFrom ||
    !current ||
    hashedFrom.size !== current.size ||
    hashedFrom.mtimeMs !== current.mtimeMs
  ) {
    return undefined
  }

  if (!file.pdmData?.content_hash) return { ...file, localHash: computedHash }

  const { diffStatus, localVersion } = classifyAgainstServerRow({
    row: file.pdmData,
    moved: file.diffStatus === 'moved',
    localHash: computedHash,
    modifiedTime: file.modifiedTime,
    localVersion: file.localVersion,
    userId,
    hasPendingMetadata: hasPendingMetadata(file),
  })
  return { ...file, localHash: computedHash, diffStatus, localVersion }
}

/**
 * The files the background hash pass reads from disk.
 *
 * A normal load hashes only files with a server hash and no local hash that it has either never
 * tracked a version for (first sight: without a hash the merge would have to guess synced) or
 * whose cached hash was stale or unverified. A full refresh re-hashes every file with a server hash.
 */
export function selectFilesNeedingHash(
  localFiles: readonly LocalFile[],
  rehashPaths: ReadonlySet<string>,
  forceHashComputation: boolean,
): LocalFile[] {
  return localFiles.filter(
    (f) =>
      !f.isDirectory &&
      hasLocalContent(f) &&
      !!f.pdmData?.content_hash &&
      (forceHashComputation ||
        (!f.localHash && (f.localVersion === undefined || rehashPaths.has(f.relativePath)))),
  )
}
