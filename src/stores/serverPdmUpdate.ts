import { dropCommittedPendingMetadata } from '@/lib/pendingMetadata'
import { mergePdmFileData, type PDMFile } from '@/types/pdm'
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

  // Recompute diff status using best available information
  let newDiffStatus = f.diffStatus
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
  } else if (f.diffStatus === 'outdated') {
    // No way to verify 'outdated' status - clear it rather than preserve potentially wrong status
    // Background hash computation will determine correct status
    newDiffStatus = undefined
  }
  // Otherwise preserve existing diffStatus (e.g. 'modified', 'added')

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
  const stillPending = f.pendingMetadata
    ? dropCommittedPendingMetadata(f.pendingMetadata, updatedPdmData)
    : undefined

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
  return files.map((f) => {
    const pending = f.pdmData?.id === undefined ? undefined : updatesById.get(f.pdmData.id)
    return pending ? pending.reduce(applyServerPdmUpdate, f) : f
  })
}
