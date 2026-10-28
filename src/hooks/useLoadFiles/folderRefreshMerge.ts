import type { LocalFile, ServerFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'
import { classifyAgainstServerRow, classifyWithoutServerRow } from './fileClassification'
import { cloudRowsForFolderRefresh } from './refreshFolderCloudRows'

/** A row from `listFolderFast`: the main process attaches a hash only while its stamp still holds. */
export type FolderScanEntry = LocalFile & { hash?: string }

export interface FolderRefreshInput {
  existingFiles: readonly LocalFile[]
  serverFiles: readonly ServerFile[]
  /** The contents of the folder, as scanned. */
  scanned: readonly FolderScanEntry[]
  /** Relative path of the refreshed folder; '' for the vault root. */
  folderPath: string
  vaultPath: string
  userId: string | undefined
  isIgnoredPath: (relativePath: string) => boolean
}

export interface FolderRefreshResult {
  combinedFiles: LocalFile[]
  refreshedCount: number
  suppressedClaimedServerPaths: number
  skippedHashDuplicates: number
  skippedHashless: number
}

/**
 * Merges a scan of one folder into the store's rows, without a server fetch: server data comes
 * from the store's existing rows, which carry the full pdmData (version, part number, checkout).
 * Each file is classified by the same rules as the full load (fileClassification.ts).
 */
export function mergeFolderRefresh(input: FolderRefreshInput): FolderRefreshResult {
  const { existingFiles, serverFiles, scanned, folderPath, vaultPath } = input

  // listFolderFast returns the folder's contents, not the folder's own entry, which has to stay
  // so navigation back works.
  const currentFolderEntry = folderPath
    ? existingFiles.find(
        (f) => f.relativePath.toLowerCase() === folderPath.toLowerCase() && f.isDirectory,
      )
    : undefined

  // Refreshing the root replaces everything.
  const folderPrefix = folderPath ? folderPath.toLowerCase() + '/' : ''
  const filesOutsideFolder = existingFiles.filter((f) => {
    if (folderPath === '') return false
    const relPath = f.relativePath.toLowerCase()
    return !relPath.startsWith(folderPrefix) && relPath !== folderPath.toLowerCase()
  })

  const existingPdmMap = new Map<string, PDMFile>()
  const existingByPath = new Map<string, LocalFile>()
  for (const f of existingFiles) {
    const key = f.relativePath.toLowerCase()
    existingByPath.set(key, f)
    if (f.pdmData) existingPdmMap.set(key, f.pdmData)
  }

  const serverPathSet = new Set<string>()
  for (const sf of serverFiles) serverPathSet.add(sf.file_path.toLowerCase())

  // Server paths that a local entry somewhere else already accounts for.
  //
  // The full load resolves moves (by inode, then by content hash) and then emits a 'moved_away'
  // stub at the old server path instead of a phantom cloud-only row there. That resolution lives
  // in the store, as a local entry whose pdmData points at a different path - so it can be read
  // back here rather than recomputed. Without this, every unreconciled move is re-added as a
  // cloud-only file at its old path: one vault with 466 moved files gained 810 phantom rows and
  // 58 phantom folders per press of Refresh. The destination is kept so the cloud rows below can
  // rebuild the same 'moved_away' stub the full load would produce.
  const claimedServerPathToLocalPath = new Map<string, string>()
  for (const f of existingFiles) {
    if (f.isDirectory || !f.pdmData?.file_path) continue
    const serverPath = f.pdmData.file_path.toLowerCase()
    if (serverPath !== f.relativePath.toLowerCase()) {
      claimedServerPathToLocalPath.set(serverPath, f.relativePath)
    }
  }

  const refreshedFolderFiles: LocalFile[] = scanned.map((localFile) => {
    if (localFile.isDirectory) return { ...localFile, localHash: localFile.hash }
    return classifyFolderEntry(localFile, existingByPath, existingPdmMap, serverPathSet, input)
  })

  // Same hash-move skip as `reconcileCloudFiles`: a CAD vault is full of intentional copies, and
  // treating "this hash is already local" as a new cloud file resurrects hashless ghosts Download
  // cannot fetch (Rai's 642).
  const localPathSet = new Set(scanned.map((f) => f.relativePath.toLowerCase()))
  const localContentHashes = new Set<string>()
  for (const localFile of scanned) {
    if (!localFile.isDirectory && localFile.hash) localContentHashes.add(localFile.hash)
  }
  for (const existing of existingFiles) {
    if (existing.isDirectory || !existing.localHash) continue
    const existingPath = existing.relativePath.toLowerCase()
    const inThisFolder =
      folderPath === '' ||
      existingPath === folderPath.toLowerCase() ||
      existingPath.startsWith(folderPrefix)
    if (inThisFolder) continue
    localContentHashes.add(existing.localHash)
  }

  const cloudRows = cloudRowsForFolderRefresh({
    serverFiles: [...serverFiles],
    localPathSet,
    existingPdmMap,
    claimedServerPathToLocalPath,
    localContentHashes,
    folderPath,
    folderPrefix,
    vaultPath,
  })
  refreshedFolderFiles.push(...cloudRows.rows)

  const combinedFiles = [
    ...filesOutsideFolder,
    ...refreshedFolderFiles,
    ...(currentFolderEntry ? [currentFolderEntry] : []),
  ]
  combinedFiles.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.relativePath.localeCompare(b.relativePath)
  })

  return {
    combinedFiles,
    refreshedCount: refreshedFolderFiles.length,
    suppressedClaimedServerPaths: claimedServerPathToLocalPath.size,
    skippedHashDuplicates: cloudRows.skippedHashDuplicates,
    skippedHashless: cloudRows.skippedHashless,
  }
}

function classifyFolderEntry(
  localFile: FolderScanEntry,
  existingByPath: ReadonlyMap<string, LocalFile>,
  existingPdmMap: ReadonlyMap<string, PDMFile>,
  serverPathSet: ReadonlySet<string>,
  input: FolderRefreshInput,
): LocalFile {
  const lookupKey = localFile.relativePath.toLowerCase()
  const existing = existingByPath.get(lookupKey)
  const pdmData = existingPdmMap.get(lookupKey)
  const base = {
    ...localFile,
    localHash: localFile.hash,
    pdmData: pdmData || undefined,
    isSynced: !!pdmData,
    localActiveVersion: existing?.localActiveVersion,
  }

  if (!pdmData) {
    // On the server with no row in the store yet should not happen; it is left unclassified.
    if (serverPathSet.has(lookupKey)) {
      return { ...base, diffStatus: undefined, localVersion: existing?.localVersion }
    }
    // The store row remembers an orphan, which the sync index would otherwise tell the full load.
    const { diffStatus } = classifyWithoutServerRow({
      ignored: input.isIgnoredPath(localFile.relativePath),
      syncIndexEntry: existing?.diffStatus === 'deleted_remote' ? {} : undefined,
      modifiedTime: localFile.modifiedTime,
    })
    return { ...base, diffStatus, localVersion: existing?.localVersion }
  }

  // Pending edits are restored, and the file marked modified, by setFiles from the persisted copy.
  const { diffStatus, localVersion } = classifyAgainstServerRow({
    row: pdmData,
    // The server still records this file at its old path: a move awaiting check-in.
    moved: !!pdmData.file_path && pdmData.file_path.toLowerCase() !== lookupKey,
    localHash: localFile.hash,
    modifiedTime: localFile.modifiedTime,
    localVersion: existing?.localVersion,
    userId: input.userId,
    hasPendingMetadata: false,
  })
  return { ...base, diffStatus, localVersion }
}
