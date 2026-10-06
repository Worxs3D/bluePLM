/**
 * What a finished transfer tells the user.
 *
 * Structured rather than worded: the command turns it into a toast and a result, and the wording
 * lives with the translations. The one judgement made here is severity, because "it mostly worked"
 * must not read as success. Anything not done, whatever the reason, keeps the run from being green.
 */

import type { TransferItemResult, TransferFailure, TransferRunResult } from './execute'
import type { RemoveSourcesOutcome, KeptSource } from './removeSources'
import type { SkippedTransferFile, VaultTransferPlan } from './types'

export type TransferSeverity = 'success' | 'warning' | 'error'

export interface TransferFailureEntry {
  relativePath: string
  failure: TransferFailure
  message?: string
}

export interface LocalCopyProblem {
  relativePath: string
  outcome: 'failed' | 'diverged'
}

export interface TransferReport {
  /** Files that now exist in the destination vault. */
  transferred: number
  /** Of those, how many were also placed on the destination's disk. */
  placedOnDisk: number
  failures: TransferFailureEntry[]
  cancelled: number
  skipped: SkippedTransferFile[]
  localCopyProblems: LocalCopyProblem[]
  /** Move only: files that arrived but could not be taken out of the source. */
  keptInSource: KeptSource[]
  /** Move only: files taken out of the source. */
  removed: number
  foldersRemoved: number
  folderFailures: string[]
  referencesCopied: number
  referenceError?: string
  severity: TransferSeverity
}

function isTransferred(result: TransferItemResult): boolean {
  return result.status === 'transferred'
}

export function buildTransferReport(
  plan: VaultTransferPlan,
  run: TransferRunResult,
  removal: RemoveSourcesOutcome | null,
): TransferReport {
  const transferred = run.results.filter(isTransferred)
  const failedResults = run.results.filter((result) => !isTransferred(result))

  const failures = failedResults
    .filter((result) => result.failure !== 'cancelled')
    .map((result) => ({
      relativePath: result.planned.sourceRelativePath,
      failure: result.failure ?? 'server-error',
      message: result.message,
    }))

  const localCopyProblems = transferred.flatMap((result) =>
    result.localCopy === 'failed' || result.localCopy === 'diverged'
      ? [{ relativePath: result.planned.sourceRelativePath, outcome: result.localCopy }]
      : [],
  )

  const keptInSource = removal?.kept ?? []
  const cancelled = failedResults.length - failures.length

  const clean =
    failures.length === 0 &&
    cancelled === 0 &&
    plan.skipped.length === 0 &&
    localCopyProblems.length === 0 &&
    keptInSource.length === 0 &&
    run.folderFailures.length === 0 &&
    run.referenceError === undefined

  let severity: TransferSeverity = 'warning'
  if (clean) severity = 'success'
  else if (transferred.length === 0 && plan.files.length > 0) severity = 'error'

  return {
    transferred: transferred.length,
    placedOnDisk: transferred.filter((result) => result.localCopy === 'copied').length,
    failures,
    cancelled,
    skipped: plan.skipped,
    localCopyProblems,
    keptInSource,
    removed: removal?.removed.length ?? 0,
    foldersRemoved: removal?.foldersRemoved.length ?? 0,
    folderFailures: run.folderFailures,
    referencesCopied: run.referencesCopied,
    referenceError: run.referenceError,
    severity,
  }
}
