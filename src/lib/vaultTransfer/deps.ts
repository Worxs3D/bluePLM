/**
 * The real dependencies for `runVaultTransfer`: Supabase for the destination vault's rows and
 * Electron for the two disks.
 *
 * Which Electron calls are used is deliberate. `readFile` and `writeFile` are restricted to the
 * active vault's folder, and the source is the active vault, so reading it is fine; the
 * destination vault is not the working directory, so nothing here writes through `writeFile`.
 * `copyFile`, `hashFile`, `fileExists`, `createFolder` and `deleteItem` take any path, which is
 * what lets a file reach the other vault's disk without switching vaults.
 */

import { processWithConcurrency } from '@/lib/concurrency'
import { deleteFolderByPath, syncFolder } from '@/lib/supabase/files/folders'
import { isSyncFileExistsError, syncFile } from '@/lib/supabase/files/mutations'
import { softDeleteFile } from '@/lib/supabase/files/trash'
import { buildFullPath } from '@/lib/utils/path'

import type { TransferEngineDeps } from './execute'
import type { PrepareDeps } from './prepare'
import type { RemoveSourcesDeps } from './removeSources'
import { copyReferencesBetween, fetchSourceRowStates, loadDestinationIndex } from './serverOps'

/** Parallel soft-deletes. The rows are independent and each is one small request. */
const SOFT_DELETE_CONCURRENCY = 5

export interface TransferDepsInput {
  orgId: string
  userId: string
  destVaultId: string
  destVaultPath: string
  isCancelled: () => boolean
  onItemDone?: (done: number, total: number) => void
  log?: TransferEngineDeps['log']
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

/** What `syncFile` returns, spelled out: its inferred union narrows `file` to `null` after an error check. */
interface SyncFileResult {
  file: { id: string; version: number } | null
  error: unknown
}

export function createTransferDeps(input: TransferDepsInput): TransferEngineDeps {
  const electron = window.electronAPI
  if (!electron) throw new Error('Transfers between vaults need the desktop app')

  const destPath = (destRelativePath: string) => buildFullPath(input.destVaultPath, destRelativePath)

  return {
    readSource: (absolutePath) => electron.readFile(absolutePath),

    destinationFileExists: (destRelativePath) => electron.fileExists(destPath(destRelativePath)),

    insertDestinationFile: async (args) => {
      const result: SyncFileResult = await syncFile(
        input.orgId,
        input.destVaultId,
        input.userId,
        args.destRelativePath,
        args.name,
        args.extension,
        args.size,
        args.hash,
        args.base64,
        {
          partNumber: args.metadata.partNumber,
          description: args.metadata.description,
          revision: args.metadata.revision,
          customProperties: args.metadata.customProperties,
        },
        args.copiedFromFileId ?? undefined,
        { insertOnly: true },
      )

      if (result.error) {
        return isSyncFileExistsError(result.error)
          ? { ok: false, reason: 'exists' }
          : { ok: false, reason: 'error', message: errorMessage(result.error) }
      }
      const created: { id: string; version: number } | null = result.file
      if (!created) return { ok: false, reason: 'error', message: 'No row was created' }
      return { ok: true, fileId: created.id, version: created.version }
    },

    copyToDestination: async (sourceAbsolutePath, destRelativePath) => {
      const result = await electron.copyFile(sourceAbsolutePath, destPath(destRelativePath))
      return { success: result.success, error: result.error }
    },

    hashDestination: async (destRelativePath) => {
      const result = await electron.hashFile(destPath(destRelativePath))
      return result.success && result.hash ? result.hash : null
    },

    removeFromDestination: async (destRelativePath) => {
      await electron.deleteItem(destPath(destRelativePath))
    },

    protectDestination: async (destRelativePath) => {
      await electron.setReadonly(destPath(destRelativePath), true)
    },

    createDestinationFolderOnDisk: async (destRelativePath) => {
      const result = await electron.createFolder(destPath(destRelativePath))
      return result.success
    },

    createDestinationFolderOnServer: async (destRelativePath) => {
      const { error } = await syncFolder(
        input.orgId,
        input.destVaultId,
        input.userId,
        destRelativePath,
      )
      return !error
    },

    copyReferences: (pairs) => copyReferencesBetween(input.orgId, pairs),

    isCancelled: input.isCancelled,
    onItemDone: input.onItemDone,
    log: input.log,
  }
}

export function createPrepareDeps(): PrepareDeps {
  const electron = window.electronAPI
  if (!electron) throw new Error('Transfers between vaults need the desktop app')

  return {
    fileExists: (absolutePath) => electron.fileExists(absolutePath),
    loadIndex: loadDestinationIndex,
    joinPath: buildFullPath,
  }
}

export interface RemovalDepsInput {
  /** The source vault's folder. */
  vaultPath: string
  sourceVaultId: string
  userId: string
}

/** Whether a delete result means the file is really gone, not left on disk for safety. */
function removedFromDisk(result: { success: boolean; skipped?: boolean }): boolean {
  return result.success && !result.skipped
}

export function createRemovalDeps(input: RemovalDepsInput): RemoveSourcesDeps {
  const electron = window.electronAPI
  if (!electron) throw new Error('Transfers between vaults need the desktop app')

  return {
    fetchSourceRowStates,

    deleteLocalFiles: async (absolutePaths) => {
      // Deepest first, like every other batch delete, and automatic: a file the Recycle Bin
      // cannot take is left where it is rather than deleted for good. The destination holds it
      // now, but the user did not ask for an unrecoverable delete.
      const ordered = [...absolutePaths].sort(
        (left, right) => right.split(/[/\\]/).length - left.split(/[/\\]/).length,
      )
      const batch = await electron.deleteBatch(ordered, true, true)
      return new Set(batch.results.filter(removedFromDisk).map((result) => result.path))
    },

    softDeleteRows: async (ids) => {
      const deleted = new Set<string>()
      const errors = new Map<string, string>()
      await processWithConcurrency(ids, SOFT_DELETE_CONCURRENCY, async (id) => {
        const result = await softDeleteFile(id, input.userId)
        if (result.success) deleted.add(id)
        else errors.set(id, result.error ?? 'Unknown error')
      })
      return { deleted, errors }
    },

    directoryState: async (absolutePath) => {
      const result = await electron.isDirEmpty(absolutePath)
      if (result.success) return result.empty ? 'empty' : 'not-empty'
      // Only a path that is not there is "missing". Any other failure is not a reason to delete.
      return result.error === 'Directory does not exist' ? 'missing' : 'not-empty'
    },

    trashDirectory: async (absolutePath) => {
      // Re-checks emptiness in the main process and never deletes for good.
      const batch = await electron.trashEmptyDirs([absolutePath])
      return batch.results.some(removedFromDisk)
    },

    deleteServerFolder: async (relativePath) => {
      const result = await deleteFolderByPath(input.sourceVaultId, relativePath, input.userId)
      return result.success
    },

    buildPath: (relativePath) => buildFullPath(input.vaultPath, relativePath),
  }
}