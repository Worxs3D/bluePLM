import { buildFullPath } from '@/lib/commands/types'
import type { LocalFile, ServerFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

/**
 * Enough of a `PDMFile` for Download to fetch the row. Refresh's server index is slim
 * (`ServerFile`); the full load's `pdmFiles` are not in scope here. Missing fields stay
 * unset rather than invented — Download keys on `content_hash`, and a later full load
 * replaces this with the complete row.
 */
export function pdmDataFromServerFile(sf: ServerFile): PDMFile {
  return {
    id: sf.id,
    file_path: sf.file_path,
    file_name: sf.name,
    extension: sf.extension,
    content_hash: sf.content_hash || null,
  } as PDMFile
}

function resolvePdmData(
  sf: ServerFile,
  existing: PDMFile | undefined,
): PDMFile | undefined {
  if (existing?.content_hash) return existing
  if (!sf.content_hash) return existing
  if (existing) {
    return { ...existing, content_hash: sf.content_hash, id: existing.id || sf.id }
  }
  return pdmDataFromServerFile(sf)
}

export interface RefreshFolderCloudRowsParams {
  serverFiles: ServerFile[]
  localPathSet: ReadonlySet<string>
  existingPdmMap: ReadonlyMap<string, PDMFile>
  /** Lower-cased server path → the local relative path that already claims it. */
  claimedServerPathToLocalPath: ReadonlyMap<string, string>
  /** Content hashes already present on local disk (same set `wasMoved` uses). */
  localContentHashes: ReadonlySet<string>
  folderPath: string
  folderPrefix: string
  vaultPath: string
}

export interface RefreshFolderCloudRowsResult {
  rows: LocalFile[]
  skippedHashDuplicates: number
  skippedHashless: number
}

/**
 * Step 6 of `refreshCurrentFolder`: cloud-only rows (and `moved_away` stubs) for
 * server paths that are not on disk in this folder.
 *
 * Must agree with a full load: a server path whose `content_hash` already exists on
 * any local file is a hash-move / intentional copy, not a downloadable cloud file,
 * and a cloud row is never emitted without a hash.
 */
export function cloudRowsForFolderRefresh(
  params: RefreshFolderCloudRowsParams,
): RefreshFolderCloudRowsResult {
  const {
    serverFiles,
    localPathSet,
    existingPdmMap,
    claimedServerPathToLocalPath,
    localContentHashes,
    folderPath,
    folderPrefix,
    vaultPath,
  } = params

  const rows: LocalFile[] = []
  let skippedHashDuplicates = 0
  let skippedHashless = 0

  for (const sf of serverFiles) {
    const sfPath = sf.file_path.toLowerCase()
    const isInFolder = folderPath === '' || sfPath.startsWith(folderPrefix)
    if (!isInFolder || localPathSet.has(sfPath)) continue

    const movedToRelativePath = claimedServerPathToLocalPath.get(sfPath)
    const pdmData = resolvePdmData(sf, existingPdmMap.get(sfPath))

    if (movedToRelativePath) {
      rows.push({
        name: sf.name,
        path: buildFullPath(vaultPath, sf.file_path),
        relativePath: sf.file_path,
        isDirectory: false,
        extension: sf.extension || '',
        size: pdmData?.file_size || 0,
        modifiedTime: pdmData?.updated_at || '',
        pdmData,
        isSynced: false,
        diffStatus: 'moved_away',
        movedToRelativePath,
      })
      continue
    }

    if (!pdmData?.content_hash) {
      skippedHashless++
      continue
    }

    if (localContentHashes.has(pdmData.content_hash)) {
      skippedHashDuplicates++
      continue
    }

    rows.push({
      name: sf.name,
      path: buildFullPath(vaultPath, sf.file_path),
      relativePath: sf.file_path,
      isDirectory: false,
      extension: sf.extension || '',
      size: pdmData.file_size || 0,
      modifiedTime: pdmData.updated_at || '',
      pdmData,
      isSynced: false,
      diffStatus: 'cloud',
    })
  }

  return { rows, skippedHashDuplicates, skippedHashless }
}
