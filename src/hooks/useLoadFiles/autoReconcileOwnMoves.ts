import type { LocalFile } from '@/stores/types'

/**
 * Moves already handed to the server in this session, as `files.id|destination`. A write that
 * keeps failing (the RPC refuses it, the network is down) is tried once per move rather than on
 * every load, and the row stays a pending move for the user to resolve.
 */
const attemptedMoves = new Set<string>()

/** Sessions run for weeks; past this many the record starts over rather than growing. */
const ATTEMPTED_MOVES_LIMIT = 1_000

function moveKey(file: LocalFile): string {
  return `${file.pdmData?.id}|${file.relativePath.toLowerCase()}`
}

/**
 * Rows the store showed at their own server path, with the file on disk, before a load: a file
 * that then turns up somewhere else was moved from where the server has it. A row that was
 * already a pending move (a server-side move this machine had not followed, its stub, or a cloud
 * row) is not one: writing its new local path would undo another machine's move.
 */
export function rowsSettledAtServerPath(files: readonly LocalFile[]): Set<string> {
  const settled = new Set<string>()
  for (const file of files) {
    if (file.isDirectory) continue
    const row = file.pdmData
    if (!row?.id || !row.file_path) continue
    if (file.diffStatus === 'moved' || file.diffStatus === 'moved_away') continue
    if (file.diffStatus === 'cloud') continue
    if (row.file_path.toLowerCase() !== file.relativePath.toLowerCase()) continue
    settled.add(row.id)
  }
  return settled
}

/**
 * The pending moves a load may write to the server without asking: files this user holds checked
 * out that the load recognised by NTFS file index at a new path.
 *
 * The file index is the identity and the checkout is the authority: nobody else can have moved or
 * changed the row, and the user moved the file themselves. Left pending, the move had one way out,
 * check-in, because Update the Vault refuses a row whose content no longer matches the server, and
 * a checked-out file usually has been edited. Moves found any other way (content hash, the
 * folder-and-extension ghost match, a row the server moved under this machine) and files held by
 * anyone else, or by nobody, stay pending moves, and so does a file that was a pending move before
 * this load (`rowsSettledAtServerPath`).
 *
 * Marks what it returns as attempted.
 */
export function takeOwnInodeMoves(
  files: readonly LocalFile[],
  inodeMatchedFileIds: ReadonlySet<string>,
  settledBeforeLoad: ReadonlySet<string>,
  userId: string,
): string[] {
  if (inodeMatchedFileIds.size === 0) return []

  const fileIds: string[] = []
  for (const file of files) {
    if (file.isDirectory || file.diffStatus !== 'moved') continue
    const row = file.pdmData
    if (!row?.id || !row.file_path || row.checked_out_by !== userId) continue
    if (!inodeMatchedFileIds.has(row.id) || !settledBeforeLoad.has(row.id)) continue
    if (row.file_path.toLowerCase() === file.relativePath.toLowerCase()) continue

    const key = moveKey(file)
    if (attemptedMoves.has(key)) continue
    fileIds.push(row.id)
  }

  if (fileIds.length === 0) return []
  if (attemptedMoves.size + fileIds.length > ATTEMPTED_MOVES_LIMIT) attemptedMoves.clear()
  const taken = new Set(fileIds)
  for (const file of files) {
    if (file.diffStatus === 'moved' && file.pdmData?.id && taken.has(file.pdmData.id)) {
      attemptedMoves.add(moveKey(file))
    }
  }
  return fileIds
}

/** For tests: forget which moves were attempted. */
export function resetAttemptedOwnMoves(): void {
  attemptedMoves.clear()
}
