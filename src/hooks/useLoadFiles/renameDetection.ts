import type { PDMFile } from '@/types/pdm'
import type { ScannedLocalFile } from './mergeLocalFile'

/** Enough resolved renames to recognise the pattern without logging all of them. */
const RENAME_LOG_SAMPLE_LIMIT = 5

export type ComputeFileHashes = (
  requests: Array<{ path: string; relativePath: string; size: number; mtime: number }>,
) => Promise<{ results?: Array<{ relativePath: string; hash: string }> }>

/**
 * Hashes the unmatched local files that could be a renamed checked-out-by-me file, so the merge's
 * content-hash move detection can match them.
 *
 * A file renamed externally (e.g. a SolidWorks tree rename) has no cached hash at its new path.
 * Only checked-out-by-me records missing locally can be the source of a rename, and a rename keeps
 * the size, so only local files whose size matches one of those records are hashed: the Blue
 * Robotics vault was hashing 691 files against 7 candidates on every load, for ~1.3s and zero
 * matches. Without server sizes the size filter is skipped, so older records still get detection.
 */
export async function hashRenameCandidates<T extends ScannedLocalFile>(
  localFiles: T[],
  pdmMap: ReadonlyMap<string, PDMFile>,
  localPathSet: ReadonlySet<string>,
  checkedOutByMeByHash: ReadonlyMap<string, PDMFile>,
  computeFileHashes: ComputeFileHashes,
): Promise<T[]> {
  const missingServerPaths = new Set<string>()
  const missingServerSizes = new Set<number>()
  for (const [, pdmFile] of checkedOutByMeByHash) {
    if (!localPathSet.has(pdmFile.file_path.toLowerCase())) {
      missingServerPaths.add(pdmFile.file_path.toLowerCase())
      if (typeof pdmFile.file_size === 'number') {
        missingServerSizes.add(pdmFile.file_size)
      }
    }
  }

  const canFilterBySize = missingServerSizes.size > 0
  const unmatchedLocalFiles = localFiles.filter(
    (f) =>
      !f.isDirectory &&
      !f.localHash &&
      !pdmMap.has(f.relativePath.toLowerCase()) &&
      (!canFilterBySize || missingServerSizes.has(f.size)),
  )

  if (unmatchedLocalFiles.length === 0 || missingServerPaths.size === 0) return localFiles

  window.electronAPI?.log(
    'info',
    '[LoadFiles] Rename detection: computing hashes for unmatched local files',
    {
      unmatchedLocal: unmatchedLocalFiles.length,
      missingServer: missingServerPaths.size,
      sizeFiltered: canFilterBySize,
      unmatchedSamples: unmatchedLocalFiles.slice(0, 3).map((f) => f.relativePath),
      missingSamples: Array.from(missingServerPaths).slice(0, 3),
    },
  )

  const hashRequests = unmatchedLocalFiles.map((f) => ({
    path: f.path,
    relativePath: f.relativePath,
    size: f.size,
    mtime: new Date(f.modifiedTime).getTime(),
  }))

  try {
    const { results } = await computeFileHashes(hashRequests)
    if (!results || results.length === 0) return localFiles
    const hashMap = new Map(results.map((r) => [r.relativePath, r.hash]))
    let renameMatchCount = 0
    const hashed = localFiles.map((f) => {
      const computed = hashMap.get(f.relativePath)
      if (!computed) return f
      if (checkedOutByMeByHash.has(computed)) renameMatchCount++
      return { ...f, localHash: computed }
    })
    window.electronAPI?.log('info', '[LoadFiles] Rename detection: hashes computed', {
      hashesComputed: results.length,
      renameMatchesFound: renameMatchCount,
    })
    return hashed
  } catch (error) {
    window.electronAPI?.log('warn', '[LoadFiles] Rename detection: hash computation failed', {
      error: String(error),
    })
    return localFiles
  }
}

export interface InodeRenames {
  /** Local file's lowercase path -> the server row it was renamed from. */
  inodeRenameMap: Map<string, PDMFile>
  /** Old server paths (lowercase) claimed by an inode match. */
  inodeMatchedServerPaths: Set<string>
  /**
   * Old server path (lowercase) -> the local path that claimed it, so the cloud-file
   * reconciliation can emit a 'moved_away' stub naming its destination.
   */
  inodeMatchedServerPathToLocalPath: Map<string, string>
}

/**
 * Matches "new" local files to "missing" server rows by NTFS file index, which persists across
 * renames on the same volume, including a file modified and then renamed where hashes differ.
 *
 * Not restricted to checked-out-by-me files: MFT indices are per-machine and file-unique, so false
 * positives are very unlikely, and the restriction caused ghost/orphan pairs after a check-in that
 * updated the server path and released the checkout. `savedInodeMap` holds every path recorded for
 * an inode; each is tried, to cope with stale duplicates from the old updateInodes upsert bug.
 */
export function detectInodeRenames(
  localFiles: readonly ScannedLocalFile[],
  pdmMap: ReadonlyMap<string, PDMFile>,
  localPathSet: ReadonlySet<string>,
  savedInodeMap: ReadonlyMap<number, string[]>,
): InodeRenames {
  const renames: InodeRenames = {
    inodeRenameMap: new Map(),
    inodeMatchedServerPaths: new Set(),
    inodeMatchedServerPathToLocalPath: new Map(),
  }
  if (savedInodeMap.size === 0) return renames

  const inodeToServerFile = new Map<number, PDMFile>()
  for (const [ino, oldRelativePaths] of savedInodeMap) {
    for (const oldRelativePath of oldRelativePaths) {
      const pdmFile = pdmMap.get(oldRelativePath)
      if (pdmFile && !localPathSet.has(oldRelativePath)) {
        inodeToServerFile.set(ino, pdmFile)
        break
      }
    }
  }
  if (inodeToServerFile.size === 0) return renames

  let checkedOutRenameCount = 0
  for (const localFile of localFiles) {
    if (localFile.isDirectory || !localFile.ino || localFile.ino === 0) continue
    if (pdmMap.has(localFile.relativePath.toLowerCase())) continue

    const serverFile = inodeToServerFile.get(localFile.ino)
    if (serverFile) {
      renames.inodeRenameMap.set(localFile.relativePath.toLowerCase(), serverFile)
      renames.inodeMatchedServerPaths.add(serverFile.file_path.toLowerCase())
      renames.inodeMatchedServerPathToLocalPath.set(
        serverFile.file_path.toLowerCase(),
        localFile.relativePath,
      )
      inodeToServerFile.delete(localFile.ino)
      if (serverFile.checked_out_by) checkedOutRenameCount++
    }
  }

  if (renames.inodeRenameMap.size > 0) {
    // One line, not one per match: an unreconciled folder rename produces hundreds of matches
    // on every load, and each log line is an IPC call made from inside the merge.
    window.electronAPI?.log('info', '[LoadFiles] Inode rename summary', {
      matches: renames.inodeRenameMap.size,
      checkedOut: checkedOutRenameCount,
      remainingUnresolved: inodeToServerFile.size,
      samples: Array.from(renames.inodeRenameMap.entries())
        .slice(0, RENAME_LOG_SAMPLE_LIMIT)
        .map(([newPath, serverFile]) => `${serverFile.file_path} -> ${newPath}`),
    })
  }
  return renames
}
