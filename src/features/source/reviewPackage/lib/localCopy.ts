/**
 * What the requester's own copy of a file says about the version going into a package. The package
 * always pins a checked-in version; these warnings exist so nobody sends v4 for review while v5's
 * edits sit unchecked-in on their disk (audit H10).
 */

import type { LocalFile } from '@/stores/types'

export type LocalCopyWarning =
  /** The requester has it checked out: their working copy may hold edits not in any version. */
  | 'checked_out_by_me'
  /** Someone else has it checked out: a newer version may be on its way. */
  | 'checked_out_by_other'
  /** The local file differs from the server's latest version. */
  | 'modified'
  /** A later version than the one pinned has been checked in. */
  | 'older_version'

type LocalCopyFields = Pick<LocalFile, 'diffStatus' | 'pdmData'>

export function localCopyWarnings(
  local: LocalCopyFields | undefined,
  userId: string | null,
  pinnedVersion: number,
  latestVersion: number,
): LocalCopyWarning[] {
  const warnings: LocalCopyWarning[] = []
  const holder = local?.pdmData?.checked_out_by ?? null
  if (holder && holder === userId) warnings.push('checked_out_by_me')
  else if (holder) warnings.push('checked_out_by_other')
  if (local?.diffStatus === 'modified') warnings.push('modified')
  if (pinnedVersion < latestVersion) warnings.push('older_version')
  return warnings
}

/** Files in a selection that can go into a package: synced files, not folders or move stubs. */
export function reviewableFiles(files: readonly LocalFile[]): LocalFile[] {
  return files.filter(
    (f) =>
      !f.isDirectory &&
      !!f.pdmData?.id &&
      f.diffStatus !== 'moved_away' &&
      f.diffStatus !== 'deleted_remote',
  )
}
