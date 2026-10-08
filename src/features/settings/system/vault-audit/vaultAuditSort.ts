/**
 * Column ordering for the findings list.
 *
 * Pure so the order a shift-click range follows can be pinned in a test: the range is taken over
 * the rows in the order they are displayed, which is whatever this produces.
 */

import type { VaultAuditFinding } from '@/types/vaultAudit'

import { fieldLabel, resolutionLabel } from './vaultAuditLabels'

export type FindingSortKey = 'file' | 'configuration' | 'field' | 'resolution'
export type SortDirection = 'asc' | 'desc'

export interface FindingSort {
  key: FindingSortKey
  direction: SortDirection
}

export const DEFAULT_FINDING_SORT: FindingSort = { key: 'file', direction: 'asc' }

// One collator for the whole list. `localeCompare` builds one per call, which on a few thousand
// rows and an n log n sort is the difference between instant and a visible pause.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function primaryOf(finding: VaultAuditFinding, key: FindingSortKey): string {
  switch (key) {
    case 'file':
      return finding.relativePath
    case 'configuration':
      return finding.configuration ?? ''
    case 'field':
      return fieldLabel(finding.field)
    case 'resolution':
      return resolutionLabel(finding.resolution)
  }
}

/**
 * The findings in column order, ties broken by path, configuration, field and finally id.
 *
 * Never mutates the input: the findings list belongs to the report and other sections read it in
 * report order.
 */
export function sortFindings(
  findings: readonly VaultAuditFinding[],
  sort: FindingSort,
): VaultAuditFinding[] {
  const sign = sort.direction === 'asc' ? 1 : -1

  // Labels are translated once per finding rather than once per comparison.
  const keyed = findings.map((finding) => ({
    finding,
    primary: primaryOf(finding, sort.key),
  }))

  keyed.sort((a, b) => {
    const primary = collator.compare(a.primary, b.primary)
    if (primary !== 0) return primary * sign

    return (
      collator.compare(a.finding.relativePath, b.finding.relativePath) ||
      collator.compare(a.finding.configuration ?? '', b.finding.configuration ?? '') ||
      collator.compare(a.finding.field, b.finding.field) ||
      collator.compare(a.finding.id, b.finding.id)
    )
  })

  return keyed.map((entry) => entry.finding)
}

/** Clicking the active column flips it; clicking another starts it ascending. */
export function nextSort(current: FindingSort, key: FindingSortKey): FindingSort {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: 'asc' }
}
