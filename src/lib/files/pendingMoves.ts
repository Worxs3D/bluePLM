/**
 * Counting pending moves per folder.
 *
 * A pending move shows as two rows: the file at its new path (`moved`) and a `moved_away` stub
 * at the path the server still records. A folder that holds both rows holds one move, not two,
 * so the stub counts only in folders the file itself is not under. The dialog the badge opens
 * lists moves, not rows, and the badge has to agree with it.
 */

import type { LocalFile } from '@/stores/types'

/**
 * Whether a `moved_away` stub adds a pending move to `folderPath` ('' is the vault root).
 * False when the stub's destination is inside the folder too: the `moved` row already counts it
 * there. A stub with no destination counts, so a move is never hidden.
 */
export function stubCountsAsMoveIn(
  stub: Pick<LocalFile, 'movedToRelativePath'>,
  folderPath: string,
): boolean {
  const destination = stub.movedToRelativePath
  if (!destination) return true
  if (!folderPath) return false
  return !destination.toLowerCase().startsWith(folderPath.toLowerCase() + '/')
}
