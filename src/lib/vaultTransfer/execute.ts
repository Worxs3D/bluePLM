/**
 * Carrying out a cross-vault transfer plan.
 *
 * Every side effect goes through `TransferEngineDeps`, so the order of operations, and what is
 * undone or kept when one of them fails, is what the tests exercise rather than what they mock
 * around. The real dependencies live in `./deps.ts`.
 *
 * The order for each file is the safety argument:
 *
 *   1. Read the bytes (only for content the server does not already hold).
 *   2. Refuse if the destination path is taken on disk.
 *   3. Insert the destination row, insert-only. The database, not this process, is the judge of
 *      whether the path is free, so a race with a colleague ends in a refusal, never an overwrite.
 *   4. Copy to the destination's disk and check the hash. A copy that does not verify is removed.
 *
 * The row comes before the disk copy so that a failure never leaves a file on the destination's
 * disk that the vault knows nothing about. The cost is the opposite case, a row whose local copy
 * failed, which reads as a cloud-only file and is reported as such.
 */

import { CONCURRENT_OPERATIONS, processWithConcurrency } from '@/lib/concurrency'

import { buildTransferMetadata, type TransferMetadata } from './metadata'
import type { PlannedTransferFile, VaultTransferPlan } from './types'

export interface InsertDestinationFileArgs {
  destRelativePath: string
  name: string
  extension: string
  size: number
  hash: string
  /** Null states that the content is already in storage. */
  base64: string | null
  metadata: TransferMetadata
  /** Source row to copy version history from. */
  copiedFromFileId: string | null
}

export type InsertDestinationFileOutcome =
  | { ok: true; fileId: string; version: number }
  | { ok: false; reason: 'exists' | 'error'; message?: string }

export interface TransferEngineDeps {
  readSource: (absolutePath: string) => Promise<{
    success: boolean
    data?: string
    hash?: string
    size?: number
    locked?: boolean
  }>
  destinationFileExists: (destRelativePath: string) => Promise<boolean>
  insertDestinationFile: (args: InsertDestinationFileArgs) => Promise<InsertDestinationFileOutcome>
  copyToDestination: (
    sourceAbsolutePath: string,
    destRelativePath: string,
  ) => Promise<{ success: boolean; error?: string }>
  hashDestination: (destRelativePath: string) => Promise<string | null>
  removeFromDestination: (destRelativePath: string) => Promise<void>
  protectDestination: (destRelativePath: string) => Promise<void>
  createDestinationFolderOnDisk: (destRelativePath: string) => Promise<boolean>
  createDestinationFolderOnServer: (destRelativePath: string) => Promise<boolean>
  copyReferences: (
    pairs: ReadonlyArray<{ sourceFileId: string; destFileId: string }>,
  ) => Promise<{ copied: number; error?: string }>
  isCancelled: () => boolean
  onItemDone?: (done: number, total: number) => void
  log?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void
}

export type TransferFailure =
  | 'source-locked'
  | 'source-unreadable'
  | 'exists-on-disk'
  | 'exists-in-destination'
  | 'server-error'
  | 'cancelled'

/**
 * What became of the file's local copy in the destination.
 *
 * - `copied`: on disk, hash verified, marked read-only like any checked-in file.
 * - `not-needed`: cloud-only content, deliberately not downloaded.
 * - `failed`: the copy itself failed. The destination row exists and reads as cloud-only.
 * - `diverged`: the copy did not match the hash it was meant to have, which means the source
 *   file changed on disk after the vault last saw it. The copy was removed.
 */
export type LocalCopyOutcome = 'copied' | 'not-needed' | 'failed' | 'diverged'

export interface TransferItemResult {
  planned: PlannedTransferFile
  status: 'transferred' | 'failed'
  failure?: TransferFailure
  message?: string
  destFileId?: string
  localCopy?: LocalCopyOutcome
}

export interface TransferRunResult {
  results: TransferItemResult[]
  foldersCreated: number
  folderFailures: string[]
  referencesCopied: number
  referenceError?: string
  cancelled: boolean
}

function parentOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}

function failed(
  planned: PlannedTransferFile,
  failure: TransferFailure,
  message?: string,
): TransferItemResult {
  return { planned, status: 'failed', failure, message }
}

/**
 * A moved file's source may only be removed once the destination has all of it. A transfer whose
 * local copy failed or did not verify has the server's content but not necessarily the user's, so
 * its source stays. Everything else that transferred is safe to remove.
 */
export function canRemoveSource(result: TransferItemResult): boolean {
  return (
    result.status === 'transferred' &&
    (result.localCopy === 'copied' || result.localCopy === 'not-needed')
  )
}

/** The facts about a source row that decide whether a Move may still delete it. */
export interface SourceRowState {
  id: string
  version: number
  content_hash: string | null
  checked_out_by: string | null
  deleted_at: string | null
}

/**
 * Whether the source row is still the one that was transferred. Between planning and deleting,
 * somebody may have checked in a newer version or checked the file out; deleting it then would
 * discard work the destination never received.
 */
export function isSourceRowUnchanged(
  planned: PlannedTransferFile,
  row: SourceRowState | undefined,
): boolean {
  if (!row) return false
  if (row.deleted_at !== null) return false
  if (row.checked_out_by !== null) return false
  return row.version === planned.sourceVersion && row.content_hash === planned.serverHash
}

export async function runVaultTransfer(
  plan: VaultTransferPlan,
  deps: TransferEngineDeps,
  concurrency: number = CONCURRENT_OPERATIONS,
): Promise<TransferRunResult> {
  const log = deps.log ?? (() => {})

  // One server folder request per directory, however many files land in it at once.
  const serverFolders = new Map<string, Promise<boolean>>()
  const folderFailures = new Set<string>()

  function ensureServerFolder(destRelativePath: string): Promise<boolean> {
    if (destRelativePath === '') return Promise.resolve(true)
    let pending = serverFolders.get(destRelativePath)
    if (!pending) {
      pending = deps.createDestinationFolderOnServer(destRelativePath).then((ok) => {
        if (!ok) folderFailures.add(destRelativePath)
        return ok
      })
      serverFolders.set(destRelativePath, pending)
    }
    return pending
  }

  let doneCount = 0

  async function transferOne(planned: PlannedTransferFile): Promise<TransferItemResult> {
    const result = await transferFile(planned)
    doneCount++
    deps.onItemDone?.(doneCount, plan.files.length)
    return result
  }

  async function transferFile(planned: PlannedTransferFile): Promise<TransferItemResult> {
    if (deps.isCancelled()) return failed(planned, 'cancelled')

    const { source, destRelativePath, strategy } = planned
    let hash = planned.serverHash
    let base64: string | null = null
    let size = planned.size

    if (strategy === 'upload-local') {
      const read = await deps.readSource(source.path)
      if (!read.success || read.data === undefined || !read.hash) {
        return failed(planned, read.locked ? 'source-locked' : 'source-unreadable')
      }
      hash = read.hash
      base64 = read.data
      size = read.size ?? size
    }

    if (!hash) return failed(planned, 'server-error', 'No stored content to copy')

    if (await deps.destinationFileExists(destRelativePath)) {
      return failed(planned, 'exists-on-disk')
    }

    await ensureServerFolder(parentOf(destRelativePath))

    const metadata = buildTransferMetadata(source)
    const inserted = await deps.insertDestinationFile({
      destRelativePath,
      name: destRelativePath.slice(destRelativePath.lastIndexOf('/') + 1),
      extension: source.extension,
      size,
      hash,
      base64,
      metadata,
      copiedFromFileId: planned.sourceFileId,
    })

    if (!inserted.ok) {
      return failed(
        planned,
        inserted.reason === 'exists' ? 'exists-in-destination' : 'server-error',
        inserted.message,
      )
    }

    if (strategy === 'cloud') {
      return {
        planned,
        status: 'transferred',
        destFileId: inserted.fileId,
        localCopy: 'not-needed',
      }
    }

    const localCopy = await copyToDisk(planned, hash)
    return { planned, status: 'transferred', destFileId: inserted.fileId, localCopy }
  }

  async function copyToDisk(
    planned: PlannedTransferFile,
    expectedHash: string,
  ): Promise<LocalCopyOutcome> {
    const { destRelativePath, source } = planned

    const copied = await deps.copyToDestination(source.path, destRelativePath)
    if (!copied.success) {
      log('warn', 'Local copy failed after the destination row was created', {
        destRelativePath,
        error: copied.error,
      })
      // A partial file may be there; the path was free a moment ago, so it is ours to remove.
      await deps.removeFromDestination(destRelativePath)
      return 'failed'
    }

    const actualHash = await deps.hashDestination(destRelativePath)
    if (actualHash !== expectedHash) {
      log('warn', 'Local copy does not match the content that was transferred, removing it', {
        destRelativePath,
        expectedHash,
        actualHash,
      })
      await deps.removeFromDestination(destRelativePath)
      return actualHash === null ? 'failed' : 'diverged'
    }

    await deps.protectDestination(destRelativePath)
    return 'copied'
  }

  const results = await processWithConcurrency(plan.files, concurrency, transferOne)

  // Selected folders, including empty ones. After the files, so a folder nobody could put a file
  // in does not appear to have been a success, and before the references, which need nothing of it.
  let foldersCreated = 0
  if (!deps.isCancelled()) {
    for (const folder of plan.folders) {
      const onServer = await ensureServerFolder(folder)
      const onDisk = await deps.createDestinationFolderOnDisk(folder)
      if (onServer && onDisk) foldersCreated++
      else if (!onDisk) folderFailures.add(folder)
    }
  }

  // References between files that both arrived. A reference to a file that stayed behind has
  // nothing to point at in the destination, so it is not copied rather than dangling.
  const pairs = results.flatMap((result) =>
    result.status === 'transferred' && result.planned.sourceFileId && result.destFileId
      ? [{ sourceFileId: result.planned.sourceFileId, destFileId: result.destFileId }]
      : [],
  )
  let referencesCopied = 0
  let referenceError: string | undefined
  if (pairs.length > 1) {
    const copiedReferences = await deps.copyReferences(pairs)
    referencesCopied = copiedReferences.copied
    referenceError = copiedReferences.error
  }

  return {
    results,
    foldersCreated,
    folderFailures: [...folderFailures],
    referencesCopied,
    referenceError,
    cancelled: results.some((result) => result.failure === 'cancelled'),
  }
}
