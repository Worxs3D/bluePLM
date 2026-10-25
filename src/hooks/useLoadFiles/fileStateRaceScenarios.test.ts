/**
 * File-state races: a file operation, a restart or a server change landing inside a vault load.
 *
 * Each of these shipped as a regression that only showed up with the real store underneath the
 * load pipeline, so `SimVault` runs here on `pdmStoreBackend()`: rows go through the store's real
 * `setFiles` (pending-metadata restore and pruning), and moves go through `renameFileInStore` /
 * `removeFilesFromStore`, which bump the real file mutation epoch the load checks before it
 * commits.
 *
 * - 22fde292: a drag-and-drop move landing between the scan and the commit was reverted.
 * - 52e5cfad: a load discarded mid Move to Vault still wrote its server list and sync index, so
 *   the next folder delete counted rows that were already gone.
 * - bd0c50ad: pending metadata restored at startup that matched the committed values (per
 *   configuration included) marked files modified forever with nothing to check in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'
import type { PDMFile } from '@/types/pdm'
import { resetPDMStore } from '@/test/pdmStoreReset'
import { ME, SimVault, VAULT, pdmStoreBackend } from '@/test/simVault'

beforeAll(() => {
  vi.stubGlobal('window', {})
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const FROM = 'Parts/bracket.sldprt'
const TO = 'Archive/bracket.sldprt'
const abs = (relativePath: string) => `${VAULT}/${relativePath}`

let vault: SimVault

beforeEach(async () => {
  resetPDMStore()
  usePDMStore.setState({ vaultPath: VAULT })
  vault = new SimVault(pdmStoreBackend())
  vault.seedSynced(FROM, 'v2', 2)
  vault.seedSynced('Parts/plate.sldprt', 'p1', 1)
  await vault.load()
  vault.hashPass()
})

/** What fileOps does for a move of a checked-in file: disk, server path, then the store. */
function moveFile(from: string, to: string) {
  vault.renameOnDisk(from, to)
  const row = vault.server.get(from.toLowerCase())!
  vault.server.delete(from.toLowerCase())
  vault.server.set(to.toLowerCase(), {
    ...row,
    file_path: to,
    updated_at: new Date(vault.tick()).toISOString(),
  })
  usePDMStore.getState().renameFileInStore(abs(from), abs(to), to, true)
}

const paths = () =>
  vault.store
    .filter((f) => !f.isDirectory)
    .map((f) => `${f.relativePath}:${f.diffStatus ?? 'synced'}`)
    .sort()

describe('a move landing inside a load (drag-and-drop revert, 22fde292)', () => {
  it('a load that scanned before the move is discarded, not committed over it', async () => {
    const stale = vault.beginLoad()
    moveFile(FROM, TO)
    const afterMove = paths()

    expect(await stale.commit()).toEqual({ committed: false })
    expect(paths()).toEqual(afterMove)
    expect(paths()).toContain(`${TO}:synced`)
    expect(paths().some((p) => p.startsWith(FROM))).toBe(false)

    // The rerun sees both halves after the move and agrees with it.
    await vault.load()
    expect(paths()).toEqual(['Archive/bracket.sldprt:synced', 'Parts/plate.sldprt:synced'])
  })

  it('a scan from before the move and a fetch from after it never commit together', async () => {
    // The halves disagree: the disk scan has the old path, the server list the new one. Merged,
    // the file would be "added" at the old path and "cloud" at the new one.
    const stale = vault.beginLoad({ fetchServerAtCommit: true })
    moveFile(FROM, TO)

    expect(await stale.commit()).toEqual({ committed: false })
    expect(paths()).not.toContain(`${FROM}:added`)
    expect(paths()).not.toContain(`${TO}:cloud`)
    expect(vault.discardedLoads).toBe(1)
  })

  it('a load that started after the move commits normally', async () => {
    moveFile(FROM, TO)
    expect(await vault.beginLoad().commit()).toEqual({ committed: true })
    expect(paths()).toContain(`${TO}:synced`)
  })
})

describe('a load discarded mid Move to Vault writes nothing (52e5cfad)', () => {
  it('keeps the server list and sync index of the last committed load', async () => {
    const committedServerList = [...vault.serverFileList]
    const committedIndex = new Map(vault.syncIndex)

    // The load fetches while the rows still exist...
    const stale = vault.beginLoad()
    // ...then the transfer takes the files off this vault: rows deleted, disk emptied.
    vault.server.delete(FROM.toLowerCase())
    vault.disk.delete(FROM)
    usePDMStore.getState().removeFilesFromStore([abs(FROM)])

    expect(await stale.commit()).toEqual({ committed: false })
    expect(vault.serverFileList).toEqual(committedServerList)
    expect(vault.syncIndex).toEqual(committedIndex)

    // The next load has no ghost of the moved file and no phantom delete.
    await vault.load()
    expect(vault.serverFileList).toEqual(['Parts/plate.sldprt'])
    expect(paths()).toEqual(['Parts/plate.sldprt:synced'])
  })
})

describe('pending metadata restored at startup (phantom modified, bd0c50ad)', () => {
  function commitServerMetadata(relativePath: string, fields: Partial<PDMFile>) {
    const key = relativePath.toLowerCase()
    vault.server.set(key, { ...vault.server.get(key)!, ...fields } as PDMFile)
  }

  it('a persisted edit that the server already holds is dropped, not shown as modified', async () => {
    commitServerMetadata(FROM, {
      description: 'Bracket',
      custom_properties: { _config_tabs: { Default: '01', Blue: '02' } },
    } as Partial<PDMFile>)
    usePDMStore.setState({
      persistedPendingMetadata: {
        [abs(FROM)]: { description: 'Bracket', config_tabs: { Blue: '02' } },
      },
    })

    vault.restartApp()
    await vault.load()
    vault.hashPass()

    expect(vault.shown(FROM).status).toBeUndefined()
    expect(vault.row(FROM).pendingMetadata).toBeUndefined()
    expect(usePDMStore.getState().persistedPendingMetadata[abs(FROM)]).toBeUndefined()
  })

  it('a persisted edit the server does not hold yet survives the restart as modified', async () => {
    commitServerMetadata(FROM, {
      description: 'Bracket',
      custom_properties: { _config_tabs: { Default: '01', Blue: '02' } },
    } as Partial<PDMFile>)
    vault.checkOut(FROM)
    usePDMStore.setState({
      persistedPendingMetadata: { [abs(FROM)]: { config_tabs: { Blue: '12' } } },
    })

    vault.restartApp()
    await vault.load()

    expect(vault.shown(FROM).status).toBe('modified')
    expect(vault.row(FROM).pendingMetadata).toEqual({ config_tabs: { Blue: '12' } })
    expect(vault.row(FROM).pdmData?.checked_out_by).toBe(ME)
  })

  it('a hash pass after the restore does not resurrect a dropped edit', async () => {
    commitServerMetadata(FROM, { description: 'Bracket' } as Partial<PDMFile>)
    usePDMStore.setState({ persistedPendingMetadata: { [abs(FROM)]: { description: 'Bracket' } } })

    vault.restartApp()
    await vault.load()
    vault.hashPass(true)
    await vault.load()

    expect(vault.shown(FROM)).toEqual({ status: undefined, version: '2/2' })
    expect(vault.row(FROM).pendingMetadata).toBeUndefined()
  })
})
