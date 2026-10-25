import { buildFullPath } from '@/lib/commands/types'
import { dropCommittedPendingMetadata } from '@/lib/pendingMetadata'
import type { HashStamp, SavedVersionData, SyncIndexPathInfo } from '@/lib/cache/localSyncIndex'
import type { LocalFile } from '@/stores/types'
import {
  isCheckoutProfileForOwner,
  mergePdmFileData,
  reconcileCheckoutProfile,
  type CheckoutUserProfile,
  type PDMFile,
} from '@/types/pdm'
import { buildHashStamps, stampOf } from './cachedHashValidity'
import {
  classifyAgainstServerRow,
  classifyWithoutServerRow,
  resolveLocalHash,
} from './fileClassification'

type PendingMetadata = LocalFile['pendingMetadata']

/** What the previous pass and the sync index know about each file, read by the per-file merge. */
export interface MergeLookups {
  localActiveVersions: Map<string, number>
  localVersions: Map<string, number>
  localHashes: Map<string, string>
  hashStamps: Map<string, HashStamp>
  pendingMetadata: Map<string, PendingMetadata>
  /** Pending edits keyed by the server's (old) path, for files found again after a rename. */
  pendingByServerPath: Map<string, PendingMetadata>
  /** Checkout profiles that still match their file's current owner, by file id. */
  checkedOutUsers: Map<string, CheckoutUserProfile>
  /** pdmData of files just written locally, which a server row may not reflect yet. */
  recentlyModifiedPdmData: Map<string, PDMFile>
}

/**
 * Builds the lookups from the sync index (survives a restart) overlaid by the store's rows
 * (the in-memory state of a warm reload). Version and hash maps are keyed by absolute path,
 * relative path and lowercase relative path, the last matching the sync index's key space.
 */
export function buildMergeLookups(
  currentFiles: readonly LocalFile[],
  savedVersionMap: ReadonlyMap<string, SavedVersionData>,
  isFileRecentlyModified: (fileId: string) => boolean,
): MergeLookups {
  const localActiveVersions = new Map<string, number>()
  const localVersions = new Map<string, number>()
  const localHashes = new Map<string, string>()
  const pendingMetadata = new Map<string, PendingMetadata>()
  const pendingByServerPath = new Map<string, PendingMetadata>()
  const checkedOutUsers = new Map<string, CheckoutUserProfile>()
  const recentlyModifiedPdmData = new Map<string, PDMFile>()

  for (const [relPath, data] of savedVersionMap) {
    if (data.localVersion !== undefined) localVersions.set(relPath, data.localVersion)
    if (data.localHash) localHashes.set(relPath, data.localHash)
  }

  for (const f of currentFiles) {
    if (f.localActiveVersion !== undefined) {
      localActiveVersions.set(f.path, f.localActiveVersion)
      localActiveVersions.set(f.relativePath, f.localActiveVersion)
    }
    if (f.localVersion !== undefined) {
      localVersions.set(f.path, f.localVersion)
      localVersions.set(f.relativePath, f.localVersion)
      localVersions.set(f.relativePath.toLowerCase(), f.localVersion)
    }
    if (f.localHash) {
      localHashes.set(f.path, f.localHash)
      localHashes.set(f.relativePath, f.localHash)
      localHashes.set(f.relativePath.toLowerCase(), f.localHash)
    }
    // A rename stores pending edits under the old path; the server path finds them again.
    if (f.pendingMetadata && Object.keys(f.pendingMetadata).length > 0) {
      pendingMetadata.set(f.path, f.pendingMetadata)
      if (f.pdmData?.file_path) {
        pendingByServerPath.set(f.pdmData.file_path.toLowerCase(), f.pendingMetadata)
      }
    }
    const profile = f.pdmData?.checked_out_user
    if (f.pdmData?.id && isCheckoutProfileForOwner(profile, f.pdmData.checked_out_by)) {
      checkedOutUsers.set(f.pdmData.id, profile)
    }
    // Keeps a Save to File from being reverted by a load the file watcher started before the
    // database write propagated.
    if (f.pdmData?.id && isFileRecentlyModified(f.pdmData.id)) {
      recentlyModifiedPdmData.set(f.path, f.pdmData)
      window.electronAPI?.log('debug', '[LoadFiles] Preserving pdmData for recently modified file', {
        path: f.path,
        fileId: f.pdmData.id,
        partNumber: f.pdmData.part_number,
      })
    }
  }

  return {
    localActiveVersions,
    localVersions,
    localHashes,
    hashStamps: buildHashStamps(savedVersionMap, currentFiles),
    pendingMetadata,
    pendingByServerPath,
    checkedOutUsers,
    recentlyModifiedPdmData,
  }
}

/** A row from the local scan, carrying the hash the scan could reuse, if any. */
export type ScannedLocalFile = LocalFile & { localHash?: string }

export interface ServerFolderRecord {
  id: string
  folder_path: string
}

/** Everything the per-file merge reads, and the sets it reports into. */
export interface MergeContext {
  lookups: MergeLookups
  /** Server rows by lowercase path. */
  pdmMap: ReadonlyMap<string, PDMFile>
  serverFoldersMap: ReadonlyMap<string, ServerFolderRecord>
  /** Server rows matched to a renamed local file by inode, by the local file's lowercase path. */
  inodeRenameMap: ReadonlyMap<string, PDMFile>
  /** Rows checked out by this user, by content hash: only those can be the source of a move. */
  checkedOutByMeByHash: ReadonlyMap<string, PDMFile>
  /** Lowercase paths present in the local scan. */
  localPathSet: ReadonlySet<string>
  localSyncIndex: ReadonlyMap<string, SyncIndexPathInfo>
  isIgnoredPath: (relativePath: string) => boolean
  persistedPendingMetadata: Readonly<Record<string, PendingMetadata>>
  userId: string | undefined
  vaultPath: string
  /** Out: paths whose cached hash is stale or unverified. */
  rehashPaths: Set<string>
  /** Out: lowercase paths of orphans possibly edited after their server row went away. */
  orphansEditedSinceServerRowLost: Set<string>
  /** Out: match statistics for the merge log. */
  stats: { matched: number; unmatched: number; unmatchedSamples: string[] }
}

function firstDefined<T>(map: ReadonlyMap<string, T>, file: LocalFile): T | undefined {
  return (
    map.get(file.path) ||
    map.get(file.relativePath) ||
    map.get(file.relativePath.toLowerCase())
  )
}

/**
 * Merges one scanned local entry with its server row: finds the row (by path, then by inode
 * rename, then by the content hash of a checked-out-by-me file), classifies the file, and carries
 * over rollback state, the tracked local version, a still-valid cached hash and pending edits.
 */
export function mergeLocalFileWithServer(localFile: ScannedLocalFile, ctx: MergeContext): LocalFile {
  const { lookups } = ctx
  if (localFile.isDirectory) {
    const serverFolder = ctx.serverFoldersMap.get(localFile.relativePath.toLowerCase())
    if (!serverFolder) return localFile
    return {
      ...localFile,
      isSynced: true,
      pdmData: { id: serverFolder.id, folder_path: serverFolder.folder_path } as unknown as PDMFile,
    }
  }

  const lookupKey = localFile.relativePath.toLowerCase()
  let pdmData = ctx.pdmMap.get(lookupKey)
  let isMovedFile = false

  if (pdmData) {
    ctx.stats.matched++
  } else {
    ctx.stats.unmatched++
    if (ctx.stats.unmatchedSamples.length < 5) ctx.stats.unmatchedSamples.push(lookupKey)
  }

  const existingLocalActiveVersion =
    lookups.localActiveVersions.get(localFile.path) ||
    lookups.localActiveVersions.get(localFile.relativePath)
  const existingLocalVersion = firstDefined(lookups.localVersions, localFile)

  if (existingLocalActiveVersion !== undefined) {
    window.electronAPI?.log('debug', '[LoadFiles] Preserving localActiveVersion', {
      path: localFile.relativePath,
      version: existingLocalActiveVersion,
    })
  }

  const { localHash: effectiveLocalHash, rehash } = resolveLocalHash(
    localFile.localHash,
    firstDefined(lookups.localHashes, localFile),
    lookups.hashStamps.get(lookupKey),
    localFile,
  )
  if (rehash) ctx.rehashPaths.add(localFile.relativePath)

  // PRIMARY: the NTFS file index survives a rename, so a known inode at a new path is a move.
  if (!pdmData) {
    const inodeMatch = ctx.inodeRenameMap.get(lookupKey)
    if (inodeMatch) {
      pdmData = inodeMatch
      isMovedFile = true
    }
  }

  // FALLBACK: content hash, where no inode is available (first load after upgrade, network
  // drives). Only a checked-out-by-me file whose old path is gone can have been moved by me.
  if (!pdmData && effectiveLocalHash) {
    const movedFromFile = ctx.checkedOutByMeByHash.get(effectiveLocalHash)
    if (movedFromFile && !ctx.localPathSet.has(movedFromFile.file_path.toLowerCase())) {
      pdmData = movedFromFile
      isMovedFile = true
    }
  }

  // For a moved file, pending edits may still be stored under the old path.
  const recoveredPending =
    lookups.pendingMetadata.get(localFile.path) ||
    ctx.persistedPendingMetadata[localFile.path] ||
    (isMovedFile && pdmData?.file_path
      ? lookups.pendingByServerPath.get(pdmData.file_path.toLowerCase()) ||
        ctx.persistedPendingMetadata[buildFullPath(ctx.vaultPath, pdmData.file_path)]
      : undefined)

  // An edit the server already holds is not an edit; left pending, it would mark the file as
  // needing check-in forever.
  const preservedPending = dropCommittedPendingMetadata(recoveredPending, pdmData)

  let diffStatus: LocalFile['diffStatus']
  let computedLocalVersion = existingLocalVersion
  if (!pdmData) {
    const untracked = classifyWithoutServerRow({
      ignored: ctx.isIgnoredPath(localFile.relativePath),
      syncIndexEntry: ctx.localSyncIndex.get(lookupKey),
      modifiedTime: localFile.modifiedTime,
    })
    diffStatus = untracked.diffStatus
    if (untracked.editedSinceOrphaned) ctx.orphansEditedSinceServerRowLost.add(lookupKey)
  } else {
    const classified = classifyAgainstServerRow({
      row: pdmData,
      moved: isMovedFile,
      localHash: effectiveLocalHash,
      modifiedTime: localFile.modifiedTime,
      localVersion: existingLocalVersion,
      userId: ctx.userId,
      hasPendingMetadata: !!preservedPending && Object.keys(preservedPending).length > 0,
    })
    diffStatus = classified.diffStatus
    computedLocalVersion = classified.localVersion
  }

  // Pending values are deliberately not merged into pdmData: readers overlay pending over
  // committed at render time (src/lib/metadata/overlay.ts).
  let finalPdmData = pdmData
  const recentlyModifiedData = lookups.recentlyModifiedPdmData.get(localFile.path)
  if (recentlyModifiedData && pdmData) {
    finalPdmData = mergePdmFileData(recentlyModifiedData, {
      checked_out_by: pdmData.checked_out_by,
      checked_out_at: pdmData.checked_out_at,
    })
    window.electronAPI?.log('debug', '[LoadFiles] SKIP merge for recently modified file', {
      path: localFile.path,
      serverPartNumber: pdmData?.part_number,
      preservedPartNumber: recentlyModifiedData.part_number,
      reason: 'recently_modified',
    })
  }

  if (finalPdmData?.id) {
    const preservedUserInfo = lookups.checkedOutUsers.get(finalPdmData.id)
    const profile = isCheckoutProfileForOwner(preservedUserInfo, finalPdmData.checked_out_by)
      ? preservedUserInfo
      : finalPdmData.checked_out_user
    finalPdmData = reconcileCheckoutProfile(finalPdmData, profile)
  }

  // A detected move mirrors the part number into pending metadata, so it survives a later load
  // that fails to re-detect the move (e.g. inode data lost).
  let finalPending = preservedPending
  if (isMovedFile && pdmData?.part_number && !preservedPending?.part_number) {
    finalPending = { ...preservedPending, part_number: pdmData.part_number }
  }

  // Only the failure is logged: logging every move cost hundreds of IPC calls per load from
  // inside this loop.
  if (isMovedFile && !!pdmData?.part_number && !finalPending?.part_number) {
    window.electronAPI?.log('warn', '[LoadFiles] Moved file lost its part number', {
      oldPath: pdmData?.file_path,
      newPath: localFile.relativePath,
      pdmPartNumber: pdmData?.part_number ?? null,
      preservedPartNumber: preservedPending?.part_number ?? null,
    })
  }

  return {
    ...localFile,
    pdmData: finalPdmData || undefined,
    isSynced: !!pdmData,
    diffStatus,
    localActiveVersion: existingLocalActiveVersion,
    localVersion: computedLocalVersion,
    localHash: effectiveLocalHash,
    pendingMetadata: finalPending,
  }
}

/** One sync index row written after a load (see updateInodes). */
export interface SyncIndexInodeEntry {
  path: string
  ino: number
  localVersion?: number
  localHash?: string
  hashStamp?: HashStamp
  localOnly?: boolean
}

/**
 * The sync index rows a load persists for every matched local file: the inode for rename
 * detection, and the version and hash for accurate status after a restart. Only a hash checked
 * against the disk this load is stamped; a stale or unverified one is written unstamped.
 */
export function buildSyncIndexEntries(
  localFiles: readonly LocalFile[],
  rehashPaths: ReadonlySet<string>,
): SyncIndexInodeEntry[] {
  const inodeEntries: SyncIndexInodeEntry[] = []
  for (const f of localFiles) {
    // A 'moved_away' stub has no disk presence and therefore no `ino` - this check excludes it
    // on that basis alone, but the diffStatus guard is kept explicit rather than assumed.
    if (!f.isDirectory && f.ino && f.ino > 0 && f.pdmData && f.diffStatus !== 'moved_away') {
      inodeEntries.push({
        path: f.relativePath,
        ino: f.ino,
        localVersion: f.localVersion,
        localHash: f.localHash,
        hashStamp: f.localHash && !rehashPaths.has(f.relativePath) ? stampOf(f) : undefined,
        // A moved file sits at a path the server does not have yet.
        localOnly: f.diffStatus === 'moved',
      })
      if (
        f.diffStatus === 'moved' &&
        f.pdmData.file_path &&
        f.pdmData.file_path.toLowerCase() !== f.relativePath.toLowerCase()
      ) {
        // The old server path, pinned to the same inode so the move stays detectable. Not
        // flagged: it is on the server, so the prune leaves it alone anyway, and flagging it
        // would make the prune keep skipping it after its server row went away.
        inodeEntries.push({ path: f.pdmData.file_path, ino: f.ino })
      }
    }
  }
  return inodeEntries
}
