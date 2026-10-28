/**
 * Merge the dependency closures of several review items into one package file list.
 *
 * Pure. Rules:
 * - One entry per file version. A version reached by several items or edges is listed once; it is
 *   exact when any edge reached it exactly, and a review item when any closure has it at depth 0.
 * - One version per vault path. Two items can need different versions of the same part, but a
 *   folder holds one file per path, so one wins: a review item first, then an exact edge, then the
 *   higher version. The other is reported as a conflict, and the package is not exact.
 * - A row with no resolved version (out of the vault, toolbox, deleted with no version) is a
 *   missing reference, never silently dropped.
 */

import type { DependencyClosureRow } from '@/types/reviews'

import { packageRelativePath } from './layout'
import type { MergedClosure, MissingReference, PackageFile, VersionConflict } from './types'

// Keyed by where the file lands in the package, not by the raw vault path: two paths that differ
// only in case, or that sanitize to the same name, would otherwise be written to one file by two
// concurrent downloads on Windows. They resolve like two versions of one path.
function pathKey(path: string): string {
  return packageRelativePath(path).toLowerCase()
}

function fileNameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

/** Whether `a` should take a vault path over `b`. */
function wins(a: PackageFile, b: PackageFile): boolean {
  if (a.isRoot !== b.isRoot) return a.isRoot
  if (a.exact !== b.exact) return a.exact
  return (a.version ?? -1) > (b.version ?? -1)
}

export function mergeClosures(
  closures: ReadonlyArray<ReadonlyArray<DependencyClosureRow>>,
): MergedClosure {
  const byVersion = new Map<string, PackageFile>()
  const pathOfVersion = new Map<string, string>()
  const missingRows: DependencyClosureRow[] = []

  for (const rows of closures) {
    for (const row of rows) {
      if (row.fileVersionId && row.filePath) pathOfVersion.set(row.fileVersionId, row.filePath)

      if (row.missing || !row.fileVersionId || !row.contentHash || !row.filePath) {
        if (row.depth > 0) missingRows.push(row)
        continue
      }

      const existing = byVersion.get(row.fileVersionId)
      if (existing) {
        existing.exact = existing.exact || row.exact
        existing.isRoot = existing.isRoot || row.depth === 0
        continue
      }

      byVersion.set(row.fileVersionId, {
        fileVersionId: row.fileVersionId,
        fileId: row.fileId,
        filePath: row.filePath.replace(/\\/g, '/').replace(/^\/+/, ''),
        fileName: row.fileName || fileNameOf(row.filePath),
        version: row.version,
        revision: row.revision,
        contentHash: row.contentHash,
        fileSize: row.fileSize ?? 0,
        exact: row.exact || row.depth === 0,
        isRoot: row.depth === 0,
        deleted: row.deleted,
      })
    }
  }

  // One version per path.
  const byPath = new Map<string, PackageFile>()
  const conflicts: VersionConflict[] = []
  for (const file of byVersion.values()) {
    const key = pathKey(file.filePath)
    const current = byPath.get(key)
    if (!current) {
      byPath.set(key, file)
      continue
    }
    const [kept, dropped] = wins(file, current) ? [file, current] : [current, file]
    byPath.set(key, kept)
    conflicts.push({
      filePath: kept.filePath,
      keptFileVersionId: kept.fileVersionId,
      keptVersion: kept.version,
      droppedFileVersionId: dropped.fileVersionId,
      droppedVersion: dropped.version,
    })
  }

  // Review items first, then by path, so the manifest reads top-down.
  const files = [...byPath.values()].sort((a, b) => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1
    return pathKey(a.filePath).localeCompare(pathKey(b.filePath))
  })

  const missing: MissingReference[] = []
  const seenMissing = new Set<string>()
  for (const row of missingRows) {
    const referencePath = row.referencePath || row.filePath || row.fileName || ''
    const key = `${pathKey(referencePath)}|${row.parentVersionId ?? ''}`
    if (seenMissing.has(key)) continue
    seenMissing.add(key)
    missing.push({
      referencePath,
      parentPath: row.parentVersionId ? (pathOfVersion.get(row.parentVersionId) ?? null) : null,
      parentVersionId: row.parentVersionId,
      referenceType: row.referenceType,
    })
  }

  return {
    files,
    missing,
    conflicts,
    exact: missing.length === 0 && conflicts.length === 0 && files.every((f) => f.exact),
    totalBytes: files.reduce((sum, f) => sum + f.fileSize, 0),
  }
}

/** Files that share content: the first of each hash is downloaded, the rest copied from it. */
export function groupByContentHash(files: ReadonlyArray<PackageFile>): PackageFile[][] {
  const groups = new Map<string, PackageFile[]>()
  for (const file of files) {
    const group = groups.get(file.contentHash)
    if (group) group.push(file)
    else groups.set(file.contentHash, [file])
  }
  return [...groups.values()]
}
