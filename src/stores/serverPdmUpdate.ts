import { dropCommittedPendingMetadata } from '@/lib/pendingMetadata'
import { mergePdmFileData, type PDMFile } from '@/types/pdm'
import { pruneVacatedCloudFolders } from './serverLocationUpdate'
import type { LocalFile } from './types'

/**
 * A store row after a realtime update of its server row: the merged pdmData, the diff status
 * recomputed from it, and the pending edits the server has now accepted dropped.
 */
export function applyServerPdmUpdate(f: LocalFile, pdmData: Partial<PDMFile>): LocalFile {
  // This used to hold back the server's value for any field with a pending edit, to stop a
  // realtime event reverting what the user had typed. That defence belonged to the era when
  // the edit was copied into pdmData and the two were indistinguishable. Now the edit lives
  // only in pendingMetadata and every reader overlays it, so the row can hold what the server
  // actually says - which it must, because dropCommittedPendingMetadata decides whether an
  // edit is still owed by comparing it against this row. Holding an older true value there
  // kept edits pending after the database had already accepted them.

  // Only rows matched by their server id get here; one without a server row has nothing to update.
  if (!f.pdmData) return f

  // Realtime rows omit joined profiles. The merge helper preserves one only when
  // its ID still matches the incoming authoritative owner.
  const updatedPdmData = mergePdmFileData(f.pdmData, pdmData)

  // A pending move whose server row now records the path the bytes are at is resolved (this
  // machine's own rename or move of the file, or another machine adopting the same path).
  const moveResolved =
    f.diffStatus === 'moved' &&
    !!updatedPdmData.file_path &&
    updatedPdmData.file_path.toLowerCase() === f.relativePath.toLowerCase()

  // Recompute diff status using best available information
  let newDiffStatus = moveResolved ? undefined : f.diffStatus
  if (pdmData.content_hash && f.localHash && f.localHash.length > 0) {
    // Hash comparison is most accurate
    if (pdmData.content_hash !== f.localHash) {
      newDiffStatus = 'outdated'
    } else if (f.diffStatus === 'outdated') {
      newDiffStatus = undefined
    }
  } else if (f.localVersion !== undefined && pdmData.version !== undefined) {
    // Use tracked local version as fallback when hash unavailable
    if (f.localVersion === pdmData.version) {
      // Versions match - file is synced
      if (f.diffStatus === 'outdated') {
        newDiffStatus = undefined
      }
    } else if (f.localVersion < pdmData.version) {
      // Local is older than server
      newDiffStatus = 'outdated'
    }
    // If local > server, preserve existing status (likely 'modified')
  } else if (f.diffStatus === 'outdated' && ('content_hash' in pdmData || 'version' in pdmData)) {
    // No way to verify 'outdated' status - clear it rather than preserve potentially wrong status
    // Background hash computation will determine correct status. An update that says nothing
    // about the content (the path-only echo of a move) leaves it as it was.
    newDiffStatus = undefined
  }
  // Otherwise preserve existing diffStatus (e.g. 'modified', 'added')

  // A pending move outranks a content difference, as it does in a load (fileClassification.ts):
  // the file still has to be put where the server says before its bytes mean anything there.
  if (f.diffStatus === 'moved' && !moveResolved) newDiffStatus = 'moved'

  // Handle checkout status changes for files marked as 'deleted'
  if (
    f.diffStatus === 'deleted' &&
    'checked_out_by' in pdmData &&
    pdmData.checked_out_by === null
  ) {
    newDiffStatus = 'cloud'
  }

  // An edit the row now agrees with is no longer owed to anyone. With the row holding the
  // server's own value again this comparison is finally meaningful: while the fresh value was
  // withheld, a pending edit that had already been accepted stayed pending forever, keeping
  // the file marked modified with nothing to check in.
  //
  // A pending value equal to what the row held before this update was never an edit either: a
  // detected move mirrors the committed part number into pending metadata (mergeLocalFile.ts).
  // Kept after another user changed that part number, it became an edit of the old value, which
  // the next check-in here would have written back over theirs.
  const stillPending = f.pendingMetadata
    ? dropCommittedPendingMetadata(
        dropCommittedPendingMetadata(f.pendingMetadata, f.pdmData),
        updatedPdmData,
      )
    : undefined

  // Unsaved edits are a change the hash cannot see; they win over every status above, as in a
  // load (classifyAgainstServerRow), or a realtime update and the next load disagreed.
  if (stillPending && Object.keys(stillPending).length > 0) newDiffStatus = 'modified'

  return {
    ...f,
    pdmData: updatedPdmData,
    pendingMetadata: stillPending,
    diffStatus: newDiffStatus,
  }
}

/**
 * `applyServerPdmUpdate` for a burst of realtime updates in one pass over the store: each row's
 * updates in arrival order, so the burst ends where the same events one at a time would.
 */
export function applyServerPdmUpdates(
  files: LocalFile[],
  updates: ReadonlyArray<{ fileId: string; pdmData: Partial<PDMFile> }>,
): LocalFile[] {
  const updatesById = new Map<string, Array<Partial<PDMFile>>>()
  for (const { fileId, pdmData } of updates) {
    const list = updatesById.get(fileId)
    if (list) list.push(pdmData)
    else updatesById.set(fileId, [pdmData])
  }
  const updated = files.map((f) => {
    const pending = f.pdmData?.id === undefined ? undefined : updatesById.get(f.pdmData.id)
    return pending ? pending.reduce(applyServerPdmUpdate, f) : f
  })
  // A `moved_away` stub stands at its file's server path. Once the server path is the path of
  // the file's local copy, the move is over and the stub is a leftover, as a reload shows.
  const resolvedIds = new Set<string>()
  for (const f of updated) {
    const id = f.pdmData?.id
    if (!id || !updatesById.has(id) || f.isDirectory || f.diffStatus === 'moved_away') continue
    if (f.pdmData!.file_path?.toLowerCase() === f.relativePath.toLowerCase()) resolvedIds.add(id)
  }
  const vacatedPaths: string[] = []
  const remaining: LocalFile[] = []
  for (const f of updated) {
    const id = f.pdmData?.id
    if (f.diffStatus !== 'moved_away' || !id || !updatesById.has(id)) {
      remaining.push(f)
      continue
    }
    if (resolvedIds.has(id)) {
      vacatedPaths.push(f.relativePath)
      continue
    }
    // A stub sits at its file's server path; when an update moves that path (this machine's
    // own folder rename while another machine renamed the file), the stub moves with it.
    const serverPath = f.pdmData!.file_path
    if (serverPath && serverPath.toLowerCase() !== f.relativePath.toLowerCase()) {
      vacatedPaths.push(f.relativePath)
      remaining.push(relocated(f, serverPath))
      continue
    }
    remaining.push(f)
  }
  if (vacatedPaths.length === 0) return updated
  // A cloud folder that held only the stub goes with it: a load would not show it.
  return pruneVacatedCloudFolders(withCloudFoldersFor(remaining), vacatedPaths)
}

/** The row at `relativePath` instead (the absolute path keeps its vault root and separator). */
function relocated(f: LocalFile, relativePath: string): LocalFile {
  const root = f.path.slice(0, f.path.length - f.relativePath.length)
  const sep = root.includes('\\') ? '\\' : '/'
  const name = relativePath.split('/').pop()!
  return {
    ...f,
    relativePath,
    path: root + relativePath.split('/').join(sep),
    name,
    extension: name.includes('.') ? '.' + (name.split('.').pop()?.toLowerCase() || '') : '',
  }
}

/** Cloud folder rows for any folder above a `moved_away` stub that has no row yet. */
function withCloudFoldersFor(files: LocalFile[]): LocalFile[] {
  const present = new Set(files.map((f) => f.relativePath.toLowerCase()))
  const added: LocalFile[] = []
  for (const f of files) {
    if (f.diffStatus !== 'moved_away') continue
    const parts = f.relativePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      if (present.has(folder.toLowerCase())) continue
      present.add(folder.toLowerCase())
      const stub = relocated({ ...f, isDirectory: true, pdmData: undefined }, folder)
      added.push({ ...stub, extension: '', size: 0, modifiedTime: '', diffStatus: 'cloud', movedToRelativePath: undefined })
    }
  }
  return added.length === 0 ? files : [...files, ...added]
}

