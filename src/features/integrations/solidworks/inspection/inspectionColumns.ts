import type { InspectionRowValues } from '@/lib/supabase'

export type ColumnType = 'text' | 'number' | 'select'

export interface ColumnDef {
  key: keyof InspectionRowValues
  label: string
  type: ColumnType
  options?: string[]
  width: string
  /** Set by extraction only; never editable in the table. */
  readOnly?: boolean
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

// Font stack that can render GD&T / technical symbols (⌓, ⌭, ⊥, ⌖, Ø, …) decoded from
// SOLIDWORKS. 'Segoe UI Symbol' covers the Unicode Miscellaneous Technical block on Windows.
export const SYMBOL_FONT = "'Segoe UI', 'Segoe UI Symbol', 'Cambria Math', system-ui, sans-serif"
