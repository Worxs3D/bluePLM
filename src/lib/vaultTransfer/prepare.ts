/**
 * Everything needed to plan a transfer that is not pure: what the destination holds on the
 * server and on its disk.
 *
 * The dialog calls this to preview, and the command calls it again to execute. Planning twice is
 * the point: the preview can be minutes old by the time the user confirms, and the command must
 * decide against what is true then, not against what was true when the dialog opened.
 */

import { CONCURRENT_OPERATIONS, processWithConcurrency } from '@/lib/concurrency'
import type { LocalFile } from '@/stores/types'

import { candidateDestinationPaths, normalizeDestFolder, planVaultTransfer } from './plan'
import { loadDestinationIndex } from './serverOps'
import type { VaultTransferOptions, VaultTransferPlan } from './types'

export type PrepareFailure =
  /** The destination folder is not a plain vault-relative path. */
  | 'invalid-folder'
  /** The destination vault's local folder is not there, so nothing could be copied into it. */
  | 'destination-missing'
  /** The destination vault's file list could not be read. */
  | 'destination-unreadable'

export type PrepareResult =
  | { ok: true; plan: VaultTransferPlan; serverPaths: ReadonlySet<string> }
  | { ok: false; failure: PrepareFailure; message?: string }

export interface PrepareDeps {
  fileExists: (absolutePath: string) => Promise<boolean>
  loadIndex: (
    orgId: string,
    vaultId: string,
  ) => ReturnType<typeof loadDestinationIndex>
  joinPath: (vaultPath: string, relativePath: string) => string
}

export interface PrepareInput {
  orgId: string
  destVaultId: string
  destVaultPath: string
  selection: readonly LocalFile[]
  vaultFiles: readonly LocalFile[]
  options: VaultTransferOptions
  /** An index fetched earlier for this destination, to avoid fetching it again for every option change. */
  serverPaths?: ReadonlySet<string>
}

export async function prepareVaultTransfer(
  input: PrepareInput,
  deps: PrepareDeps,
): Promise<PrepareResult> {
  const destFolder = normalizeDestFolder(input.options.destFolder)
  if (destFolder === null) return { ok: false, failure: 'invalid-folder' }
  const options = { ...input.options, destFolder }

  if (!(await deps.fileExists(input.destVaultPath))) {
    return { ok: false, failure: 'destination-missing' }
  }

  let serverPaths = input.serverPaths
  if (!serverPaths) {
    const index = await deps.loadIndex(input.orgId, input.destVaultId)
    if (!index.ok) return { ok: false, failure: 'destination-unreadable', message: index.error }
    serverPaths = index.serverPaths
  }

  const candidates = candidateDestinationPaths(input.selection, input.vaultFiles, options)
  const diskPaths = new Set<string>()
  await processWithConcurrency(candidates, CONCURRENT_OPERATIONS, async (candidate) => {
    if (await deps.fileExists(deps.joinPath(input.destVaultPath, candidate))) {
      diskPaths.add(candidate.toLowerCase())
    }
  })

  const plan = planVaultTransfer({
    selection: input.selection,
    vaultFiles: input.vaultFiles,
    options,
    target: { serverPaths, diskPaths, vaultPath: input.destVaultPath },
  })

  return { ok: true, plan, serverPaths }
}
