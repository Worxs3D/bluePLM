import { t } from '@/lib/i18n'
import type { InspectionRowValues } from '@/lib/supabase'
import { GEOMETRY_FIELDS } from '@/lib/inspection/characteristicMerge'

export type ColumnType = 'text' | 'number' | 'select'

export interface ColumnDef {
  key: keyof InspectionRowValues
  label: string
  type: ColumnType
  options?: string[]
  width: string
  /** Set by extraction only; never editable in the table. */
  readOnly?: boolean
  /** i18n key of the header, used instead of `label` when set. */
  labelKey?: string
}

/** Header text of a column. */
export function columnLabel(col: ColumnDef): string {
  return col.labelKey ? t(col.labelKey) : col.label
}

export const CHAR_TYPES = ['Dimension', 'GTOL', 'Note', 'Datum']

// Built-in inspection methods offered in the Method dropdown. Orgs can add more, which
// are stored in the inspection_methods table and merged with these at runtime.
export const DEFAULT_INSPECTION_METHODS = [
  'Visual',
  'Scale/Ruler',
  'Tape Measure',
  'Calipers',
  'Micrometer (OD)',
  'Micrometer (ID)',
  'Depth Micrometer',
  'Height Gauge',
  'Bore Gauge',
  'Pin Gauge',
  'Plug Gauge',
  'Ring Gauge',
  'Thread Gauge',
  'Go/No-Go Gauge',
  'Radius Gauge',
  'Feeler Gauge',
  'Dial Indicator',
  'Protractor',
  'Optical Comparator',
  'CMM',
  'Vision System',
  'Laser Scanner',
  'Surface Roughness Tester',
  'Hardness Tester',
  'Torque Wrench',
]

// Sentinel option value used to trigger the "add a new method" flow from the dropdown.
export const ADD_METHOD_OPTION = '__add_method__'

export const CLASSIFICATIONS = ['Critical', 'Major', 'Minor', 'Incidental']

export const COLUMNS: ColumnDef[] = [
  { key: 'balloon_number', label: 'Balloon', type: 'text', width: 'w-20' },
  { key: 'zone', label: 'Zone', type: 'text', width: 'w-16' },
  { key: 'source_sheet', label: 'Sheet', type: 'text', width: 'w-20', readOnly: true },
  { key: 'char_type', label: 'Type', type: 'select', options: CHAR_TYPES, width: 'w-28' },
  { key: 'sub_type', label: 'Sub-Type', type: 'text', width: 'w-28' },
  { key: 'nominal_value', label: 'Value', type: 'text', width: 'w-32' },
  { key: 'unit', label: 'Unit', type: 'text', width: 'w-16' },
  { key: 'plus_tolerance', label: '+ Tol', type: 'text', width: 'w-20' },
  { key: 'minus_tolerance', label: '- Tol', type: 'text', width: 'w-20' },
  { key: 'upper_limit', label: 'Upper', type: 'text', width: 'w-20' },
  { key: 'lower_limit', label: 'Lower', type: 'text', width: 'w-20' },
  {
    key: 'tolerance_source',
    label: 'Tol. Source',
    labelKey: 'source.inspection.toleranceSourceColumn',
    type: 'text',
    width: 'w-24',
    readOnly: true,
  },
  {
    key: 'classification',
    label: 'Criticality',
    type: 'select',
    options: CLASSIFICATIONS,
    width: 'w-28',
  },
  { key: 'inspection_method', label: 'Method', type: 'text', width: 'w-32' },
  { key: 'operation', label: 'Operation', type: 'text', width: 'w-28' },
  { key: 'aql', label: 'AQL', type: 'text', width: 'w-20' },
  { key: 'sample_size', label: 'Sample', type: 'number', width: 'w-20' },
  { key: 'supplier_inspection_rate', label: 'Supplier %', type: 'number', width: 'w-24' },
  { key: 'internal_inspection_rate', label: 'Internal %', type: 'number', width: 'w-24' },
  { key: 'reference', label: 'Reference', type: 'text', width: 'w-28' },
  { key: 'comments', label: 'Comments', type: 'text', width: 'w-48' },
]

const GEOMETRY = new Set<keyof InspectionRowValues>(GEOMETRY_FIELDS)

/**
 * A cell the drawing owns: every geometry column (and the tolerance source) of a row extracted
 * from the drawing. Such cells are never edited in the table; manual rows keep them editable.
 */
export function isDrawingOwnedCell(
  row: Pick<InspectionRowValues, 'source_key'>,
  key: keyof InspectionRowValues,
): boolean {
  return !!row.source_key?.trim() && GEOMETRY.has(key)
}

/** Columns the bulk editor may set on many rows at once: the user-owned ones. */
export const BULK_EDIT_FIELDS = [
  'inspection_method',
  'classification',
  'operation',
  'aql',
  'sample_size',
  'supplier_inspection_rate',
  'internal_inspection_rate',
  'reference',
  'comments',
] as const satisfies readonly (keyof InspectionRowValues)[]

export type BulkEditField = (typeof BULK_EDIT_FIELDS)[number]

/** Per-user column layout: order of column keys and the hidden ones. */
export interface InspectionColumnPrefs {
  order: string[]
  hidden: string[]
}

/**
 * The columns to show, in the user's order. Keys the user never placed (columns added in a
 * later release) keep their default position relative to the columns before them; unknown keys
 * are ignored. Balloon cannot be hidden.
 */
export function resolveColumns(prefs: InspectionColumnPrefs | null | undefined): {
  ordered: ColumnDef[]
  visible: ColumnDef[]
} {
  if (!prefs) return { ordered: COLUMNS, visible: COLUMNS }
  const byKey = new Map(COLUMNS.map((c) => [c.key as string, c]))
  const ordered: ColumnDef[] = []
  const placed = new Set<string>()
  for (const key of prefs.order) {
    const col = byKey.get(key)
    if (col && !placed.has(key)) {
      ordered.push(col)
      placed.add(key)
    }
  }
  COLUMNS.forEach((col, index) => {
    if (placed.has(col.key)) return
    // After the nearest default predecessor the user has placed; first when there is none.
    let at = 0
    for (let i = index - 1; i >= 0; i--) {
      const pos = ordered.findIndex((c) => c.key === COLUMNS[i].key)
      if (pos >= 0) {
        at = pos + 1
        break
      }
    }
    ordered.splice(at, 0, col)
    placed.add(col.key)
  })
  const hidden = new Set(prefs.hidden)
  hidden.delete('balloon_number')
  return { ordered, visible: ordered.filter((c) => !hidden.has(c.key)) }
}

// Font stack that can render GD&T / technical symbols (⌓, ⌭, ⊥, ⌖, Ø, …) decoded from
// SOLIDWORKS. 'Segoe UI Symbol' covers the Unicode Miscellaneous Technical block on Windows.
export const SYMBOL_FONT = "'Segoe UI', 'Segoe UI Symbol', 'Cambria Math', system-ui, sans-serif"
