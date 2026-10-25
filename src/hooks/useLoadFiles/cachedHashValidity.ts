import type { LocalFile } from '@/stores/types'

type DiskStamp = Pick<LocalFile, 'size' | 'modifiedTime'>
type HashedRow = Pick<LocalFile, 'relativePath' | 'isDirectory' | 'size' | 'modifiedTime'> & {
  localHash?: string
}

/**
 * The size and modified time each in-memory hash was carried with, keyed by lowercase
 * relative path.
 *
 * A load reuses the hash the store already holds instead of re-reading the file. That is only
 * true while the file on disk is the one that was hashed: a save in SolidWorks while the file
 * is checked out kept the pre-edit hash, which still equals the server's, so the row stayed
 * "2/2" until check-in re-hashed it. The reverse also happened - a hash taken from content that
 * was later replaced kept a synced file amber until a check-out/check-in cycle re-hashed it.
 */
export function buildHashStamps(rows: readonly HashedRow[]): Map<string, DiskStamp> {
  const stamps = new Map<string, DiskStamp>()
  for (const row of rows) {
    if (row.isDirectory || !row.localHash) continue
    stamps.set(row.relativePath.toLowerCase(), { size: row.size, modifiedTime: row.modifiedTime })
  }
  return stamps
}

/**
 * Whether the hash cached for this path no longer describes the file on disk.
 *
 * Only an in-memory stamp can prove a hash stale. With no stamp (a hash restored from the sync
 * index on cold start) the hash is kept, as before. A stamp that cannot be compared counts as
 * stale: the cost is one re-hash, which the main process answers from its own size/mtime cache
 * when nothing changed.
 */
export function isCachedHashStale(
  stamp: DiskStamp | undefined,
  scanned: DiskStamp,
): boolean {
  if (!stamp) return false
  if (stamp.size !== scanned.size) return true
  const before = new Date(stamp.modifiedTime).getTime()
  const now = new Date(scanned.modifiedTime).getTime()
  if (Number.isNaN(before) || Number.isNaN(now)) return true
  return before !== now
}
