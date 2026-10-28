// @vitest-environment jsdom
/**
 * Sequences the random runner (randomInterleavings.test.ts) found failing, shrunk by fast-check
 * and kept here once fixed, so each stays fixed. Each names the bug it caught.
 */
import { describe, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/multi/clientMock')).mockMachineClientModule(await importOriginal()),
)

import { runSequence, type Op } from './simOps'

/** `knownFailure`: still failing, with the dated reason it is not fixed yet; runs as `it.fails`. */
const saved: Array<{ name: string; ops: Op[]; knownFailure?: string }> = [
  {
    // B moved a/y.sldprt in Explorer (a pending move). The merge mirrors the committed part
    // number into pending metadata for a detected move, and realtime skipped every update to a
    // file with any pending metadata: B never saw A's check-in and kept showing A as the holder.
    name: "a pending local move does not freeze the file's realtime updates (stale holder)",
    ops: [
      { kind: 'deleteServer', on: 'A', pick: 0 },
      { kind: 'deleteServer', on: 'B', pick: 0 },
      { kind: 'explorerMove', on: 'B', pick: 0, folder: 3 },
      { kind: 'work', on: 'A', pick: 0, field: 'part_number', bytes: false },
    ],
  },
  {
    // B checked a file in, then renamed it within the 15 s after the check-in. The rename's
    // echo counted as a stale echo of the check-in and was dropped, so B's row kept the old
    // server path.
    name: 'a rename right after a check-in reaches the row',
    ops: [
      { kind: 'work', on: 'B', pick: 7, field: 'part_number', bytes: false },
      { kind: 'rename', on: 'B', pick: 7, caseOnly: false },
    ],
  },
  {
    // A moved y to the root; B moved its copy there too, then A renamed it. Realtime showed B a
    // pending move, but B's reload found no evidence of it (the sync index had no synced entry
    // at B's path, and the hash rule only takes orphans): B's copy came back as a new local file
    // and the renamed row as cloud-only. The load now also asks which row the path carried.
    name: "a reload keeps a server rename of a file this machine moved itself as a pending move",
    ops: [
      { kind: 'move', on: 'A', pick: 5, folder: 0 },
      { kind: 'move', on: 'B', pick: 1, folder: 0 },
      { kind: 'rename', on: 'A', pick: 7, caseOnly: false },
    ],
  },
  {
    // A moved top into a/; B, holding the move as pending, renamed its copy. The server row and
    // a reload agreed, but B's store kept the old stub and the 'moved' badge until a reload.
    name: 'renaming a file with a pending move settles the move in the store',
    ops: [
      { kind: 'move', on: 'A', pick: 7, folder: 1 },
      { kind: 'rename', on: 'B', pick: 7, caseOnly: false },
    ],
  },
  {
    // B moved x to the root, so A holds the move as pending; then B checked in new bytes. The
    // realtime version update turned A's 'moved' into 'outdated', which a reload turned back.
    name: 'a new version of a file with a pending move keeps it a pending move',
    ops: [
      { kind: 'move', on: 'B', pick: 0, folder: 0 },
      { kind: 'work', on: 'B', pick: 7, field: 'part_number', bytes: true },
    ],
  },
  {
    // B checked in, renamed, and checked the file out again. The echo of the rename, applied
    // after the checkout, put the row back to "not checked out", and B's check-in was refused.
    name: 'the echo of a rename does not undo a checkout made after it',
    ops: [
      { kind: 'work', on: 'B', pick: 2, field: 'part_number', bytes: false },
      { kind: 'rename', on: 'B', pick: 2, caseOnly: false },
      { kind: 'work', on: 'B', pick: 2, field: 'part_number', bytes: false },
    ],
  },
  {
    // A renamed a folder while B checked out a file in it. B's next silent load found the
    // move by hash (the file is checked out to B) and gave it no stub at the server path; the
    // load after that found it by inode and added one, so two loads disagreed.
    name: 'a move found by hash gets the same stub as one found by inode',
    ops: [
      { kind: 'renameFolder', on: 'A', folder: 0 },
      { kind: 'checkout', on: 'B', pick: 0 },
    ],
  },
  {
    // A moved a/y while B, inside its post-check-in window, checked the file out. A's move
    // waited in the realtime location queue and, applied after B's checkout, brought the row
    // as it was before the checkout: B's store showed the file free while B held it.
    name: "a queued realtime update does not undo this machine's later checkout",
    ops: [
      { kind: 'work', on: 'B', pick: 5, field: 'part_number', bytes: false },
      { kind: 'checkout', on: 'B', pick: 0 },
      { kind: 'move', on: 'A', pick: 5, folder: 0 },
      { kind: 'checkout', on: 'B', pick: 1 },
    ],
  },
  {
    // B checked in new bytes, then A renamed the folder. The echo of A's own rename carries only
    // the path, and applying it cleared A's 'outdated' (it could not verify the content).
    name: "the path-only echo of a move keeps a file's outdated status",
    ops: [
      { kind: 'work', on: 'B', pick: 2, field: 'part_number', bytes: true },
      { kind: 'wait', ms: 251 },
      { kind: 'renameFolder', on: 'A', folder: 3 },
    ],
  },
  {
    // A checked z in, lost its realtime connection and moved z. With no echo, the catch-up load
    // after the reconnect kept the old server path, because a load keeps a recently modified
    // file's row as the store had it (for Save to File) - path included.
    name: 'a load after an offline move takes the server path of a recently checked-in file',
    ops: [
      { kind: 'work', on: 'A', pick: 2, field: 'part_number', bytes: false },
      { kind: 'disconnect', on: 'A' },
      { kind: 'move', on: 'A', pick: 6, folder: 0 },
    ],
  },
  {
    // A moved a checked-out file and edited its part number (unsaved). Realtime skipped every
    // update to a file with unsaved edits, the echo of the move included, and the move command
    // leaves the server path to that echo: the row kept its old path.
    name: 'a moved file with unsaved edits still learns its new server path',
    ops: [
      { kind: 'checkout', on: 'A', pick: 6 },
      { kind: 'move', on: 'A', pick: 6, folder: 0 },
      { kind: 'metadata', on: 'A', pick: 7, field: 'part_number' },
      { kind: 'move', on: 'A', pick: 0, folder: 0 },
    ],
  },
  {
    // A moved x out of folder a on the server; B, which still had x in a, renamed a. The rename
    // command wrote the new folder path into every file's server path, x's too, though the
    // server moved only what was still in a: B showed x synced at a path the server never had.
    name: "a folder rename claims a new server path only for rows the server moves with it",
    ops: [
      { kind: 'move', on: 'A', pick: 0, folder: 0 },
      { kind: 'checkout', on: 'B', pick: 0 },
      { kind: 'renameFolder', on: 'B', folder: 0 },
    ],
  },
  {
    // B renamed a/x while A renamed folder a. A's stub was made at B's new path, a/x-r1; the
    // echo of A's own folder rename moved the server path to a-r2/x-r1 but left the stub at
    // a/x-r1, under a folder that no longer existed anywhere.
    name: 'a stub follows its server path when a folder rename moves it',
    ops: [
      { kind: 'rename', on: 'B', pick: 0, caseOnly: false },
      { kind: 'renameFolder', on: 'A', folder: 0 },
      { kind: 'move', on: 'A', pick: 1, folder: 0 },
    ],
  },
  {
    // B renamed top while A had it checked out; A then left an unsaved part number on it. The
    // live store kept the stub at top-r1; a reload gave none, because the stub was only added
    // for a claimant showing 'moved', and unsaved edits make it 'modified'.
    name: 'a moved file with unsaved edits keeps its stub across a reload',
    ops: [
      { kind: 'rename', on: 'B', pick: 7, caseOnly: false },
      { kind: 'checkout', on: 'A', pick: 7 },
      { kind: 'metadata', on: 'A', pick: 3, field: 'part_number' },
      { kind: 'work', on: 'A', pick: 0, field: 'part_number', bytes: false },
    ],
  },
  {
    // A moved y to the root; B moved its own copy there too, at the moment A's move reached it.
    // Realtime had just made B's copy a pending move with a stub at y.sldprt, and B's move put
    // the file on that same path: renameFileInStore keeps the stub, so B lists y.sldprt twice
    // until a reload.
    name: "moving a file onto its own stub's path leaves one row",
    knownFailure:
      '2026-10-25: the fix belongs in renameFileInStore (filesSlice.ts) or the move command (fileOps.ts), both past the 1,500-line limit that requires a split before adding to them.',
    ops: [
      { kind: 'move', on: 'A', pick: 0, folder: 0 },
      { kind: 'move', on: 'A', pick: 0, folder: 0 },
      { kind: 'checkout', on: 'B', pick: 0 },
      { kind: 'move', on: 'B', pick: 1, folder: 0 },
    ],
  },
  {
    // Found by a 1,000-run random-seed pass (seed -1908947084), not yet diagnosed: B works on
    // a/y, runs Re-align, A tries a check-in, B works on a/y again. B ends holding a/y on the
    // server while its store shows the file free.
    name: 'a Re-align between two check-ins leaves the holder showing',
    knownFailure: '2026-10-25: open, found by the random runner; see .cursor/plans/test-two-machines-report.md.',
    ops: [
      { kind: 'work', on: 'B', pick: 1, field: 'part_number', bytes: false },
      { kind: 'realign', on: 'B' },
      { kind: 'checkin', on: 'A', pick: 0 },
      { kind: 'work', on: 'B', pick: 1, field: 'part_number', bytes: false },
    ],
  },
  {
    // Found by a 1,000-run random-seed pass (seed 71246480), not yet diagnosed: A renames folder
    // b while B deletes from the server a file that was in it. B is left showing an empty cloud
    // folder b-r1 that neither its disk nor the server has.
    name: 'a server delete inside a folder another machine renamed leaves no ghost folder',
    knownFailure: '2026-10-25: open, found by the random runner; see .cursor/plans/test-two-machines-report.md.',
    ops: [
      { kind: 'renameFolder', on: 'A', folder: 1 },
      { kind: 'deleteServer', on: 'B', pick: 2 },
      { kind: 'hold', on: 'A' },
    ],
  },
  {
    // A renamed a folder twice. B's stubs followed to the second name and the cloud folder made
    // for the first name stayed behind, empty: a ghost folder.
    name: 'a folder renamed twice leaves no ghost of its first new name',
    ops: [
      { kind: 'renameFolder', on: 'A', folder: 0 },
      { kind: 'renameFolder', on: 'A', folder: 0 },
    ],
  },
  {
    // B moved its copy before A's folder rename reached it. The two echoes sat in different
    // realtime queues and were applied out of order, putting the older path back.
    name: 'moving a file with a pending move settles it, with no folder left behind',
    ops: [
      { kind: 'renameFolder', on: 'A', folder: 1 },
      { kind: 'move', on: 'B', pick: 2, folder: 0 },
      { kind: 'work', on: 'A', pick: 0, field: 'part_number', bytes: false },
    ],
  },
]

describe('saved random sequences', () => {
  for (const { name, ops, knownFailure } of saved) {
    ;(knownFailure ? it.fails : it)(name, async () => {
      await runSequence(ops)
    })
  }
})
