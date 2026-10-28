/**
 * Every user-facing command has a user journey, or a written reason why not.
 *
 * The commands are read from the `CommandId` union in `src/lib/commands/types.ts`, so a new
 * command fails this test until it is listed in JOURNEYS (with the journey that drives it through
 * the UI) or in NOT_JOURNEYED (with the reason). A journey entry names a test file in this folder
 * and a test title in it; both are checked, so a renamed or deleted journey fails here too.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const here = resolve(__dirname)
// Windows checkouts have CRLF line endings.
const typesSource = readFileSync(resolve(here, '../../lib/commands/types.ts'), 'utf8').replace(/\r\n/g, '\n')

/** Command id -> [journey file, a test title in it]. */
const JOURNEYS: Record<string, Array<[string, string]>> = {
  checkout: [['pdm.journey.test.tsx', 'checks out from the context menu']],
  checkin: [
    ['pdm.journey.test.tsx', 'edits the description inline, checks in'],
    ['pdm.journey.test.tsx', 'checks in changed content as a new version'],
  ],
  sync: [['pdm.journey.test.tsx', 'first check-in of a local file creates one row at its path']],
  download: [['pdm.journey.test.tsx', 'downloads a cloud-only file']],
  'get-latest': [['pdm.journey.test.tsx', 'gets the latest version of a file someone else checked in']],
  'delete-local': [
    ['delete.journey.test.tsx', 'removes the local copy'],
    ['delete.journey.test.tsx', 'deletes a local-only file with the Delete key'],
    ['delete.journey.test.tsx', 'falls back to a permanent delete when the Recycle Bin refuses'],
  ],
  'delete-server': [
    ['delete.journey.test.tsx', 'deletes from the server and keeps the local copy'],
    ['delete.journey.test.tsx', 'deletes local and server copies of a folder tree'],
  ],
  discard: [['pdm.journey.test.tsx', 'undoes a checkout']],
  rename: [
    ['rename.journey.test.tsx', 'renames a %s on disk, in the store and on the server'],
    ['rename.journey.test.tsx', 'renames a folder with nested folders'],
    ['rename.journey.test.tsx', 'renames by case only'],
  ],
  move: [
    ['move.journey.test.tsx', 'moves a file onto a folder row'],
    ['move.journey.test.tsx', 'moves a multi-selection'],
    ['move.journey.test.tsx', 'moves a folder onto another folder within the tree'],
    ['move.journey.test.tsx', 'cuts a file and pastes it into a folder'],
  ],
  copy: [
    ['move.journey.test.tsx', 'copies a synced file'],
    ['move.journey.test.tsx', 'copies a folder into another folder'],
  ],
  'new-folder': [['move.journey.test.tsx', 'creates a folder from the empty-area menu']],
  'merge-folder': [
    ['move.journey.test.tsx', 'merges a folder dropped onto a folder that already has one'],
    ['move.journey.test.tsx', 'keeps both copies when the folders being merged'],
  ],
  'copy-to-vault': [['vaultTransfer.journey.test.tsx', 'copies a file to the other vault']],
  'move-to-vault': [['vaultTransfer.journey.test.tsx', 'moves a folder to the other vault']],
}

/** Command id -> why it has no journey here. Each reason should say where it is covered. */
const NOT_JOURNEYED: Record<string, string> = {
  'discard-orphaned':
    'Automatic, not a menu action: runs from the load pipeline and Re-align. Covered by discardOrphaned.test.ts and the race scenarios.',
  'force-release': 'Admin-only release of another user\'s lock; the journeys run as a non-admin engineer. Covered by forceRelease.test.ts.',
  pin: 'Sidebar bookmark only: changes no file, row or path.',
  unpin: 'Sidebar bookmark only: changes no file, row or path.',
  ignore: 'Writes an ignore pattern only; no file, row or path changes.',
  open: 'Hands the file to the OS (openFile); no vault state changes.',
  'show-in-explorer': 'Opens Windows Explorer; no vault state changes.',
  'sync-metadata':
    'Needs a live SolidWorks write path end to end; covered by src/test/integration/metadataRoundTrip.test.ts on the same kit and syncMetadata*.test.ts.',
  'extract-references':
    'Reads references through the SolidWorks service, which the fake answers as unresolved. No test yet: a journey needs recorded getReferences replies.',
  'bulk-download-assembly': 'Assembly-wide variants of download/checkout/checkin/delete; need resolved SolidWorks references. Covered by bulkAssembly.test.ts.',
  'bulk-checkout-assembly': 'See bulk-download-assembly.',
  'bulk-checkin-assembly': 'See bulk-download-assembly.',
  'bulk-delete-assembly': 'See bulk-download-assembly.',
  'pack-and-go': 'Exports a copy outside the vault; changes no vault state. Covered by packAndGo.test.ts.',
  'match-ghost-file': 'Repair tool for a ghost row, reached only from a vault that already has one. No test yet.',
  'reconcile-moved-paths':
    'Re-align / pending-move repair, reached from a vault already holding pending moves. Covered by reconcileMovedPaths*.test.ts; the journeys assert no pending move is ever left behind.',
  'adopt-server-paths': 'See reconcile-moved-paths. Covered by adoptServerPaths*.test.ts.',
}

function commandIds(): string[] {
  const union = /export type CommandId =([^;]*?)\n\n/s.exec(typesSource)
  if (!union) throw new Error('CommandId union not found in src/lib/commands/types.ts')
  return [...union[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
}

describe('user journeys cover the commands', () => {
  const ids = commandIds()

  it('reads the command list', () => {
    expect(ids.length).toBeGreaterThan(20)
    expect(ids).toContain('rename')
  })

  it.each(ids)('%s has a journey or a reason', (id) => {
    const journeyed = id in JOURNEYS
    const excused = id in NOT_JOURNEYED
    expect(journeyed || excused, `add a journey for '${id}' or a reason in NOT_JOURNEYED`).toBe(true)
    expect(journeyed && excused, `'${id}' is both journeyed and excused`).toBe(false)
    if (excused) expect(NOT_JOURNEYED[id].length).toBeGreaterThan(20)
  })

  it('lists no command that no longer exists', () => {
    for (const id of [...Object.keys(JOURNEYS), ...Object.keys(NOT_JOURNEYED)]) expect(ids).toContain(id)
  })

  it('points only at journeys that exist', () => {
    for (const [id, journeys] of Object.entries(JOURNEYS)) {
      for (const [file, title] of journeys) {
        const source = readFileSync(resolve(here, file), 'utf8')
        expect(source.includes(title), `${id}: no test titled "${title}" in ${file}`).toBe(true)
      }
    }
  })
})
