/**
 * The words for a transfer: reasons, counts and the summary the command reports.
 *
 * Every string is a translation key under `contextMenu.vaultTransfer`, built from the same enum
 * values the engine uses, so a new reason cannot be added without `labels.test.ts` failing until
 * it has a sentence.
 */

import { t } from '@/lib/i18n'

import type { LocalCopyOutcome, TransferFailure } from './execute'
import type { PrepareFailure } from './prepare'
import type { KeptSourceReason } from './removeSources'
import type { TransferReport } from './report'
import type { TransferSkipReason, VaultTransferMode } from './types'

const NAMESPACE = 'contextMenu.vaultTransfer'

/** Individual files named in a result before the list is cut off. */
export const MAX_REPORTED_FILES = 50

export const SKIP_REASONS: readonly TransferSkipReason[] = [
  'outdated',
  'ignored',
  'deleted-on-server',
  'no-content',
  'exists-in-destination',
  'exists-on-disk',
  'duplicate-in-selection',
  'path-too-long',
  'modified',
  'checked-out',
  'pending-move',
]

export const FAILURES: readonly TransferFailure[] = [
  'source-locked',
  'source-unreadable',
  'exists-on-disk',
  'exists-in-destination',
  'server-error',
  'cancelled',
]

export const KEPT_REASONS: readonly KeptSourceReason[] = [
  'not-verified',
  'source-changed',
  'source-unverified',
  'local-delete-failed',
  'server-delete-failed',
]

export const LOCAL_COPY_PROBLEMS: readonly Exclude<LocalCopyOutcome, 'copied' | 'not-needed'>[] = [
  'failed',
  'diverged',
]

export function vaultTransferKey(name: string): string {
  return `${NAMESPACE}.${name}`
}

/** `exists-in-destination` becomes `ExistsInDestination`, the tail of its translation key. */
export function pascal(value: string): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

export function fileCountLabel(count: number): string {
  return t(vaultTransferKey(count === 1 ? 'fileCountOne' : 'fileCountOther'), { count })
}

export function itemCountLabel(count: number): string {
  return t(vaultTransferKey(count === 1 ? 'itemCountOne' : 'itemCountOther'), { count })
}

export function skipReasonLabel(reason: TransferSkipReason): string {
  return t(vaultTransferKey(`skip${pascal(reason)}`))
}

export function failureLabel(failure: TransferFailure): string {
  return t(vaultTransferKey(`failure${pascal(failure)}`))
}

export function keptReasonLabel(reason: KeptSourceReason): string {
  return t(vaultTransferKey(`kept${pascal(reason)}`))
}

export function localCopyProblemLabel(outcome: 'failed' | 'diverged'): string {
  return t(vaultTransferKey(`localCopy${pascal(outcome)}`))
}

/** The sentence for a destination that could not be planned against. */
export function prepareFailureLabel(failure: PrepareFailure, detail?: string): string {
  switch (failure) {
    case 'invalid-folder':
      return t(vaultTransferKey('validationInvalidFolder'))
    case 'destination-missing':
      return t(vaultTransferKey('prepareDestinationMissing'))
    case 'destination-unreadable':
      return t(vaultTransferKey('prepareDestinationUnreadable'), { error: detail ?? '' })
  }
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export interface DescribedReport {
  message: string
  details: string[]
}

/** One sentence for the toast, and a line per file that needs the user's attention. */
export function describeReport(
  report: TransferReport,
  mode: VaultTransferMode,
  vaultName: string,
): DescribedReport {
  const headline =
    report.transferred > 0
      ? t(vaultTransferKey(mode === 'copy' ? 'resultCopied' : 'resultMoved'), {
          files: fileCountLabel(report.transferred),
          vault: vaultName,
        })
      : t(vaultTransferKey(mode === 'copy' ? 'resultNothingCopied' : 'resultNothingMoved'), {
          vault: vaultName,
        })

  const leftovers: string[] = []
  if (report.skipped.length > 0) {
    leftovers.push(t(vaultTransferKey('resultSkipped'), { count: report.skipped.length }))
  }
  if (report.failures.length > 0) {
    leftovers.push(t(vaultTransferKey('resultFailed'), { count: report.failures.length }))
  }
  if (report.cancelled > 0) {
    leftovers.push(t(vaultTransferKey('resultCancelled'), { count: report.cancelled }))
  }
  if (report.localCopyProblems.length > 0) {
    leftovers.push(t(vaultTransferKey('resultNoLocalCopy'), { count: report.localCopyProblems.length }))
  }
  if (report.keptInSource.length > 0) {
    leftovers.push(t(vaultTransferKey('resultKeptInSource'), { count: report.keptInSource.length }))
  }
  if (report.folderFailures.length > 0) {
    leftovers.push(t(vaultTransferKey('resultFoldersFailed'), { count: report.folderFailures.length }))
  }
  if (report.referenceError !== undefined) {
    leftovers.push(t(vaultTransferKey('resultReferencesFailed')))
  }

  const message = leftovers.length > 0 ? `${headline} (${leftovers.join(', ')})` : headline

  const lines: string[] = [
    ...report.skipped.map((entry) => `${entry.relativePath}: ${skipReasonLabel(entry.reason)}`),
    ...report.failures.map((entry) => {
      const reason = failureLabel(entry.failure)
      return `${entry.relativePath}: ${entry.message ? `${reason} (${entry.message})` : reason}`
    }),
    ...report.localCopyProblems.map(
      (entry) => `${entry.relativePath}: ${localCopyProblemLabel(entry.outcome)}`,
    ),
    ...report.keptInSource.map((entry) => {
      const reason = keptReasonLabel(entry.reason)
      return `${entry.planned.sourceRelativePath}: ${entry.message ? `${reason} (${entry.message})` : reason}`
    }),
    ...report.folderFailures.map((folder) => `${folder}: ${t(vaultTransferKey('resultFolderFailed'))}`),
  ]

  const details = lines.slice(0, MAX_REPORTED_FILES)
  if (lines.length > MAX_REPORTED_FILES) {
    details.push(t(vaultTransferKey('resultAndMore'), { count: lines.length - MAX_REPORTED_FILES }))
  }

  return { message, details }
}
