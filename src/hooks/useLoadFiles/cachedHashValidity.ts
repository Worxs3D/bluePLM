import type { HashStamp, SavedVersionData } from '@/lib/cache/localSyncIndex'
import type { LocalFile } from '@/stores/types'

type DiskStat = Pick<LocalFile, 'size' | 'modifiedTime'>
type HashedRow = Pick<LocalFile, 'relativePath' | 'isDirectory' | 'size' | 'modifiedTime'> & {
  localHash?: string
}

/** The stamp for a file's current size and modified time, or undefined if the time is unreadable. */
export function stampOf(file: DiskStat): HashStamp | undefined {
  const mtimeMs = new Date(file.modifiedTime).getTime()
  if (Number.isNaN(mtimeMs)) return undefined
  return { size: file.size, mtimeMs }
}

/**
 * The size and modified time each cached hash was computed from, keyed by lowercase relative
 * path: the sync index's stamps (cold start), overlaid by the store's rows (warm reload).
 *
 * A load reuses the hash it already holds instead of re-reading the file. That is only true
 * while the file on disk is the one that was hashed: a save in SolidWorks while the file was
 * checked out kept the pre-edit hash, which still equals the server's, so the row stayed "2/2"
 * until check-in re-hashed it. The reverse also happened - a hash taken from content that was
 * later replaced kept a synced file amber until a check-out/check-in cycle re-hashed it.
 */
export function buildHashStamps(
  saved: ReadonlyMap<string, SavedVersionData>,
  rows: readonly HashedRow[],
): Map<string, HashStamp> {
  const stamps = new Map<string, HashStamp>()
  for (const [relPath, data] of saved) {
    if (data.localHash && data.hashStamp) stamps.set(relPath.toLowerCase(), data.hashStamp)
  }
  for (const row of rows) {
    if (row.isDirectory || !row.localHash) continue
    const stamp = stampOf(row)
    const key = row.relativePath.toLowerCase()
    if (stamp) stamps.set(key, stamp)
    else stamps.delete(key)
  }
  return stamps
}

/**
 * What a load may do with the hash it has cached for a file.
 *
 * - `trusted`: the stamp matches the file on disk, so the hash is still true of it.
 * - `stale`: the file changed since it was hashed. The hash is dropped and the file re-hashed.
 * - `unverified`: no stamp (a sync index entry written before stamps existed, or a row whose
 *   time could not be read). The hash still decides the first status shown, as it always did,
 *   but the file is re-hashed in the background and the hash is never stamped as if checked.
 * - `none`: nothing cached.
 */
export type CachedHashVerdict = 'trusted' | 'stale' | 'unverified' | 'none'

export function judgeCachedHash(
  cachedHash: string | undefined,
  stamp: HashStamp | undefined,
  scanned: DiskStat,
): CachedHashVerdict {
  if (!cachedHash) return 'none'
  if (!stamp) return 'unverified'
  const now = stampOf(scanned)
  if (!now) return 'stale'
  return stamp.size === now.size && stamp.mtimeMs === now.mtimeMs ? 'trusted' : 'stale'
}
