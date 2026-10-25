/**
 * File-state scenarios driven through the load pipeline's pure stages: scan -> merge -> cloud
 * reconciliation -> sync index persistence -> background hash pass, plus the folder refresh.
 *
 * The stale-hash bug fixed in 46bb503b / 18a84f74 (a save while checked out stayed "2/2", some
 * checked-in files stayed amber "4/3") lived in the merge inside the React hook, where no test
 * reached it. `SimVault` below plays the disk, the server, the store and the IndexedDB sync index,
 * and calls the same functions useLoadFiles calls, in the same order.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SavedVersionData, SyncIndexPathInfo } from '@/lib/cache/localSyncIndex'
import type { CachedServerFile } from '@/lib/cache/vaultFileCache'
import { describeVersion } from '@/lib/files/versionDisplay'
import type { LocalFile, ServerFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'
import { reconcileCloudFiles } from './cloudFileReconciliation'
import { stampOf } from './cachedHashValidity'
import { classifyWithComputedHash, selectFilesNeedingHash } from './fileClassification'
import { mergeFolderRefresh } from './folderRefreshMerge'
import {
  buildMergeLookups,
  buildSyncIndexEntries,
  mergeLocalFileWithServer,
  type ScannedLocalFile,
  type SyncIndexInodeEntry,
} from './mergeLocalFile'
import { detectInodeRenames } from './renameDetection'

const VAULT = 'C:/vault'
const ME = 'user-me'
const OTHER = 'user-other'
const NO_YIELD = async () => {}

beforeAll(() => {
  vi.stubGlobal('window', {})
})
afterAll(() => {
  vi.unstubAllGlobals()
})

interface DiskFile {
  content: string
  size: number
  mtimeMs: number
  ino: number
}

interface HashPassInFlight {
  requests: Map<string, { size: number; mtimeMs: number }>
  results: Map<string, string>
}

/** Content stands in for the bytes; the hash is derived from it. */
const hashOf = (content: string) => `sha-${content}`

class SimVault {
  clock = Date.parse('2026-10-20T09:00:00.000Z')
  private nextIno = 100
  disk = new Map<string, DiskFile>()
  server = new Map<string, PDMFile>()
  store: LocalFile[] = []
  /** The IndexedDB sync index: lowercase path -> saved version/hash/stamp and inode. */
  syncIndex = new Map<string, SavedVersionData & { ino?: number }>()
  syncedPaths = new Map<string, SyncIndexPathInfo>()
  /** The main process hash cache: the scan reuses a hash only while size and mtime hold. */
  mainHashCache = new Map<string, { size: number; mtimeMs: number; hash: string }>()
  ignored = new Set<string>()
  lastRehashPaths = new Set<string>()

  tick(ms = 60_000): number {
    this.clock += ms
    return this.clock
  }

  writeDisk(relativePath: string, content: string): void {
    const existing = this.disk.get(relativePath)
    this.disk.set(relativePath, {
      content,
      size: content.length,
      mtimeMs: this.tick(),
      ino: existing?.ino ?? this.nextIno++,
    })
  }

  renameOnDisk(from: string, to: string): void {
    const file = this.disk.get(from)!
    this.disk.delete(from)
    this.disk.set(to, file)
  }

  /** A file checked in by `by` at `version`, downloaded here with matching content. */
  seedSynced(relativePath: string, content: string, version: number, by: string | null = null) {
    this.writeDisk(relativePath, content)
    this.serverCheckIn(relativePath, content, version, by)
    this.mainHashCache.set(relativePath, {
      ...this.stampOnDisk(relativePath),
      hash: hashOf(content),
    })
  }

  serverCheckIn(relativePath: string, content: string, version: number, checkedOutBy: string | null) {
    const at = new Date(this.tick()).toISOString()
    this.server.set(relativePath.toLowerCase(), {
      id: `id-${relativePath}`,
      file_path: relativePath,
      file_name: relativePath.split('/').pop()!,
      extension: '.sldprt',
      version,
      content_hash: hashOf(content),
      file_size: content.length,
      updated_at: at,
      checked_out_by: checkedOutBy,
      checked_out_at: checkedOutBy ? at : null,
      part_number: null,
    } as unknown as PDMFile)
  }

  checkOut(relativePath: string): void {
    const row = this.server.get(relativePath.toLowerCase())!
    const at = new Date(this.tick()).toISOString()
    this.server.set(relativePath.toLowerCase(), {
      ...row,
      checked_out_by: ME,
      checked_out_at: at,
      updated_at: at,
    })
  }

  /** Check-in from this machine: the server takes the disk content and the store row follows. */
  checkIn(relativePath: string): void {
    const disk = this.disk.get(relativePath)!
    const row = this.server.get(relativePath.toLowerCase())!
    const version = row.version + 1
    this.serverCheckIn(relativePath, disk.content, version, null)
    this.store = this.store.map((f) =>
      f.relativePath === relativePath
        ? {
            ...f,
            pdmData: this.server.get(relativePath.toLowerCase()),
            diffStatus: undefined,
            localHash: hashOf(disk.content),
            localVersion: version,
          }
        : f,
    )
  }

  restartApp(): void {
    this.store = []
    this.mainHashCache.clear()
  }

  private stampOnDisk(relativePath: string) {
    const disk = this.disk.get(relativePath)!
    return { size: disk.size, mtimeMs: disk.mtimeMs }
  }

  private scan(): ScannedLocalFile[] {
    return [...this.disk.entries()].map(([relativePath, disk]) => {
      const cached = this.mainHashCache.get(relativePath)
      const hashValid = cached && cached.size === disk.size && cached.mtimeMs === disk.mtimeMs
      return {
        name: relativePath.split('/').pop()!,
        path: `${VAULT}/${relativePath}`,
        relativePath,
        isDirectory: false,
        extension: '.sldprt',
        size: disk.size,
        modifiedTime: new Date(disk.mtimeMs).toISOString(),
        ino: disk.ino,
        localHash: hashValid ? cached.hash : undefined,
      }
    })
  }

  private persist(entries: SyncIndexInodeEntry[]): void {
    // updateInodes: a version is kept unless replaced; a new hash replaces the stamp with its own.
    for (const entry of entries) {
      const key = entry.path.toLowerCase()
      const existing = this.syncIndex.get(key) ?? {}
      this.syncIndex.set(key, {
        ...existing,
        ino: entry.ino,
        ...(entry.localVersion !== undefined ? { localVersion: entry.localVersion } : {}),
        ...(entry.localHash !== undefined
          ? { localHash: entry.localHash, hashStamp: entry.hashStamp }
          : {}),
      })
    }
  }

  /** One load pass: what runLoadFiles does between the scan and setFiles. */
  async load(): Promise<LocalFile[]> {
    let localFiles = this.scan()
    const pdmFiles = [...this.server.values()]
    const pdmMap = new Map(pdmFiles.map((f) => [f.file_path.toLowerCase(), f]))
    const localPathSet = new Set(localFiles.map((f) => f.relativePath.toLowerCase()))
    const savedInodeMap = new Map<number, string[]>()
    for (const [path, entry] of this.syncIndex) {
      if (entry.ino) savedInodeMap.set(entry.ino, [...(savedInodeMap.get(entry.ino) ?? []), path])
    }
    const checkedOutByMeByHash = new Map<string, PDMFile>()
    for (const f of pdmFiles) {
      if (f.content_hash && f.checked_out_by === ME) checkedOutByMeByHash.set(f.content_hash, f)
    }

    const renames = detectInodeRenames(localFiles, pdmMap, localPathSet, savedInodeMap)
    const rehashPaths = new Set<string>()
    const ctx = {
      lookups: buildMergeLookups(this.store, this.syncIndex, () => false),
      pdmMap,
      serverFoldersMap: new Map(),
      inodeRenameMap: renames.inodeRenameMap,
      checkedOutByMeByHash,
      localPathSet,
      localSyncIndex: this.syncedPaths,
      isIgnoredPath: (path: string) => this.ignored.has(path),
      persistedPendingMetadata: {},
      userId: ME,
      vaultPath: VAULT,
      rehashPaths,
      orphansEditedSinceServerRowLost: new Set<string>(),
      stats: { matched: 0, unmatched: 0, unmatchedSamples: [] },
    }
    localFiles = localFiles.map((f) => mergeLocalFileWithServer(f, ctx))

    const reconciled = await reconcileCloudFiles({
      pdmFiles: pdmFiles as unknown as CachedServerFile[],
      localFiles,
      localPathSet,
      inodeMatchedServerPaths: renames.inodeMatchedServerPaths,
      inodeMatchedServerPathToLocalPath: renames.inodeMatchedServerPathToLocalPath,
      existingCheckedOutUsers: ctx.lookups.checkedOutUsers,
      userId: ME,
      vaultPath: VAULT,
      yieldIfSlow: NO_YIELD,
      yieldCheckStride: 256,
    })

    for (const f of pdmFiles) this.syncedPaths.set(f.file_path.toLowerCase(), {})
    this.persist(buildSyncIndexEntries(reconciled.localFiles, rehashPaths))
    this.store = reconciled.localFiles
    this.lastRehashPaths = rehashPaths
    return this.store
  }

  /** The background hash pass reads the disk now; the results apply later. */
  startHashPass(force = false): HashPassInFlight {
    const files = selectFilesNeedingHash(this.store, this.lastRehashPaths, force)
    const requests = new Map<string, { size: number; mtimeMs: number }>()
    const results = new Map<string, string>()
    for (const f of files) {
      requests.set(f.relativePath, stampOf(f)!)
      const disk = this.disk.get(f.relativePath)
      if (!disk) continue
      results.set(f.relativePath, hashOf(disk.content))
      this.mainHashCache.set(f.relativePath, {
        size: disk.size,
        mtimeMs: disk.mtimeMs,
        hash: hashOf(disk.content),
      })
    }
    return { requests, results }
  }

  finishHashPass(pass: HashPassInFlight): LocalFile[] {
    const persisted: SyncIndexInodeEntry[] = []
    this.store = this.store.map((f) => {
      const hash = pass.results.get(f.relativePath)
      if (!hash) return f
      const updated = classifyWithComputedHash(f, hash, pass.requests.get(f.relativePath), ME)
      if (!updated) return f
      if (f.ino && f.pdmData) {
        persisted.push({
          path: f.relativePath,
          ino: f.ino,
          localVersion: updated.localVersion,
          localHash: hash,
          hashStamp: stampOf(f),
        })
      }
      return updated
    })
    this.persist(persisted)
    return this.store
  }

  hashPass(force = false): LocalFile[] {
    return this.finishHashPass(this.startHashPass(force))
  }

  refreshFolder(folderPath: string): LocalFile[] {
    const serverFiles: ServerFile[] = [...this.server.values()].map((f) => ({
      id: f.id,
      file_path: f.file_path,
      name: f.file_name,
      extension: f.extension,
      content_hash: f.content_hash || '',
    }))
    const scanned = this.scan().map(({ localHash, ...f }) => ({ ...f, hash: localHash }))
    const prefix = folderPath ? `${folderPath.toLowerCase()}/` : ''
    const result = mergeFolderRefresh({
      existingFiles: this.store,
      serverFiles,
      scanned: scanned.filter((f) => f.relativePath.toLowerCase().startsWith(prefix)),
      folderPath,
      vaultPath: VAULT,
      userId: ME,
      isIgnoredPath: (path) => this.ignored.has(path),
    })
    this.store = result.combinedFiles
    return this.store
  }

  row(relativePath: string): LocalFile {
    const row = this.store.find((f) => f.relativePath === relativePath)
    if (!row) throw new Error(`no row for ${relativePath}`)
    return row
  }

  /** The status and the version label the file browser would show. */
  shown(relativePath: string): { status: LocalFile['diffStatus']; version: string } {
    const row = this.row(relativePath)
    return { status: row.diffStatus, version: describeVersion(row).text }
  }
}

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
