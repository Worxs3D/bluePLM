import { describe, expect, it } from 'vitest'

import { emptyRowValues } from '@/lib/supabase/files/inspectionRows'
import type { InspectionRowInput } from '@/lib/supabase/files/inspection'
import { GEOMETRY_FIELDS } from '@/lib/inspection/characteristicMerge'

import { BULK_EDIT_FIELDS, COLUMNS, isDrawingOwnedCell, resolveColumns } from './inspectionColumns'
import { applyBulkEdit, toggleRowSelection } from './inspectionTableUtils'

function row(id: string, over: Partial<InspectionRowInput> = {}): InspectionRowInput {
  return { ...emptyRowValues(0), id, ...over }
}

const keys = (cols: { key: string }[]) => cols.map((c) => c.key)

describe('resolveColumns', () => {
  it('is the default layout without preferences', () => {
    const { ordered, visible } = resolveColumns(null)
    expect(ordered).toBe(COLUMNS)
    expect(visible).toBe(COLUMNS)
  })

  it('follows the saved order and hides the hidden columns, but never Balloon', () => {
    const order = ['comments', 'balloon_number', ...keys(COLUMNS).filter((k) => k !== 'comments' && k !== 'balloon_number')]
    const { ordered, visible } = resolveColumns({ order, hidden: ['zone', 'balloon_number'] })
    expect(keys(ordered).slice(0, 2)).toEqual(['comments', 'balloon_number'])
    expect(keys(visible)).not.toContain('zone')
    expect(keys(visible)).toContain('balloon_number')
    expect(ordered).toHaveLength(COLUMNS.length)
  })

  it('ignores unknown keys and places columns added later after their default predecessor', () => {
    const withoutSource = keys(COLUMNS).filter((k) => k !== 'tolerance_source')
    const { ordered } = resolveColumns({ order: ['not_a_column', ...withoutSource], hidden: [] })
    expect(keys(ordered)).toEqual(keys(COLUMNS))
  })
})

describe('isDrawingOwnedCell', () => {
  it('locks every geometry column of an extracted row, and nothing of a manual row', () => {
    const extracted = row('a', { source_key: 'k1' })
    const manual = row('b')
    for (const key of GEOMETRY_FIELDS) {
      expect(isDrawingOwnedCell(extracted, key), key).toBe(true)
      expect(isDrawingOwnedCell(manual, key), key).toBe(false)
    }
    for (const key of BULK_EDIT_FIELDS) expect(isDrawingOwnedCell(extracted, key), key).toBe(false)
  })
})

describe('applyBulkEdit', () => {
  const rows = [row('a', { source_key: 'k1', nominal_value: '10' }), row('b'), row('c')]

  it('sets a user-owned column on the selected rows only', () => {
    const next = applyBulkEdit(rows, new Set(['a', 'b']), 'inspection_method', 'CMM', BULK_EDIT_FIELDS)
    expect(next.map((r) => r.inspection_method)).toEqual(['CMM', 'CMM', null])
  })

  it('never writes a geometry column, whatever is asked', () => {
    const next = applyBulkEdit(rows, new Set(['a']), 'nominal_value', '99', BULK_EDIT_FIELDS)
    expect(next).toBe(rows)
    expect(BULK_EDIT_FIELDS.some((f) => (GEOMETRY_FIELDS as readonly string[]).includes(f))).toBe(false)
  })
})

describe('toggleRowSelection', () => {
  const shown = ['a', 'b', 'c', 'd']

  it('toggles one row on a plain click', () => {
    expect([...toggleRowSelection(new Set(), shown, 'b', null, false)]).toEqual(['b'])
    expect([...toggleRowSelection(new Set(['b']), shown, 'b', 'b', false)]).toEqual([])
  })

  it('selects the range from the anchor on a shift-click, in either direction', () => {
    expect([...toggleRowSelection(new Set(['d']), shown, 'b', 'd', true)].sort()).toEqual(['b', 'c', 'd'])
    expect([...toggleRowSelection(new Set(), shown, 'c', 'a', true)].sort()).toEqual(['a', 'b', 'c'])
  })
})
