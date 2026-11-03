/**
 * Token language of BluePLM inspection report templates (Excel workbooks).
 *
 * Same `{{NAME}}` / `{{NAME:arg}}` style as the old Google Sheets templates
 * (`src/features/integrations/google-drive/lib/sheetTemplates.ts`), whose tokens keep working:
 * `{{BR_NUMBER}}` is an alias of `{{PART_NUMBER}}`, `{{PART_NAME}}` is still filled, and a legacy
 * `{{INSPECTION_TABLE}}` anchor row with `{{COL:field}}` header tokens above it is understood.
 *
 * - Scalars: `{{PART_NUMBER}} {{PART_NAME}} {{REVISION}} {{DESCRIPTION}} {{DRAWING_NAME}}
 *   {{DRAWING_VERSION}} {{REPORT_NUMBER}} {{DATE}} {{ORG_NAME}} {{GENERAL_TOLERANCES}}
 *   {{PROP:<custom property>}}`, anywhere in a cell's text.
 * - `{{ENTRY:<name>}}`: a header cell the recipient fills in (serial number, supplier, sign-off).
 *   Left blank and unlocked; read back by `readReturnedResults` as `entries[name]`.
 * - Row template (the first row holding `{{COL:<field>}}` tokens) repeats once per characteristic.
 *   In it: `{{COL:<field>}}`, `{{RESULT}}` / `{{RESULT:n}}` (measured values), `{{VERDICT}}`, and
 *   `{{INPUT:<name>}}` (per-row free text such as the measuring tool). Results, verdict and inputs
 *   are left blank and unlocked.
 * - `{{DRAWING}}` anchors the drawing pages (stacked downward from it). Without one, the pages go
 *   under the table on the row template's sheet.
 * - `{{LOGO}}` anchors the organization logo, fitted to the cell's merged range (aspect kept).
 *   Every `{{LOGO}}` cell gets the logo; with no logo the cell is cleared.
 */

/** A row field a `{{COL:<field>}}` token can name. */
export const ROW_FIELDS = [
  'sort_order',
  'balloon_number',
  'char_id',
  'zone',
  'char_type',
  'sub_type',
  'nominal_value',
  'unit',
  'plus_tolerance',
  'minus_tolerance',
  'upper_limit',
  'lower_limit',
  'classification',
  'inspection_method',
  'operation',
  'aql',
  'sample_size',
  'supplier_inspection_rate',
  'internal_inspection_rate',
  'reference',
  'comments',
  'source_key',
  'source_sheet',
  'source_view',
  'tolerance_source',
  /** Combined tolerance (`±0.10`, `+0.10 / -0.05`, `12.40 – 12.60`, `MIN`). */
  'tolerance',
  /** Nominal plus tolerance (`25.40 ±0.10`). */
  'spec',
] as const

export type RowField = (typeof ROW_FIELDS)[number]

const ROW_FIELD_SET: ReadonlySet<string> = new Set(ROW_FIELDS)

export function isRowField(name: string): name is RowField {
  return ROW_FIELD_SET.has(name)
}

/** Old Google Sheets field names that map to a field. */
const FIELD_ALIASES: Readonly<Record<string, RowField>> = {
  balloon: 'balloon_number',
  nominal: 'nominal_value',
  type: 'char_type',
  subtype: 'sub_type',
  method: 'inspection_method',
}

/** Canonical field for a `{{COL:...}}` argument, or null when unknown. Case-insensitive. */
export function resolveRowField(name: string): RowField | null {
  const key = name.trim().toLowerCase()
  if (isRowField(key)) return key
  return FIELD_ALIASES[key] ?? null
}

export const SCALAR_NAMES = [
  'PART_NUMBER',
  'PART_NAME',
  'REVISION',
  'DESCRIPTION',
  'DRAWING_NAME',
  'DRAWING_VERSION',
  'REPORT_NUMBER',
  'DATE',
  'ORG_NAME',
  'GENERAL_TOLERANCES',
] as const

export type ScalarName = (typeof SCALAR_NAMES)[number]

const SCALAR_SET: ReadonlySet<string> = new Set(SCALAR_NAMES)

/** Legacy scalar names → canonical. */
const SCALAR_ALIASES: Readonly<Record<string, ScalarName>> = {
  BR_NUMBER: 'PART_NUMBER',
}

export function resolveScalar(name: string): ScalarName | null {
  const key = name.trim().toUpperCase()
  if (SCALAR_SET.has(key)) return key as ScalarName
  return SCALAR_ALIASES[key] ?? null
}

/** Tokens recognised but not filled by the Excel engine (blanked, with a warning). */
export const UNSUPPORTED_LEGACY_TOKENS: ReadonlySet<string> = new Set(['PART_PREVIEW'])

export type ParsedToken =
  | { kind: 'scalar'; name: ScalarName; raw: string }
  | { kind: 'prop'; name: string; raw: string }
  | { kind: 'entry'; name: string; raw: string }
  | { kind: 'col'; field: RowField; raw: string }
  | { kind: 'unknownCol'; field: string; raw: string }
  | { kind: 'result'; index: number; raw: string }
  | { kind: 'verdict'; raw: string }
  | { kind: 'input'; name: string; raw: string }
  | { kind: 'drawing'; raw: string }
  | { kind: 'logo'; raw: string }
  | { kind: 'tableAnchor'; raw: string }
  | { kind: 'legacy'; name: string; raw: string }
  | { kind: 'unknown'; name: string; raw: string }

const TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^}]*?)\s*)?\}\}/g

/** Keys (entry / input names) are stored as given but trimmed; empty is invalid. */
function cleanKey(arg: string | undefined): string | null {
  const v = (arg ?? '').trim()
  return v === '' ? null : v
}

/** Every token in a cell text, in order. */
export function parseTokens(text: string): ParsedToken[] {
  const out: ParsedToken[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0]
    const name = m[1].toUpperCase()
    const arg = m[2]
    switch (name) {
      case 'COL': {
        const field = resolveRowField(arg ?? '')
        out.push(field ? { kind: 'col', field, raw } : { kind: 'unknownCol', field: arg ?? '', raw })
        break
      }
      case 'RESULT': {
        const n = arg === undefined || arg.trim() === '' ? 1 : Number(arg)
        if (Number.isInteger(n) && n >= 1 && n <= 50) out.push({ kind: 'result', index: n, raw })
        else out.push({ kind: 'unknown', name: `RESULT:${arg ?? ''}`, raw })
        break
      }
      case 'VERDICT':
        out.push({ kind: 'verdict', raw })
        break
      case 'INPUT': {
        const key = cleanKey(arg)
        out.push(key ? { kind: 'input', name: key, raw } : { kind: 'unknown', name: 'INPUT:', raw })
        break
      }
      case 'ENTRY': {
        const key = cleanKey(arg)
        out.push(key ? { kind: 'entry', name: key, raw } : { kind: 'unknown', name: 'ENTRY:', raw })
        break
      }
      case 'PROP': {
        const key = cleanKey(arg)
        out.push(key ? { kind: 'prop', name: key, raw } : { kind: 'unknown', name: 'PROP:', raw })
        break
      }
      case 'DRAWING':
        out.push({ kind: 'drawing', raw })
        break
      case 'LOGO':
        out.push({ kind: 'logo', raw })
        break
      case 'INSPECTION_TABLE':
        out.push({ kind: 'tableAnchor', raw })
        break
      default: {
        const scalar = arg === undefined ? resolveScalar(name) : null
        if (scalar) out.push({ kind: 'scalar', name: scalar, raw })
        else if (UNSUPPORTED_LEGACY_TOKENS.has(name)) out.push({ kind: 'legacy', name, raw })
        else out.push({ kind: 'unknown', name: arg === undefined ? name : `${name}:${arg}`, raw })
      }
    }
  }
  return out
}

export function hasToken(text: string): boolean {
  return text.includes('{{') && parseTokens(text).length > 0
}

/** Default English column captions, used for legacy `{{INSPECTION_TABLE}}` header cells. */
export const DEFAULT_FIELD_CAPTIONS: Readonly<Record<RowField, string>> = {
  sort_order: '#',
  balloon_number: 'Balloon',
  char_id: 'Char. ID',
  zone: 'Zone',
  char_type: 'Type',
  sub_type: 'Sub-type',
  nominal_value: 'Nominal',
  unit: 'Unit',
  plus_tolerance: 'Plus tol.',
  minus_tolerance: 'Minus tol.',
  upper_limit: 'Upper limit',
  lower_limit: 'Lower limit',
  classification: 'Classification',
  inspection_method: 'Method',
  operation: 'Operation',
  aql: 'AQL',
  sample_size: 'Sample size',
  supplier_inspection_rate: 'Supplier rate',
  internal_inspection_rate: 'Internal rate',
  reference: 'Reference',
  comments: 'Comments',
  source_key: 'Source key',
  source_sheet: 'Sheet',
  source_view: 'View',
  tolerance_source: 'Tolerance source',
  tolerance: 'Tolerance',
  spec: 'Requirement',
}
