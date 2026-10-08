import { describe, expect, it } from 'vitest'

import { getTranslation } from '@/lib/i18n'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import { buildFindingRows, type FindingRowContext } from './vaultAuditRows'
import {
  hiddenSelectedRows,
  selectionChangeFor,
  summarizeSelection,
} from './vaultAuditSelection'
import { DEFAULT_FINDING_SORT, sortFindings } from './vaultAuditSort'

const FINDING_COUNT = 5_000
const FILE_COUNT = 1_000
/** Generous: the build is a few milliseconds, this only catches an accidental quadratic. */
const BUILD_BUDGET_MS = 1_500

function findingAt(index: number, overrides: Partial<VaultAuditFinding> = {}): VaultAuditFinding {
  const fileIndex = index % FILE_COUNT
  return {
    id: `file-${fileIndex}:configuration:config_tab:Config${index}`,
    kind: 'absent-from-file',
    resolution: 'push-vault-value',
    fileId: `file-${fileIndex}`,
    relativePath: `Folder ${fileIndex % 20}\\Part ${fileIndex}.SLDPRT`,
    fileName: `Part ${fileIndex}.SLDPRT`,
    fileType: 'part',
    field: 'config_tab',
    scope: 'configuration',
    configuration: `Config${index}`,
    databaseValue: `-${index}`,
    fileValue: null,
    repairValue: null,
    unattributedReason: null,
    ...overrides,
  }
}

function contextOf(overrides: Partial<FindingRowContext> = {}): FindingRowContext {
  const none = new Set<string>()
  return {
    repairable: none,
    heldByOthers: none,
    unsavedEdits: none,
    repairSelected: none,
    repairSettled: none,
    pushSelected: none,
    pushWritten: none,
    fillSelected: none,
    fillSettled: none,
    conflictSelected: none,
    conflictSettled: none,
    availability: new Map(),
    canAdoptFileValue: () => false,
    blockedReasonFor: () => null,
    ...overrides,
  }
}

const findings = Array.from({ length: FINDING_COUNT }, (_, index) => findingAt(index))

describe('a category far larger than the old two hundred row cap', () => {
  it('builds a row for every finding and drops none', () => {
    const started = performance.now()
    const rows = buildFindingRows(findings, contextOf())
    const elapsed = performance.now() - started

    expect(rows).toHaveLength(FINDING_COUNT)
    expect(new Set(rows.map((row) => row.id)).size).toBe(FINDING_COUNT)
    expect(elapsed).toBeLessThan(BUILD_BUDGET_MS)
  })

  it('counts a document write in files, not rows, when everything is selected', () => {
    const rows = buildFindingRows(findings, contextOf())
    const summary = summarizeSelection(rows, rows)

    expect(summary.selectableUnits).toBe(FILE_COUNT)
  })

  it('select all reaches the last row, and what it ticks matches the summary', () => {
    const rows = buildFindingRows(findings, contextOf())
    const { select } = selectionChangeFor(rows, 'select-all')

    expect(select).toHaveLength(FINDING_COUNT)
    expect(select.at(-1)?.id).toBe(findings.at(-1)?.id)

    const pushSelected = new Set(select.map((row) => row.selectionId))
    const after = buildFindingRows(findings, contextOf({ pushSelected }))
    const summary = summarizeSelection(after, after)

    expect(summary.allSelected).toBe(true)
    expect(summary.selectedUnits).toBe(FILE_COUNT)
  })

  it('does not offer settled files again', () => {
    const pushWritten = new Set(['file-0', 'file-1'])
    const rows = buildFindingRows(findings, contextOf({ pushWritten }))

    expect(rows.filter((row) => row.settled).every((row) => !row.selectable)).toBe(true)
    expect(summarizeSelection(rows, rows).selectableUnits).toBe(FILE_COUNT - 2)
  })

  it('never makes a conflict selectable by its checkbox', () => {
    const conflicts = findings
      .slice(0, 10)
      .map((finding) => ({ ...finding, resolution: 'choose-a-side' as const, fileValue: 'x' }))
    const rows = buildFindingRows(conflicts, contextOf())

    expect(rows.every((row) => !row.selectable)).toBe(true)
    expect(rows.every((row) => row.conflict !== null)).toBe(true)
  })

  it('reports ticked files the filter hides, by file', () => {
    const pushSelected = new Set(['file-0', 'file-1', 'file-2'])
    const rows = buildFindingRows(findings, contextOf({ pushSelected }))
    const visible = rows.filter((row) => row.finding.fileId === 'file-2')

    expect(summarizeSelection(rows, visible).hiddenSelectedUnits).toBe(2)
    expect(new Set(hiddenSelectedRows(rows, visible).map((row) => row.selectionId))).toEqual(
      new Set(['file-0', 'file-1']),
    )
  })

  it('sorts thousands of findings without losing or duplicating any', () => {
    const sorted = sortFindings(findings, DEFAULT_FINDING_SORT)
    expect(sorted).toHaveLength(FINDING_COUNT)
    expect(new Set(sorted.map((finding) => finding.id)).size).toBe(FINDING_COUNT)
  })
})

describe('the keys the selection controls and notes use', () => {
  const KEYS = [
    'vaultAudit.tabLabel',
    'vaultAudit.findings.total',
    'vaultAudit.findings.selectAllRows',
    'vaultAudit.findings.clearSelection',
    'vaultAudit.findings.invert',
    'vaultAudit.findings.selectedOf',
    'vaultAudit.findings.hiddenSelected',
    'vaultAudit.findings.clearHidden',
    'vaultAudit.findings.actionableOnly',
    'vaultAudit.findings.actionableOnlyHint',
    'vaultAudit.findings.clearFilter',
    'vaultAudit.findings.sortBy',
    'vaultAudit.actions.showDetails',
    'vaultAudit.actions.hideDetails',
    'vaultAudit.actions.guaranteeLabel',
    'vaultAudit.actions.fileWriteLabel',
    'vaultAudit.actions.conflictLabel',
  ] as const

  it.each(KEYS)('%s resolves to text rather than to itself', (key) => {
    expect(getTranslation('en', key)).not.toBe(key)
  })

  it('fills the counts into the sentences that carry them', () => {
    expect(getTranslation('en', 'vaultAudit.findings.selectedOf', { selected: 3, total: 1200 })).toBe(
      '3 of 1200 selected',
    )
    expect(getTranslation('en', 'vaultAudit.findings.hiddenSelected', { count: 7 })).toContain('7')
    expect(getTranslation('en', 'vaultAudit.findings.total', { count: 1200 })).toBe('1200 values')
  })
})
