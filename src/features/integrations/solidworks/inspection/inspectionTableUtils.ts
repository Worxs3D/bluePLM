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

// Metadata fields we can write back to the SOLIDWORKS Bill of Characteristics. Geometry-derived
// values (nominal, tolerances, limits) are never pushed. Order matters for the serialized baseline.
export const PUSHABLE_FIELDS: (keyof InspectionRowValues)[] = [
  'classification',
  'inspection_method',
  'operation',
  'aql',
  'comments',
]

/** Serialize a row's pushable metadata for baseline/dirty comparison. */
export function serializePushable(row: InspectionRowInput): string {
  return JSON.stringify(PUSHABLE_FIELDS.map((key) => row[key] ?? null))
}

/** Build a baseline map (row id -> serialized pushable fields) for unpushed-change tracking. */
export function buildPushBaseline(rows: InspectionRowInput[]): Record<string, string> {
  const baseline: Record<string, string> = {}
  for (const row of rows) baseline[row.id] = serializePushable(row)
  return baseline
}
