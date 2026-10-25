/**
 * File-state scenarios driven through the load pipeline's pure stages: scan -> merge -> cloud
 * reconciliation -> sync index persistence -> background hash pass, plus the folder refresh.
 *
 * The stale-hash bug fixed in 46bb503b / 18a84f74 (a save while checked out stayed "2/2", some
 * checked-in files stayed amber "4/3") lived in the merge inside the React hook, where no test
 * reached it. `SimVault` (src/test/simVault.ts) plays the disk, the server, the store and the
 * IndexedDB sync index, and calls the same functions useLoadFiles calls, in the same order.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ME, OTHER, SimVault, hashOf } from '@/test/simVault'
import { stampOf } from './cachedHashValidity'
import { classifyWithComputedHash, selectFilesNeedingHash } from './fileClassification'

beforeAll(() => {
  vi.stubGlobal('window', {})
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const PART = 'Parts/bracket.sldprt'

/** A part at version 2, downloaded and hashed once, so the store and sync index know it. */
async function vaultWithSyncedPart(checkedOutBy: string | null = null): Promise<SimVault> {
  const vault = new SimVault()
  vault.seedSynced(PART, 'v2', 2, checkedOutBy)
  await vault.load()
  vault.hashPass()
  return vault
}

describe('file state scenarios', () => {
  it('starts synced: 2/2 with the server version stamped from a matching hash', async () => {
    const vault = await vaultWithSyncedPart()
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })
    expect(vault.row(PART).localVersion).toBe(2)
    expect(vault.syncIndex.get(PART.toLowerCase())?.hashStamp).toBeDefined()
  })

  it('a save while checked out shows modified (3/2) on the next load, before any hashing', async () => {
    const vault = await vaultWithSyncedPart()
    vault.checkOut(PART)
    await vault.load()
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })

    vault.writeDisk(PART, 'v2-edited')
    await vault.load()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '3/2' })
    // The pre-edit hash is dropped, never reused, and the file is queued for re-hashing.
    expect(vault.row(PART).localHash).toBeUndefined()
    expect(vault.lastRehashPaths.has(PART)).toBe(true)

    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '3/2' })
    expect(vault.row(PART).localHash).toBe(hashOf('v2-edited'))
  })

  it('an edit reverted to the server content clears once the hash pass reads it', async () => {
    const vault = await vaultWithSyncedPart()
    vault.checkOut(PART)
    vault.writeDisk(PART, 'v2-edited')
    await vault.load()
    vault.hashPass()
    expect(vault.shown(PART).status).toBe('modified')

    vault.writeDisk(PART, 'v2')
    await vault.load()
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })
    expect(vault.row(PART).localVersion).toBe(2)
  })

  it('a file that drifts after check-in is caught by the hash pass (4/3)', async () => {
    const vault = await vaultWithSyncedPart()
    vault.checkOut(PART)
    vault.writeDisk(PART, 'v3')
    vault.checkIn(PART)
    await vault.load()
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '3/3' })

    vault.writeDisk(PART, 'v3-drift')
    await vault.load()
    // Not checked out, so without a hash the load cannot call it modified yet.
    expect(vault.shown(PART).status).toBeUndefined()
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '4/3' })
  })

  it('a stale amber hash clears when the disk now holds the server content', async () => {
    const vault = await vaultWithSyncedPart()
    vault.checkOut(PART)
    vault.writeDisk(PART, 'v2-edited')
    await vault.load()
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '3/2' })

    // The content is replaced by the server's again, keeping the modified time newer than the
    // server row; the cached 'v2-edited' hash must not keep the file amber.
    vault.writeDisk(PART, 'v2')
    await vault.load()
    expect(vault.row(PART).localHash).toBeUndefined()
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })
  })

  it('an edit made while the app was closed is caught on restart (stamped sync index hash)', async () => {
    const vault = await vaultWithSyncedPart()
    vault.restartApp()
    vault.writeDisk(PART, 'v2-offline-edit')

    await vault.load()
    expect(vault.row(PART).localHash).toBeUndefined()
    expect(vault.lastRehashPaths.has(PART)).toBe(true)
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '3/2' })
    expect(vault.syncIndex.get(PART.toLowerCase())).toMatchObject({
      localHash: hashOf('v2-offline-edit'),
      hashStamp: { size: 'v2-offline-edit'.length },
    })
  })

  it('an edit made while the app was closed is caught on restart (pre-stamp sync index hash)', async () => {
    const vault = await vaultWithSyncedPart()
    // A sync index row written before stamps existed: a hash with nothing to check it against.
    const saved = vault.syncIndex.get(PART.toLowerCase())!
    vault.syncIndex.set(PART.toLowerCase(), { ...saved, hashStamp: undefined })
    vault.restartApp()
    vault.writeDisk(PART, 'v2-offline-edit')

    await vault.load()
    // The unverified hash still decides the first status, as it always did...
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })
    // ...but is re-checked, and never written back stamped as if it had been verified.
    expect(vault.lastRehashPaths.has(PART)).toBe(true)
    expect(vault.syncIndex.get(PART.toLowerCase())?.hashStamp).toBeUndefined()

    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '3/2' })
    expect(vault.syncIndex.get(PART.toLowerCase())?.hashStamp).toBeDefined()
  })

  it('an unchanged file after a restart keeps its trusted hash and is not re-hashed', async () => {
    const vault = await vaultWithSyncedPart()
    vault.restartApp()
    await vault.load()
    expect(vault.row(PART).localHash).toBe(hashOf('v2'))
    expect(vault.lastRehashPaths.size).toBe(0)
    expect(selectFilesNeedingHash(vault.store, vault.lastRehashPaths, false)).toEqual([])
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })
  })

  it('a hash pass that raced a newer reload does not apply its result to the newer copy', async () => {
    const vault = await vaultWithSyncedPart()
    vault.checkOut(PART)
    vault.writeDisk(PART, 'edit-1')
    await vault.load()
    const pass = vault.startHashPass()
    expect(pass.results.get(PART)).toBe(hashOf('edit-1'))

    vault.writeDisk(PART, 'v2')
    await vault.load()
    vault.finishHashPass(pass)
    expect(vault.row(PART).localHash).not.toBe(hashOf('edit-1'))

    vault.hashPass()
    expect(vault.row(PART).localHash).toBe(hashOf('v2'))
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '2/2' })
  })

  it('a newer server version shows outdated with the version on disk (2/3)', async () => {
    const vault = await vaultWithSyncedPart()
    vault.serverCheckIn(PART, 'v3-from-colleague', 3, null)
    await vault.load()
    expect(vault.shown(PART)).toEqual({ status: 'outdated', version: '2/3' })
  })

  it('outdated without a hash comes from the tracked version, not timestamps', async () => {
    const vault = await vaultWithSyncedPart()
    vault.restartApp()
    const saved = vault.syncIndex.get(PART.toLowerCase())!
    vault.syncIndex.set(PART.toLowerCase(), { localVersion: saved.localVersion, ino: saved.ino })
    vault.serverCheckIn(PART, 'v3-from-colleague', 3, null)
    await vault.load()
    expect(vault.row(PART).localHash).toBeUndefined()
    expect(vault.shown(PART)).toEqual({ status: 'outdated', version: '2/3' })
  })

  it('a local edit newer than the server row is modified, not outdated', async () => {
    const vault = await vaultWithSyncedPart()
    vault.serverCheckIn(PART, 'v3-from-colleague', 3, null)
    vault.writeDisk(PART, 'my-local-edit')
    await vault.load()
    vault.hashPass()
    expect(vault.shown(PART)).toEqual({ status: 'modified', version: '4/3' })
  })

  it('a renamed checked-out file stays moved through the hash pass and a folder refresh', async () => {
    const vault = await vaultWithSyncedPart()
    vault.checkOut(PART)
    await vault.load()
    vault.renameOnDisk(PART, 'Parts/bracket-renamed.sldprt')
    vault.mainHashCache.clear()

    await vault.load()
    const moved = 'Parts/bracket-renamed.sldprt'
    expect(vault.shown(moved)).toEqual({ status: 'moved', version: '2/2' })
    expect(vault.row(PART).diffStatus).toBe('moved_away')

    vault.hashPass(true)
    expect(vault.shown(moved).status).toBe('moved')

    vault.refreshFolder('Parts')
    expect(vault.shown(moved).status).toBe('moved')
  })

  it('cloud-only rows are left alone by the hash pass and the folder refresh', async () => {
    const vault = await vaultWithSyncedPart()
    vault.serverCheckIn('Parts/remote-only.sldprt', 'remote', 1, OTHER)
    await vault.load()
    const cloud = vault.row('Parts/remote-only.sldprt')
    expect(cloud.diffStatus).toBe('cloud')

    expect(selectFilesNeedingHash(vault.store, vault.lastRehashPaths, true)).not.toContain(cloud)
    expect(classifyWithComputedHash(cloud, hashOf('remote'), stampOf(cloud), ME)).toBeUndefined()
    vault.hashPass(true)
    expect(vault.row('Parts/remote-only.sldprt')).toEqual(cloud)

    vault.refreshFolder('Parts')
    expect(vault.row('Parts/remote-only.sldprt').diffStatus).toBe('cloud')
  })

  it('a folder refresh classifies like the full load', async () => {
    const vault = await vaultWithSyncedPart()
    vault.writeDisk('Parts/new.sldprt', 'new')
    vault.writeDisk('Parts/scratch.tmp.sldprt', 'scratch')
    vault.ignored.add('Parts/scratch.tmp.sldprt')
    vault.seedSynced('Parts/orphan.sldprt', 'orphan', 1)
    await vault.load()
    vault.server.delete('parts/orphan.sldprt')
    await vault.load()

    const summary = () =>
      vault.store
        .map((f) => [f.relativePath, f.diffStatus, f.localVersion])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    const fullLoad = summary()
    vault.refreshFolder('Parts')
    const refreshed = summary()
    expect(refreshed).toEqual(fullLoad)
    expect(vault.shown('Parts/new.sldprt').status).toBe('added')
    expect(vault.shown('Parts/scratch.tmp.sldprt').status).toBe('ignored')
    expect(vault.shown('Parts/orphan.sldprt').status).toBe('deleted_remote')
  })

  it('a folder refresh stamps the server version on a file whose hash now matches', async () => {
    const vault = await vaultWithSyncedPart()
    vault.serverCheckIn(PART, 'v3', 3, null)
    vault.writeDisk(PART, 'v3')
    vault.mainHashCache.set(PART, {
      size: 2,
      mtimeMs: vault.disk.get(PART)!.mtimeMs,
      hash: hashOf('v3'),
    })
    await vault.load()
    vault.store = vault.store.map((f) => (f.relativePath === PART ? { ...f, localVersion: 2 } : f))

    vault.refreshFolder('Parts')
    expect(vault.row(PART).localVersion).toBe(3)
    expect(vault.shown(PART)).toEqual({ status: undefined, version: '3/3' })
  })
})
