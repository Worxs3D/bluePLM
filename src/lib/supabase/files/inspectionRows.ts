/**
 * Inspection row shape helpers shared by the Inspection tab and the characteristic merge planner.
 */
import type { InspectionRowInput, InspectionRowValues } from './inspection'

/** A blank row with every editable field null. */
export function emptyRowValues(sortOrder: number): InspectionRowValues {
  return {
    sort_order: sortOrder,
    balloon_number: null,
    char_id: null,
    zone: null,
    char_type: null,
    sub_type: null,
    nominal_value: null,
    unit: null,
    plus_tolerance: null,
    minus_tolerance: null,
    upper_limit: null,
    lower_limit: null,
    classification: null,
    inspection_method: null,
    operation: null,
    aql: null,
    sample_size: null,
    supplier_inspection_rate: null,
    internal_inspection_rate: null,
    reference: null,
    comments: null,
    source_key: null,
    source_sheet: null,
    source_view: null,
  }
}

/** Map any inspection row record (live or snapshot) to the editable input shape. */
export function toRowInput(row: object): InspectionRowInput {
  const record = row as Record<string, unknown>
  const base = emptyRowValues(0)
  const result: InspectionRowInput = { ...base, id: String(record.id ?? crypto.randomUUID()) }
  for (const key of Object.keys(base) as (keyof InspectionRowValues)[]) {
    if (record[key] !== undefined && record[key] !== null) {
      // @ts-expect-error - assigning dynamically validated field
      result[key] = record[key]
    }
  }
  return result
}
