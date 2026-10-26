import { buildFullPath } from '@/lib/utils/path'
import { mergePdmFileData } from '@/types/pdm'
import type { FileLocationUpdate, LocalFile, ServerFile } from './types'

interface LocationState {
  files: LocalFile[]
  serverFiles: ServerFile[]
  selectedFiles: string[]
}

/** Every folder above a vault-relative path, lower-cased: `a/b/c.txt` -> `a`, `a/b`. */
function ancestorsOf(path: string): string[] {
  const parts = path.toLowerCase().split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

/**
 * Drop the cloud folders a realtime update emptied: folders that held a row that has now moved
 * or gone, with nothing left in them. They exist only to hold cloud rows, a load would not show
 * them, and left behind they were ghost folders (a folder renamed twice left the first name).
 */
export function pruneVacatedCloudFolders(files: LocalFile[], vacatedPaths: readonly string[]): LocalFile[] {
  if (vacatedPaths.length === 0) return files
  const vacated = new Set(vacatedPaths.flatMap(ancestorsOf))
  const occupied = new Set<string>()
  for (const f of files) for (const folder of ancestorsOf(f.relativePath)) occupied.add(folder)
  return files.filter((f) => {
    const lower = f.relativePath.toLowerCase()
    return !(f.isDirectory && f.diffStatus === 'cloud' && vacated.has(lower) && !occupied.has(lower))
  })
}

const extensionOf = (name: string) =>
  name.includes('.') ? '.' + (name.split('.').pop()?.toLowerCase() || '') : ''

/** Statuses of a row with nothing on this machine's disk behind it. */
const NOT_ON_DISK = new Set(['cloud', 'moved_away', 'deleted'])

/**
 * The store after realtime reports files at new server paths (another user, or another machine,
 * moved or renamed them). Applied in one pass for a burst, since a folder move sends one event
 * per file.
 *
 * A row with nothing on disk (cloud-only, a `moved_away` stub) follows the server to its new path.
 * A row with a local copy does not: the bytes are still at the old path on this disk, and moving
 * only the row made the store show a synced file where nothing exists, after which a reload took
 * the real copy for an orphan and recycled it. It becomes what a load shows for the same disk and
 * server: a pending move ('moved') at the local path, with a `moved_away` stub at the server's
 * path. Re-align or Resolve Pending Moves then settles it. A case-only rename moves nothing on a
 * Windows disk, so the row keeps the disk's spelling and only its server row changes.
 */
export function applyServerLocationUpdates(
  state: LocationState,
  updates: readonly FileLocationUpdate[],
  vaultPath: string,
): LocationState {
  const updateMap = new Map(updates.map((u) => [u.fileId, u]))

  // The row holding each moved file's local copy, if this machine has one.
  const localHolder = new Map<string, LocalFile>()
  for (const f of state.files) {
    const id = f.pdmData?.id
    if (!id || f.isDirectory || !updateMap.has(id) || NOT_ON_DISK.has(f.diffStatus ?? '')) continue
    localHolder.set(id, f)
  }

  // Build a comprehensive set of existing paths (case-insensitive) to prevent duplicates
  // Include ALL files/folders, not just directories, to catch edge cases where
  // an entry might exist with wrong isDirectory flag or from concurrent updates
  const existingPaths = new Set(state.files.map((f) => f.relativePath.toLowerCase()))
  const existingFullPaths = new Set(state.files.map((f) => f.path.toLowerCase()))

  // Pre-create all parent folders needed (only if they truly don't exist)
  const newFolders: LocalFile[] = []
  for (const update of updates) {
    const pathParts = update.newRelativePath.split('/')
    let currentPath = ''
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
      const lowerPath = currentPath.toLowerCase()
      const fullPath = buildFullPath(vaultPath, currentPath)
      if (existingPaths.has(lowerPath) || existingFullPaths.has(fullPath.toLowerCase())) continue
      newFolders.push({
        name: pathParts[i],
        path: fullPath,
        relativePath: currentPath,
        isDirectory: true,
        extension: '',
        size: 0,
        modifiedTime: '',
        diffStatus: 'cloud',
      })
      existingPaths.add(lowerPath)
      existingFullPaths.add(fullPath.toLowerCase())
    }
  }

  const oldPathToNewPath = new Map<string, string>()
  const vacatedPaths: string[] = []
  const files: LocalFile[] = []
  const stubs: LocalFile[] = []
  for (const f of state.files) {
    const id = f.pdmData?.id
    const update = id ? updateMap.get(id) : undefined
    if (!update || !f.pdmData) {
      files.push(f)
      continue
    }
    const holder = localHolder.get(update.fileId)
    const pdmData = mergePdmFileData(f.pdmData, update.pdmData)

    if (!holder) {
      // Nothing on disk: the row follows the server.
      vacatedPaths.push(f.relativePath)
      const newFullPath = buildFullPath(vaultPath, update.newRelativePath)
      oldPathToNewPath.set(f.path, newFullPath)
      files.push({
        ...f,
        path: newFullPath,
        relativePath: update.newRelativePath,
        name: update.newFileName,
        extension: extensionOf(update.newFileName),
        pdmData,
      })
      continue
    }

    // A stub for this file is rebuilt from the holder below.
    if (f !== holder) {
      vacatedPaths.push(f.relativePath)
      continue
    }

    if (update.newRelativePath.toLowerCase() === holder.relativePath.toLowerCase()) {
      // The server now records the path this disk has (a case-only rename, or the move this
      // machine was holding as pending): one row, in the disk's spelling.
      files.push({ ...holder, pdmData, diffStatus: holder.diffStatus === 'moved' ? undefined : holder.diffStatus })
      continue
    }

    files.push({ ...holder, pdmData, diffStatus: 'moved' })
    if (!existingPaths.has(update.newRelativePath.toLowerCase()) || isStubOf(state.files, update)) {
      stubs.push({
        name: update.newFileName,
        path: buildFullPath(vaultPath, update.newRelativePath),
        relativePath: update.newRelativePath,
        isDirectory: false,
        extension: extensionOf(update.newFileName),
        size: pdmData.file_size || 0,
        modifiedTime: pdmData.updated_at || '',
        pdmData,
        isSynced: false,
        diffStatus: 'moved_away',
        movedToRelativePath: holder.relativePath,
      })
    }
  }

  // Mirror the same path changes onto state.serverFiles. Without this,
  // refreshCurrentFolder iterates a stale serverFiles list and resurrects
  // a ghost cloud-only entry at the old path.
  const serverFiles = state.serverFiles.map((sf) => {
    const update = updateMap.get(sf.id)
    if (!update) return sf
    return {
      ...sf,
      file_path: update.newRelativePath,
      name: update.newFileName,
      extension: extensionOf(update.newFileName),
    }
  })

  return {
    files: pruneVacatedCloudFolders([...files, ...stubs, ...newFolders], vacatedPaths),
    serverFiles,
    selectedFiles: state.selectedFiles.map((p) => oldPathToNewPath.get(p) || p),
  }
}

/** The row already at the update's new path is this file's own stub (replaced, not a clash). */
function isStubOf(files: readonly LocalFile[], update: FileLocationUpdate): boolean {
  const lower = update.newRelativePath.toLowerCase()
  return files.some(
    (f) => f.relativePath.toLowerCase() === lower && f.diffStatus === 'moved_away' && f.pdmData?.id === update.fileId,
  )
}
