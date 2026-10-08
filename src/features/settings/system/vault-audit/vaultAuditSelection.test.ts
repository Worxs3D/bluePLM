import { describe, expect, it } from 'vitest'

import type { VaultAuditFinding } from '@/types/vaultAudit'

import { rangeBetween } from './repairSelection'
import {
  hiddenSelectedRows,
  selectionChangeFor,
  summarizeSelection,
  type SelectionRowState,
} from './vaultAuditSelection'
import { DEFAULT_FINDING_SORT, nextSort, sortFindings } from './vaultAuditSort'

interface TestRow extends SelectionRowState {
  id: string
}

function rowOf(id: string, overrides: Partial<TestRow> = {}): TestRow {
  return { id, selectionId: id, selectable: true, selected: false, ...overrides }
}

function manyRows(count: number, overrides: Partial<TestRow> = {}): TestRow[] {
  return Array.from({ length: count }, (_, index) => rowOf(`row-${index}`, overrides))
}

describe('select all', () => {
  it('covers every visible row, not only the first two hundred', () => {
    const rows = manyRows(1_200)
    const change = selectionChangeFor(rows, 'select-all')

    expect(change.select).toHaveLength(1_200)
    expect(change.deselect).toHaveLength(0)
  })

  it('leaves out rows with no checkbox', () => {
    const rows = [rowOf('a'), rowOf('b', { selectable: false }), rowOf('c')]
    expect(selectionChangeFor(rows, 'select-all').select.map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('clears every selectable row', () => {
    const rows = manyRows(5, { selected: true })
    const change = selectionChangeFor(rows, 'clear')
    expect(change.deselect).toHaveLength(5)
    expect(change.select).toHaveLength(0)
  })
})

describe('invert', () => {
  it('flips every unit', () => {
    const rows = [rowOf('a', { selected: true }), rowOf('b'), rowOf('c', { selected: true })]
    const change = selectionChangeFor(rows, 'invert')
    expect(change.select.map((row) => row.id)).toEqual(['b'])
    expect(change.deselect.map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('flips a file as one unit however many of its rows are on screen', () => {
    const rows = [
      rowOf('r1', { selectionId: 'file-1', selected: true }),
      rowOf('r2', { selectionId: 'file-1', selected: true }),
      rowOf('r3', { selectionId: 'file-2' }),
    ]
    const change = selectionChangeFor(rows, 'invert')
    expect(change.deselect.map((row) => row.selectionId)).toEqual(['file-1', 'file-1'])
    expect(change.select.map((row) => row.selectionId)).toEqual(['file-2'])
  })
})

describe('summarizeSelection', () => {
  it('counts files rather than rows when a file has several rows', () => {
    const rows = [
      rowOf('r1', { selectionId: 'file-1' }),
      rowOf('r2', { selectionId: 'file-1' }),
      rowOf('r3', { selectionId: 'file-2' }),
    ]
    expect(summarizeSelection(rows, rows).selectableUnits).toBe(2)
  })

  it('reports none, some and all', () => {
    const none = manyRows(3)
    const some = [rowOf('a', { selected: true }), rowOf('b')]
    const all = manyRows(3, { selected: true })

    expect(summarizeSelection(none, none)).toMatchObject({
      allSelected: false,
      someSelected: false,
    })
    expect(summarizeSelection(some, some)).toMatchObject({
      allSelected: false,
      someSelected: true,
      selectedUnits: 1,
    })
    expect(summarizeSelection(all, all)).toMatchObject({ allSelected: true, someSelected: false })
  })

  it('is not all-selected when nothing can be selected', () => {
    const rows = manyRows(2, { selectable: false })
    expect(summarizeSelection(rows, rows)).toMatchObject({
      selectableUnits: 0,
      allSelected: false,
    })
  })

  it('counts selected units the filter is hiding', () => {
    const all = [
      rowOf('a', { selected: true }),
      rowOf('b', { selected: true }),
      rowOf('c'),
    ]
    const visible = [all[2]]

    expect(summarizeSelection(all, visible).hiddenSelectedUnits).toBe(2)
    expect(hiddenSelectedRows(all, visible).map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('does not call a file hidden while one of its rows is visible', () => {
    const all = [
      rowOf('r1', { selectionId: 'file-1', selected: true }),
      rowOf('r2', { selectionId: 'file-1', selected: true }),
    ]
    expect(summarizeSelection(all, [all[0]]).hiddenSelectedUnits).toBe(0)
  })
})

describe('shift-click range', () => {
  it('spans rows beyond the two hundredth', () => {
    const ids = manyRows(1_200).map((row) => row.id)
    const span = rangeBetween(ids, 'row-10', 'row-900')
    expect(span).toHaveLength(891)
    expect(span?.[0]).toBe('row-10')
    expect(span?.at(-1)).toBe('row-900')
  })
})

function findingOf(overrides: Partial<VaultAuditFinding>): VaultAuditFinding {
  return {
    id: 'x',
    kind: 'recoverable',
    resolution: 'adopt-file-value',
    fileId: 'f',
    relativePath: 'A\\part.SLDPRT',
    fileName: 'part.SLDPRT',
    fileType: 'part',
    field: 'config_tab',
    scope: 'configuration',
    configuration: 'Default',
    databaseValue: null,
    fileValue: '-1',
    repairValue: '-1',
    unattributedReason: null,
    ...overrides,
  }
}

describe('sortFindings', () => {
  const findings = [
    findingOf({ id: '3', relativePath: 'B\\p10.SLDPRT' }),
    findingOf({ id: '1', relativePath: 'B\\p2.SLDPRT' }),
    findingOf({ id: '2', relativePath: 'A\\z.SLDPRT' }),
  ]

  it('orders paths naturally, so p2 comes before p10', () => {
    expect(sortFindings(findings, DEFAULT_FINDING_SORT).map((finding) => finding.id)).toEqual([
      '2',
      '1',
      '3',
    ])
  })

  it('reverses on descending without mutating the input', () => {
    const before = findings.map((finding) => finding.id)
    const sorted = sortFindings(findings, { key: 'file', direction: 'desc' })
    expect(sorted.map((finding) => finding.id)).toEqual(['3', '1', '2'])
    expect(findings.map((finding) => finding.id)).toEqual(before)
  })

  it('breaks ties by path then configuration', () => {
    const tied = [
      findingOf({ id: 'b', relativePath: 'A\\x', configuration: 'Beta' }),
      findingOf({ id: 'a', relativePath: 'A\\x', configuration: 'Alpha' }),
    ]
    expect(
      sortFindings(tied, { key: 'field', direction: 'asc' }).map((finding) => finding.id),
    ).toEqual(['a', 'b'])
  })

  it('flips the active column and restarts ascending on another', () => {
    expect(nextSort({ key: 'file', direction: 'asc' }, 'file')).toEqual({
      key: 'file',
      direction: 'desc',
    })
    expect(nextSort({ key: 'file', direction: 'desc' }, 'field')).toEqual({
      key: 'field',
      direction: 'asc',
    })
  })
})
