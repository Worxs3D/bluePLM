/**
 * Writing BluePLM's values into documents nobody has checked out: check out, write, check in.
 *
 * Sync Metadata only touches a file that is local-only or checked out by you, and that rule stays
 * where it is. A vault-wide audit routinely finds hundreds of files that need a write and none of
 * them checked out, and asking an administrator to check each one out in the file browser first
 * made the write button a dead end. This runs the same three commands a person would, in order,
 * through the same command layer, so every guard each of them has still applies:
 *
 * 1. **Check out** the ticked files nobody holds. The checkout command decides who gets the lock;
 *    a file it could not lock (a colleague got there first, read-only on disk) is read back from the
 *    store as not ours and is left out of the write.
 * 2. **Write** every file now ours with Sync Metadata, revision omitted as always.
 * 3. **Check in** only the files step 1 checked out, when asked to. Files you already had checked
 *    out are left as they were, because they may carry work of yours that is not ready. A file
 *    whose write failed is unchanged, and checking it in releases the lock without a new version.
 *
 * Without step 3 the fix would exist only on this machine, and the vault would be left with every
 * file checked out to the administrator.
 *
 * The commands are injected so the order and the bookkeeping can be pinned in a test.
 */

import type { LocalFile } from '@/stores/pdmStore'

export interface CheckoutWriteDeps {
  checkout: (files: LocalFile[]) => Promise<unknown>
  syncMetadata: (files: LocalFile[]) => Promise<unknown>
  checkin: (files: LocalFile[]) => Promise<unknown>
  /** The store's files as they are now, read after each command. */
  currentFiles: () => readonly LocalFile[]
  setCheckinNote: (path: string, note: string) => void
}

export interface CheckoutWriteInput {
  /** Files already writable: local-only, or checked out by this user. */
  writable: readonly LocalFile[]
  /** Files in BluePLM that nobody holds. */
  checkoutable: readonly LocalFile[]
  userId: string
  checkInAfter: boolean
  /** Version note for the files this run checks in. A note the file already carries is kept. */
  checkinNote: string
}

export interface CheckoutWriteOutcome {
  /** Ids of every file handed to Sync Metadata. */
  written: string[]
  /** Ids this run checked out. */
  checkedOut: string[]
  /** Ids the checkout did not give us, so they were not written. */
  notCheckedOut: string[]
  /** Ids this run checked back in. */
  checkedIn: string[]
}

function idOf(file: LocalFile): string | null {
  return file.pdmData?.id ?? null
}

/** The store's current row for each file, matched on the database id, else on the path. */
function freshRows(files: readonly LocalFile[], current: readonly LocalFile[]): LocalFile[] {
  const byId = new Map<string, LocalFile>()
  const byPath = new Map<string, LocalFile>()
  for (const file of current) {
    const id = idOf(file)
    if (id && file.diffStatus !== 'moved_away') byId.set(id, file)
    byPath.set(file.path, file)
  }
  return files.map((file) => {
    const id = idOf(file)
    return (id ? byId.get(id) : undefined) ?? byPath.get(file.path) ?? file
  })
}

export async function writeWithCheckout(
  input: CheckoutWriteInput,
  deps: CheckoutWriteDeps,
): Promise<CheckoutWriteOutcome> {
  const checkedOut: LocalFile[] = []
  const notCheckedOut: string[] = []

  if (input.checkoutable.length > 0) {
    await deps.checkout([...input.checkoutable])
    for (const file of freshRows(input.checkoutable, deps.currentFiles())) {
      const id = idOf(file)
      if (!id) continue
      if (file.pdmData?.checked_out_by === input.userId) checkedOut.push(file)
      else notCheckedOut.push(id)
    }
  }

  const toWrite = [...freshRows(input.writable, deps.currentFiles()), ...checkedOut]
  const outcome: CheckoutWriteOutcome = {
    written: toWrite.map(idOf).filter((id): id is string => id !== null),
    checkedOut: checkedOut.map(idOf).filter((id): id is string => id !== null),
    notCheckedOut,
    checkedIn: [],
  }
  if (toWrite.length === 0) return outcome

  await deps.syncMetadata(toWrite)

  if (!input.checkInAfter || checkedOut.length === 0) return outcome

  const toCheckin = freshRows(checkedOut, deps.currentFiles())
  for (const file of toCheckin) {
    if (!file.pendingCheckinNote) deps.setCheckinNote(file.path, input.checkinNote)
  }
  await deps.checkin(freshRows(toCheckin, deps.currentFiles()))
  outcome.checkedIn = outcome.checkedOut
  return outcome
}
