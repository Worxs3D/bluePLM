/**
 * Ghost directory selection: empty local directories whose server folder was deleted.
 *
 * The merge creates every explicit server folder on disk (`useLoadFiles.ts`'s
 * server-folder pass), so a folder someone creates empty in BluePLM appears on every
 * machine as an empty directory. When it is deleted, the `folders` row is soft-deleted
 * and the realtime handler schedules a refresh, but the only directory cleanup there is
 * (`orphanedDirectories.ts`) nominates a directory only when files were recycled out of
 * it. A folder that never held a file has none, so the empty directory stayed on every
 * other machine for good and showed as a local-only folder nobody created.
 *
 * The evidence used here is the soft-deleted `folders` row itself, which the server
 * keeps: a directory is a ghost only if it is empty in the store, no live folder row
 * or server file asserts it, a deleted row exists for its exact path, and the directory
 * has not changed since that deletion. The last check keeps a folder someone recreated
 * locally after the delete: its mtime is newer than `deleted_at`.
 *
 * Pure - no fs, IPC, store or network. The caller hands the result to
 * `window.electronAPI.trashEmptyDirs`, which re-checks unfiltered emptiness and vault
 * containment in the main process before recycling anything.
 */

import type { LocalFile } from '@/stores/types'

/** A soft-deleted `folders` row, as much of it as the selection needs. */
export interface DeletedFolderRecord {
  folder_path: string
  deleted_at: string
}

/** Every ancestor of a vault-relative path, the path's own last segment and the root excluded. */
function ancestorsOf(relativePath: string): string[] {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  const ancestors: string[] = []
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('/'))
  }
  return ancestors
}

/**
 * Directories on disk that nothing holds open: no file row anywhere beneath them, and
 * neither they nor any folder beneath them is asserted by the server (`serverFolderPaths`
 * covers live `folders` rows and folders implied by server file paths). Compared without
 * regard to case, as every other folder lookup is.
 */
export function getUnassertedEmptyDirectories(
  files: readonly LocalFile[],
  serverFolderPaths: ReadonlySet<string>,
): LocalFile[] {
  const held = new Set<string>()
  for (const file of files) {
    if (file.isDirectory) continue
    for (const ancestor of ancestorsOf(file.relativePath)) held.add(ancestor.toLowerCase())
  }
  for (const folderPath of serverFolderPaths) {
    held.add(folderPath.replace(/\\/g, '/').toLowerCase())
    for (const ancestor of ancestorsOf(folderPath)) held.add(ancestor.toLowerCase())
  }

  return files.filter(
    (file) =>
      file.isDirectory &&
      file.diffStatus !== 'cloud' &&
      !held.has(file.relativePath.replace(/\\/g, '/').toLowerCase()),
  )
}

/**
 * The candidates a soft-deleted folder row accounts for. A candidate with no deleted
 * row, or one whose mtime is unreadable or later than the most recent deletion of its
 * path, is kept: missing a ghost leaves an empty folder, removing a live one loses the
 * user's folder.
 */
export function selectGhostDirectories(
  candidates: readonly LocalFile[],
  deletedFolders: readonly DeletedFolderRecord[],
): LocalFile[] {
  const latestDeletion = new Map<string, number>()
  for (const row of deletedFolders) {
    const deletedAt = Date.parse(row.deleted_at)
    if (Number.isNaN(deletedAt)) continue
    const key = row.folder_path.replace(/\\/g, '/').toLowerCase()
    if (deletedAt > (latestDeletion.get(key) ?? -Infinity)) latestDeletion.set(key, deletedAt)
  }

  return candidates.filter((candidate) => {
    const deletedAt = latestDeletion.get(candidate.relativePath.replace(/\\/g, '/').toLowerCase())
    if (deletedAt === undefined) return false
    const modifiedAt = Date.parse(candidate.modifiedTime)
    return !Number.isNaN(modifiedAt) && modifiedAt <= deletedAt
  })
}
