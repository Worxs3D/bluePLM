/**
 * A simulated vault for file-state scenarios: disk, server, store and IndexedDB sync index, driven
 * through the same load-pipeline stages useLoadFiles calls, in the same order (scan -> merge ->
 * cloud reconciliation -> sync index persistence -> background hash pass, plus the folder refresh).
 *
 * Moved here from fileStateScenarios.test.ts so the race scenarios share one model. A test using
 * it stubs `window` (the merge logs through `window.electronAPI?.log`).
 */
import type { SavedVersionData, SyncIndexPathInfo } from '@/lib/cache/localSyncIndex'
import type { CachedServerFile } from '@/lib/cache/vaultFileCache'
import { getFileMutationEpoch } from '@/lib/fileMutationEpoch'
import { describeVersion } from '@/lib/files/versionDisplay'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile, PendingMetadata, ServerFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'
import { reconcileCloudFiles } from '@/hooks/useLoadFiles/cloudFileReconciliation'
import { stampOf } from '@/hooks/useLoadFiles/cachedHashValidity'
import {
  classifyWithComputedHash,
  selectFilesNeedingHash,
} from '@/hooks/useLoadFiles/fileClassification'
import { mergeFolderRefresh } from '@/hooks/useLoadFiles/folderRefreshMerge'
import {
  buildMergeLookups,
  buildSyncIndexEntries,
  mergeLocalFileWithServer,
  type ScannedLocalFile,
  type SyncIndexInodeEntry,
} from '@/hooks/useLoadFiles/mergeLocalFile'
import { detectInodeRenames } from '@/hooks/useLoadFiles/renameDetection'

export const VAULT = 'C:/vault'
export const ME = 'user-me'
export const OTHER = 'user-other'
const NO_YIELD = async () => {}

interface DiskFile {
  content: string
  size: number
  mtimeMs: number
  ino: number
}

export interface HashPassInFlight {
  requests: Map<string, { size: number; mtimeMs: number }>
  results: Map<string, string>
}

/** Content stands in for the bytes; the hash is derived from it. */
export const hashOf = (content: string) => `sha-${content}`

/**
 * Where a SimVault keeps its store rows. The default is a plain array; `pdmStoreBackend()` puts
 * them in the real `usePDMStore`, so `setFiles` restores (or drops) persisted pending metadata and
 * file operations bump the real mutation epoch, as they do in the app.
 */
export interface StoreBackend {
  get(): LocalFile[]
  set(files: LocalFile[]): void
  persistedPendingMetadata(): Record<string, PendingMetadata>
}

export function arrayBackend(): StoreBackend {
  let files: LocalFile[] = []
  return {
    get: () => files,
    set: (next) => {
      files = next
    },
    persistedPendingMetadata: () => ({}),
  }
}

export function pdmStoreBackend(): StoreBackend {
  return {
    get: () => usePDMStore.getState().files,
    set: (next) => usePDMStore.getState().setFiles(next),
    persistedPendingMetadata: () => usePDMStore.getState().persistedPendingMetadata,
  }
}

/** One load split at the points where the app awaits, so a test can land an event in between. */
export interface PhasedLoad {
  /** Finish the merge and commit it, unless a file operation bumped the epoch since the scan. */
  commit(): Promise<{ committed: boolean }>
}

export class SimVault {
  constructor(private readonly backend: StoreBackend = arrayBackend()) {}

  get store(): LocalFile[] {
    return this.backend.get()
  }

  set store(files: LocalFile[]) {
    this.backend.set(files)
  }


  clock = Date.parse('2026-10-20T09:00:00.000Z')
  private nextIno = 100
  disk = new Map<string, DiskFile>()
  server = new Map<string, PDMFile>()
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
    await this.beginLoad().commit()
    return this.store
  }

  /** Loads thrown away because a file operation landed mid-pass. */
  discardedLoads = 0

  /** The server list the last committed load wrote (the store's `serverFiles`). */
  serverFileList: string[] = []

  /**
   * Scan the disk and fetch the server now, merge and commit later - the window useLoadFiles
   * leaves open between `listWorkingFiles` / `getFilesLightweight` and `setFiles`. The mutation
   * epoch is read at scan time and checked before anything is written, as useLoadFiles does
   * (22fde292); a discarded pass writes neither the store, the server list nor the sync index
   * (52e5cfad).
   */
  beginLoad(options: { fetchServerAtCommit?: boolean } = {}): PhasedLoad {
    const epochAtScanStart = getFileMutationEpoch()
    const scanned = this.scan()
    const fetchServer = () => [...this.server.values()].map((row) => ({ ...row }))
    // The scan and the server fetch run in parallel in the app; either can finish first.
    const fetchedEarly = options.fetchServerAtCommit ? null : fetchServer()
    return {
      commit: async () => {
        const merged = await this.merge(scanned, fetchedEarly ?? fetchServer())
        if (getFileMutationEpoch() !== epochAtScanStart) {
          this.discardedLoads += 1
          return { committed: false }
        }
        merged.commitWrites()
        return { committed: true }
      },
    }
  }

  private async merge(scanned: ScannedLocalFile[], pdmFiles: PDMFile[]) {
    let localFiles = scanned
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
      persistedPendingMetadata: this.backend.persistedPendingMetadata(),
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

    return {
      commitWrites: () => {
        for (const f of pdmFiles) this.syncedPaths.set(f.file_path.toLowerCase(), {})
        this.persist(buildSyncIndexEntries(reconciled.localFiles, rehashPaths))
        this.serverFileList = pdmFiles.map((f) => f.file_path)
        this.store = reconciled.localFiles
        this.lastRehashPaths = rehashPaths
      },
    }
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
