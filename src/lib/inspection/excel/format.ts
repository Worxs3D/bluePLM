/**
 * Cell text for inspection row fields, including the combined `tolerance` and `spec` fields.
 * Values stay text: drawing values carry their own precision (`25.40`), which a number cell
 * would drop.
 */
import type { InspectionRowInput } from '@/lib/supabase'

import type { RowField } from './tokens'

/** A row as the report engine takes it. `tolerance_source` (schema 504) is optional, so rows from before it work too. */
export type InspectionReportRow = Omit<InspectionRowInput, 'tolerance_source'> & {
  tolerance_source?: string | null
  /** In a report with one row per sample: which sample of how many (`3 / 5`). */
  sample?: string | null
}

function text(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/** `0.10` → `+0.10`; keeps an explicit sign; `0` stays `0`. */
export function signed(value: string, sign: '+' | '-'): string {
  const v = value.trim()
  if (v === '') return ''
  if (/^[+\-−±]/.test(v)) return v.replace('−', '-')
  if (/^0*(\.0*)?$/.test(v)) return v
  return `${sign}${v}`
}

/** Magnitude text of a tolerance (`+0.10` → `0.10`). */
function magnitude(value: string): string {
  return value.trim().replace(/^[+\-−±]\s*/, '')
}

/** One-sided marker read from the nominal text (`12.5 MIN`). */
export function oneSidedMarker(nominal: string): 'MIN' | 'MAX' | null {
  const m = /\b(MIN|MAX)\.?\s*$/i.exec(nominal.trim())
  return m ? (m[1].toUpperCase() as 'MIN' | 'MAX') : null
}

/** Combined tolerance text, or '' when the row has none. */
export function formatTolerance(row: InspectionReportRow): string {
  const plus = text(row.plus_tolerance)
  const minus = text(row.minus_tolerance)
  const upper = text(row.upper_limit)
  const lower = text(row.lower_limit)
  if (plus.startsWith('±')) return plus
  if (plus !== '' || minus !== '') {
    if (plus !== '' && minus !== '' && magnitude(plus) === magnitude(minus) && !/^-/.test(plus) && !/^\+/.test(minus)) {
      return `±${magnitude(plus)}`
    }
    if (plus !== '' && minus === '' && !/^[+-]/.test(plus)) return `±${plus}`
    const parts = [plus !== '' ? signed(plus, '+') : '', minus !== '' ? signed(minus, '-') : ''].filter(Boolean)
    return parts.join(' / ')
  }
  if (upper !== '' && lower !== '') return `${lower} – ${upper}`
  if (lower !== '') return `${lower} MIN`
  if (upper !== '') return `${upper} MAX`
  return ''
}

/** A geometric tolerance row: its value is a feature control frame, which already states the tolerance. */
export function isGeometricTolerance(row: InspectionReportRow): boolean {
  return text(row.char_type).toUpperCase() === 'GTOL'
}

/**
 * Nominal plus tolerance (`25.40 ±0.10`, limits as `12.40 – 12.60`). A GTOL's frame
 * (`⌖ Ø0.05 Ⓜ A B C`) is the whole requirement; its tolerance columns repeat the frame's value
 * (extraction sets the upper limit from it), so they are not appended a second time.
 */
export function formatSpec(row: InspectionReportRow): string {
  const nominal = text(row.nominal_value)
  if (isGeometricTolerance(row) && nominal !== '') return nominal
  const plus = text(row.plus_tolerance)
  const minus = text(row.minus_tolerance)
  const tol = formatTolerance(row)
  if (plus === '' && minus === '' && tol !== '') {
    // Limits only: the limits are the requirement; the nominal is shown when it adds information.
    if (nominal === '' || oneSidedMarker(nominal)) return nominal || tol
    return `${nominal} (${tol})`
  }
  return [nominal, tol].filter(Boolean).join(' ')
}

/** Cell value for a field: text, or a number for the numeric columns. */
export function fieldValue(row: InspectionReportRow, field: RowField): string | number | null {
  switch (field) {
    case 'tolerance':
      return formatTolerance(row)
    case 'spec':
      return formatSpec(row)
    case 'plus_tolerance':
      return signed(text(row.plus_tolerance), '+')
    case 'minus_tolerance':
      return signed(text(row.minus_tolerance), '-')
    case 'tolerance_source':
      return text(row.tolerance_source)
    case 'sample':
      return text(row.sample)
    case 'sort_order':
    case 'sample_size':
    case 'supplier_inspection_rate':
    case 'internal_inspection_rate': {
      const v = row[field]
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    }
    default:
      return text(row[field])
  }
}

/** Text of a field as written (numbers stringified), for fingerprints. */
export function fieldText(row: InspectionReportRow, field: RowField): string {
  const v = fieldValue(row, field)
  return v === null ? '' : String(v)
}
