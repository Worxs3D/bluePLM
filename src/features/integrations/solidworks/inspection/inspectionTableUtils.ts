import type { InspectionRowInput, InspectionRowValues } from '@/lib/supabase'

import type { ColumnType } from './inspectionColumns'

export type SortDir = 'asc' | 'desc'

/** Base row order used for persistence: balloon ascending (natural), empty balloons last. */
export function sortByBalloonAsc(rows: InspectionRowInput[]): InspectionRowInput[] {
  return [...rows].sort((a, b) => {
    const av = a.balloon_number ?? ''
    const bv = b.balloon_number ?? ''
    if (av === '' && bv === '') return 0
    if (av === '') return 1
    if (bv === '') return -1
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/** Generic column comparison. Empty values always sort to the bottom regardless of direction. */
export function compareRows(
  a: InspectionRowInput,
  b: InspectionRowInput,
  key: keyof InspectionRowValues,
  dir: SortDir,
  type: ColumnType,
): number {
  const av = a[key]
  const bv = b[key]
  const aEmpty = av === null || av === undefined || av === ''
  const bEmpty = bv === null || bv === undefined || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  let cmp: number
  if (type === 'number') {
    cmp = Number(av) - Number(bv)
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
  }
  return dir === 'asc' ? cmp : -cmp
}

/** Per-column filter match. Select uses exact match, text/number use case-insensitive contains. */
export function matchesFilter(
  row: InspectionRowInput,
  key: keyof InspectionRowValues,
  filterValue: string,
  type: ColumnType,
): boolean {
  if (!filterValue) return true
  const value = row[key]
  if (type === 'select') return String(value ?? '') === filterValue
  const text = value === null || value === undefined ? '' : String(value)
  return text.toLowerCase().includes(filterValue.toLowerCase())
}

/**
 * Set one user-owned column on the selected rows. A field outside `bulkFields` (geometry, balloon,
 * drawing link) changes nothing, so the drawing's values cannot be overwritten in bulk.
 */
export function applyBulkEdit(
  rows: InspectionRowInput[],
  selectedIds: ReadonlySet<string>,
  field: keyof InspectionRowValues,
  value: string | number | null,
  bulkFields: readonly (keyof InspectionRowValues)[],
): InspectionRowInput[] {
  if (!bulkFields.includes(field) || selectedIds.size === 0) return rows
  return rows.map((r) => (selectedIds.has(r.id) ? { ...r, [field]: value } : r))
}

/**
 * Selection after clicking row `id` in the shown order: a plain click toggles that row, a
 * shift-click selects the range from the last clicked row (`anchor`).
 */
export function toggleRowSelection(
  selected: ReadonlySet<string>,
  shownIds: readonly string[],
  id: string,
  anchor: string | null,
  range: boolean,
): Set<string> {
  const next = new Set(selected)
  const from = anchor ? shownIds.indexOf(anchor) : -1
  const to = shownIds.indexOf(id)
  if (range && from >= 0 && to >= 0) {
    const [a, b] = from < to ? [from, to] : [to, from]
    for (let i = a; i <= b; i++) next.add(shownIds[i])
    return next
  }
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
