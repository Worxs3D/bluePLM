/**
 * Saying which field a Sync Metadata write missed, and why.
 *
 * The push already records a verdict per address, and the datacard marks them, but the log only
 * counted them and the toast only said "N failed". A report of "it does nothing" then has nothing
 * to go on: no field, no reason, and no way to tell a refused write from a service that was never
 * reachable. These helpers turn the verdicts into one log line each and one sentence for the toast.
 */

import { t } from '@/lib/i18n'
import type { VerifiedAddress } from '@/lib/metadata/verifyWrite'
import type { MetadataWriteAddress } from '@/lib/metadata/writeState'

import { logSync } from './syncMetadataCommon'

/** A write that was sent and not confirmed, or never sent. `pending` and `verified` need no report. */
const UNSETTLED_STATES: ReadonlySet<VerifiedAddress['state']> = new Set([
  'failed',
  'unverified',
  'unattempted',
])

/** The service saying SolidWorks is running but cannot be driven over COM. */
const COM_UNREACHABLE_PATTERN = /MK_E_UNAVAILABLE|SOLIDWORKS_COM_INACCESSIBLE|COM (is )?(not accessible|unavailable|unreachable)/i

/** `part_number`, or `config_tab in "0375"` for a configuration. */
export function describeAddress(address: MetadataWriteAddress): string {
  if (address.scope === 'file') return address.field
  return t('metadataWrite.addressInConfiguration', {
    field: address.field,
    configuration: address.configuration,
  })
}

/** Whether a reason says the service could not reach SolidWorks over COM. */
export function isComUnreachableReason(reason: string | undefined): boolean {
  return !!reason && COM_UNREACHABLE_PATTERN.test(reason)
}

/** Every address that did not end up `verified` or `pending`, in the order they were written. */
export function unsettledAddresses(addresses: readonly VerifiedAddress[]): VerifiedAddress[] {
  return addresses.filter((entry) => UNSETTLED_STATES.has(entry.state))
}

/** Logs one warning per unsettled address, with the reason the verdict was reached on. */
export function logUnsettledAddresses(
  fullPath: string,
  addresses: readonly VerifiedAddress[],
): void {
  for (const entry of unsettledAddresses(addresses)) {
    logSync('warn', 'Metadata write not confirmed for a field', {
      fullPath,
      address: describeAddress(entry.address),
      state: entry.state,
      reason: entry.reason,
    })
  }
}

/**
 * One sentence naming the first field that did not land and the reason it gave, or null when every
 * address settled. A failed write outranks an unverified one, which outranks one never sent, because
 * the first is the only one the document is known to disagree about.
 */
export function describeFirstShortfall(addresses: readonly VerifiedAddress[]): string | null {
  const unsettled = unsettledAddresses(addresses)
  const first =
    unsettled.find((entry) => entry.state === 'failed') ??
    unsettled.find((entry) => entry.state === 'unverified') ??
    unsettled[0]
  if (!first) return null

  if (isComUnreachableReason(first.reason)) return t('metadataWrite.solidworksUnreachable')

  return first.reason
    ? t('metadataWrite.firstFieldFailed', {
        field: describeAddress(first.address),
        reason: first.reason,
      })
    : t('metadataWrite.firstFieldFailedNoReason', { field: describeAddress(first.address) })
}
