/**
 * The second half of a Move: taking the source files away once the destination has them.
 *
 * Nothing here runs unless the first half verified a file. Each step keeps a file if the step
 * before it could not be trusted, and each failure leaves the file in the source vault rather than
 * in neither: a Move that stops anywhere along this path costs the user a duplicate, never a loss.
 *
 *   1. Only files whose destination copy is verified are candidates (`canRemoveSource`).
 *   2. The source row must still be the one that was transferred. Somebody may have checked in a
 *      newer version since the plan was made, and deleting it would discard work the destination
 *      never saw.
 *   3. The local file goes first, to the Recycle Bin. A file that is open in SolidWorks cannot be
 *      removed; it stays, and so does its row, so the vault never says "deleted" about a file that
 *      is still on someone's disk and in use.
 *   4. The row is soft-deleted, which is the trash the vault already has, so it can be restored.
 *   5. A folder is removed only when everything under it went.
 */

import { isPathWithinDirectory } from '@/lib/utils/path'
import type { LocalFile } from '@/stores/types'

import { canRemoveSource, isSourceRowUnchanged, type SourceRowState, type TransferItemResult } from './execute'
import type { PlannedTransferFile } from './types'

export type KeptSourceReason =
  /** The destination copy did not fully arrive, so the source is the only whole copy. */
  | 'not-verified'
  /** A newer version, a checkout or a deletion happened since the plan was made. */
  | 'source-changed'
  /** The server could not be asked whether the source row still matches. */
  | 'source-unverified'
  /** The local file could not be removed, typically because it is open in another program. */
  | 'local-delete-failed'
  /** The local file is gone but the server refused to delete the row. */
  | 'server-delete-failed'

export interface KeptSource {
  planned: PlannedTransferFile
  reason: KeptSourceReason
  message?: string
}

export interface RemoveSourcesDeps {
  fetchSourceRowStates: (
    ids: readonly string[],
  ) => Promise<{ ok: true; rows: Map<string, SourceRowState> } | { ok: false; error: string }>
  /** Recycle local files. Returns the absolute paths that were removed. */
  deleteLocalFiles: (absolutePaths: string[]) => Promise<Set<string>>
  /** Soft-delete rows. Returns the ids that were deleted and a message per id that was not. */
  softDeleteRows: (ids: string[]) => Promise<{ deleted: Set<string>; errors: Map<string, string> }>
  directoryState: (absolutePath: string) => Promise<'empty' | 'not-empty' | 'missing'>
  trashDirectory: (absolutePath: string) => Promise<boolean>
  deleteServerFolder: (relativePath: string) => Promise<boolean>
  buildPath: (relativePath: string) => string
}

export interface RemoveSourcesInput {
  results: readonly TransferItemResult[]
  sourceFolders: readonly string[]
  vaultFiles: readonly LocalFile[]
}

export interface RemoveSourcesOutcome {
  removed: PlannedTransferFile[]
  kept: KeptSource[]
  /** Source folders (vault-relative) that were removed. */
  foldersRemoved: string[]
}

function isStub(file: LocalFile): boolean {
  return file.diffStatus === 'moved_away'
}

function hasLocalFile(planned: PlannedTransferFile): boolean {
  return planned.strategy !== 'cloud'
}

function depth(relativePath: string): number {
  return relativePath.split('/').length
}

export async function removeMovedSources(
  input: RemoveSourcesInput,
  deps: RemoveSourcesDeps,
): Promise<RemoveSourcesOutcome> {
  const kept: KeptSource[] = []
  let candidates: PlannedTransferFile[] = []

  for (const result of input.results) {
    if (result.status !== 'transferred') continue
    if (canRemoveSource(result)) candidates.push(result.planned)
    else kept.push({ planned: result.planned, reason: 'not-verified' })
  }

  // 2. Is the source row still what was transferred?
  const tracked = candidates.filter((planned) => planned.sourceFileId !== null)
  if (tracked.length > 0) {
    const states = await deps.fetchSourceRowStates(
      tracked.map((planned) => planned.sourceFileId as string),
    )

    if (!states.ok) {
      const trackedSet = new Set(tracked)
      for (const planned of tracked) {
        kept.push({ planned, reason: 'source-unverified', message: states.error })
      }
      candidates = candidates.filter((planned) => !trackedSet.has(planned))
    } else {
      const changed = new Set<PlannedTransferFile>()
      for (const planned of tracked) {
        if (!isSourceRowUnchanged(planned, states.rows.get(planned.sourceFileId as string))) {
          changed.add(planned)
          kept.push({ planned, reason: 'source-changed' })
        }
      }
      candidates = candidates.filter((planned) => !changed.has(planned))
    }
  }

  // 3. Local files.
  const localPlanned = candidates.filter(hasLocalFile)
  const removedLocal =
    localPlanned.length > 0
      ? await deps.deleteLocalFiles(localPlanned.map((planned) => planned.source.path))
      : new Set<string>()

  const stuckLocal = new Set<PlannedTransferFile>()
  for (const planned of localPlanned) {
    if (!removedLocal.has(planned.source.path)) {
      stuckLocal.add(planned)
      kept.push({ planned, reason: 'local-delete-failed' })
    }
  }
  candidates = candidates.filter((planned) => !stuckLocal.has(planned))

  // 4. Rows.
  const removed: PlannedTransferFile[] = []
  const rowIds = candidates.flatMap((planned) =>
    planned.sourceFileId !== null ? [planned.sourceFileId] : [],
  )
  const rowOutcome =
    rowIds.length > 0
      ? await deps.softDeleteRows(rowIds)
      : { deleted: new Set<string>(), errors: new Map<string, string>() }

  for (const planned of candidates) {
    if (planned.sourceFileId === null || rowOutcome.deleted.has(planned.sourceFileId)) {
      removed.push(planned)
    } else {
      kept.push({
        planned,
        reason: 'server-delete-failed',
        message: rowOutcome.errors.get(planned.sourceFileId),
      })
    }
  }

  // 5. Folders: only those with nothing left in them.
  const goneByPath = new Set(removed.map((planned) => planned.sourceRelativePath.toLowerCase()))
  const foldersRemoved: string[] = []

  const foldersDeepestFirst = [...input.sourceFolders].sort((a, b) => depth(b) - depth(a))
  for (const folder of foldersDeepestFirst) {
    const leftBehind = input.vaultFiles.some(
      (file) =>
        !file.isDirectory &&
        !isStub(file) &&
        isPathWithinDirectory(file.relativePath, folder) &&
        !goneByPath.has(file.relativePath.toLowerCase()),
    )
    if (leftBehind) continue

    const absolutePath = deps.buildPath(folder)
    // Never a recursive delete: a folder goes only if it is empty on disk, which also protects
    // anything the file list did not show (hidden files, lock files). A folder that is not on
    // disk at all is cloud-only and loses just its server row.
    const state = await deps.directoryState(absolutePath)
    if (state === 'not-empty') continue
    if (state === 'empty' && !(await deps.trashDirectory(absolutePath))) continue

    await deps.deleteServerFolder(folder)
    foldersRemoved.push(folder)
  }

  return { removed, kept, foldersRemoved }
}