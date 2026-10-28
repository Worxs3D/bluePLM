/**
 * Merge characteristics extracted from a drawing into the Inspection table. Pure: the caller
 * supplies the current rows, the extraction, the highest balloon number the file has ever used
 * and an id generator.
 *
 * Rules (plan `native-inspection-balloons-agents.plan.md`):
 * - A row is matched to an annotation by `source_key`. A matched row keeps its balloon number and
 *   every user column; only the geometry-derived columns are refreshed.
 * - A row without a key is adopted (bound to an annotation, keeping its number) only when its
 *   (type, nominal, plus, minus) signature matches exactly one keyless row and exactly one
 *   unmatched characteristic. Anything ambiguous stays manual.
 * - New characteristics are numbered above `highestUsedNumber` (and above every number in the
 *   table) in reading order: sheet order, top to bottom, left to right, where items whose y differ
 *   by less than 2% of the sheet height read as one line.
 * - Rows whose annotation is gone are only listed; `applyCharacteristicMerge` removes the ones the
 *   user leaves selected.
 * - A row whose annotation the service found but could not read (`skipped`) is not gone: it is
 *   listed as `unreadable`, kept as it is, and never offered for removal.
 */
import { emptyRowValues } from '../supabase/files/inspectionRows'
import type { InspectionRowInput, InspectionRowValues } from '../supabase/files/inspection'
import type {
  ExtractedCharacteristic,
  ExtractedDrawingSheet,
  ExtractedSkippedAnnotation,
} from './types'

export interface CharacteristicMergeInput {
  /** The current table. */
  rows: InspectionRowInput[]
  extracted: ExtractedCharacteristic[]
  /** Sheets of the extraction, in sheet order (for reading order and the line band). */
  sheets: ExtractedDrawingSheet[]
  /** Max numeric balloon number over the current rows and every version snapshot. */
  highestUsedNumber: number
  /** Add reference (driven) dimensions as new rows. Default false. */
  includeReference?: boolean
  /** Annotations the service found but could not read. Rows keyed to them are kept. */
  skipped?: ExtractedSkippedAnnotation[]
  /** Id for each added row. */
  newId: () => string
}

export interface CharacteristicMergePlan {
  updated: {
    rowId: string
    before: InspectionRowInput
    after: InspectionRowInput
    changedFields: (keyof InspectionRowValues)[]
  }[]
  /** Row ids matched with no change. */
  unchanged: string[]
  /** New rows with fresh balloon numbers, in numbering order. */
  added: InspectionRowInput[]
  /** Rows with a `source_key` no longer in the drawing. */
  missing: InspectionRowInput[]
  /** Keyed rows whose annotation is in the drawing but could not be read. Kept unchanged. */
  unreadable: InspectionRowInput[]
  /** Row ids without a `source_key` left alone. */
  manual: string[]
  /** Keyless rows bound to an annotation (also listed in `updated`). */
  adopted: { rowId: string; sourceKey: string }[]
}

/** Columns extraction owns. Everything else on a row belongs to the user. */
export const GEOMETRY_FIELDS = [
  'char_type',
  'sub_type',
  'nominal_value',
  'unit',
  'plus_tolerance',
  'minus_tolerance',
  'upper_limit',
  'lower_limit',
  'zone',
  'source_key',
  'source_sheet',
  'source_view',
] as const satisfies readonly (keyof InspectionRowValues)[]

type GeometryField = (typeof GEOMETRY_FIELDS)[number]

/** Fraction of the sheet height within which two items read as one line, left to right. */
export const READING_LINE_BAND = 0.02

export function charTypeOf(kind: ExtractedCharacteristic['kind']): string {
  if (kind === 'gtol') return 'GTOL'
  if (kind === 'surfaceFinish') return 'Note'
  return 'Dimension'
}

export function subTypeOf(c: ExtractedCharacteristic): string | null {
  if (c.kind === 'holeCallout') return 'Hole Callout'
  if (c.kind === 'surfaceFinish') return 'Surface Finish'
  return c.subType
}

/** The geometry columns a characteristic sets. */
export function geometryOf(c: ExtractedCharacteristic): Pick<InspectionRowValues, GeometryField> {
  return {
    char_type: charTypeOf(c.kind),
    sub_type: subTypeOf(c),
    nominal_value: c.nominal,
    unit: c.unit,
    plus_tolerance: c.plusTolerance,
    minus_tolerance: c.minusTolerance,
    upper_limit: c.upperLimit,
    lower_limit: c.lowerLimit,
    zone: c.zone,
    source_key: c.sourceKey,
    source_sheet: c.sheet,
    source_view: c.view,
  }
}

/** Numeric value of a balloon number, or null for blank / non-numeric labels. */
export function balloonNumberValue(label: string | null): number | null {
  if (!label) return null
  const trimmed = label.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

/** Balloon ascending (natural order), blank balloons last. Stable. */
export function sortByBalloonNumber(rows: InspectionRowInput[]): InspectionRowInput[] {
  return [...rows].sort((a, b) => {
    const av = a.balloon_number ?? ''
    const bv = b.balloon_number ?? ''
    if (av === '' && bv === '') return 0
    if (av === '') return 1
    if (bv === '') return -1
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
  })
}

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ''

/** The annotation part of a source key: `abc#1` → `abc`. */
export function baseKeyOf(sourceKey: string): string {
  const hash = sourceKey.indexOf('#')
  return hash < 0 ? sourceKey : sourceKey.slice(0, hash)
}

/** Text compared for adoption: Unicode-normalized, no spaces, one diameter glyph, `.` decimals, numbers canonical. */
export function normalizeValue(v: string | null | undefined): string {
  if (blank(v)) return ''
  const text = (v as string)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[⌀∅]/g, 'Ø')
    .replace(/(\d),(\d)/g, '$1.$2')
    .toLowerCase()
  const number = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : NaN
  return Number.isFinite(number) ? String(number) : text
}

function signature(
  charType: string | null,
  nominal: string | null,
  plus: string | null,
  minus: string | null,
): string {
  return [charType ?? '', normalizeValue(nominal), normalizeValue(plus), normalizeValue(minus)].join('|')
}

/**
 * Reading order: sheet order, then lines top to bottom (y descending), then left to right.
 * A line collects items whose y is within `READING_LINE_BAND` of the sheet height of the
 * line's first (topmost) item. Ties keep extraction order.
 */
export function inReadingOrder(
  items: ExtractedCharacteristic[],
  sheets: ExtractedDrawingSheet[],
): ExtractedCharacteristic[] {
  const sheetIndex = new Map<string, number>()
  sheets.forEach((s, i) => sheetIndex.set(s.name, i))
  for (const c of items) if (!sheetIndex.has(c.sheet)) sheetIndex.set(c.sheet, sheetIndex.size)

  const bySheet = new Map<string, { c: ExtractedCharacteristic; i: number }[]>()
  items.forEach((c, i) => {
    const list = bySheet.get(c.sheet) ?? []
    list.push({ c, i })
    bySheet.set(c.sheet, list)
  })

  const out: ExtractedCharacteristic[] = []
  const order = [...bySheet.entries()].sort(
    ([a], [b]) => (sheetIndex.get(a) ?? 0) - (sheetIndex.get(b) ?? 0),
  )
  for (const [name, list] of order) {
    const sheet = sheets.find((s) => s.name === name)
    // Without the sheet's size, the tallest item stands in for its height.
    const height = sheet && sheet.heightM > 0 ? sheet.heightM : Math.max(0, ...list.map((e) => e.c.y))
    const band = height * READING_LINE_BAND
    const byY = [...list].sort((a, b) => b.c.y - a.c.y || a.i - b.i)
    let line: typeof list = []
    let lineTop = 0
    const flush = () => {
      line.sort((a, b) => a.c.x - b.c.x || a.i - b.i)
      out.push(...line.map((e) => e.c))
      line = []
    }
    for (const entry of byY) {
      if (line.length > 0 && lineTop - entry.c.y >= band) flush()
      if (line.length === 0) lineTop = entry.c.y
      line.push(entry)
    }
    flush()
  }
  return out
}

function withGeometry(
  row: InspectionRowInput,
  c: ExtractedCharacteristic,
): { after: InspectionRowInput; changedFields: GeometryField[] } {
  const geometry = geometryOf(c)
  // The API does not always expose a zone; never blank one the user typed.
  if (geometry.zone === null) geometry.zone = row.zone
  const after: InspectionRowInput = { ...row, ...geometry }
  const changedFields = GEOMETRY_FIELDS.filter((f) => (row[f] ?? null) !== (after[f] ?? null))
  return { after, changedFields }
}

export function planCharacteristicMerge(input: CharacteristicMergeInput): CharacteristicMergePlan {
  const { rows, extracted, sheets, includeReference = false, newId } = input
  const plan: CharacteristicMergePlan = {
    updated: [],
    unchanged: [],
    added: [],
    missing: [],
    unreadable: [],
    manual: [],
    adopted: [],
  }

  const skippedKeys = new Set<string>()
  const skippedBaseKeys = new Set<string>()
  for (const s of input.skipped ?? []) {
    if (s.sourceKey) skippedKeys.add(s.sourceKey)
    if (s.baseKey) skippedBaseKeys.add(s.baseKey)
  }
  const isUnreadable = (key: string) =>
    skippedKeys.has(key) || skippedBaseKeys.has(baseKeyOf(key))

  const byKey = new Map<string, ExtractedCharacteristic>()
  for (const c of extracted) if (!byKey.has(c.sourceKey)) byKey.set(c.sourceKey, c)

  const matchedKeys = new Set<string>()
  const keyless: InspectionRowInput[] = []
  const record = (row: InspectionRowInput, c: ExtractedCharacteristic) => {
    const { after, changedFields } = withGeometry(row, c)
    if (changedFields.length === 0) plan.unchanged.push(row.id)
    else plan.updated.push({ rowId: row.id, before: row, after, changedFields })
  }

  // 1. Match by key. A keyed row keeps its key even when the characteristic is a reference one.
  for (const row of rows) {
    if (blank(row.source_key)) {
      keyless.push(row)
      continue
    }
    const c = byKey.get(row.source_key as string)
    if (!c) {
      if (isUnreadable(row.source_key as string)) plan.unreadable.push(row)
      else plan.missing.push(row)
      continue
    }
    matchedKeys.add(c.sourceKey)
    record(row, c)
  }

  const candidates = extracted.filter(
    (c, i) =>
      !matchedKeys.has(c.sourceKey) &&
      (includeReference || !c.isReference) &&
      extracted.findIndex((o) => o.sourceKey === c.sourceKey) === i,
  )

  // 2. Adopt keyless rows whose signature is unique on both sides.
  const rowsBySig = new Map<string, InspectionRowInput[]>()
  for (const row of keyless) {
    const sig = signature(row.char_type, row.nominal_value, row.plus_tolerance, row.minus_tolerance)
    rowsBySig.set(sig, [...(rowsBySig.get(sig) ?? []), row])
  }
  const charsBySig = new Map<string, ExtractedCharacteristic[]>()
  for (const c of candidates) {
    const sig = signature(charTypeOf(c.kind), c.nominal, c.plusTolerance, c.minusTolerance)
    charsBySig.set(sig, [...(charsBySig.get(sig) ?? []), c])
  }
  const adoptedKeys = new Set<string>()
  for (const row of keyless) {
    const sig = signature(row.char_type, row.nominal_value, row.plus_tolerance, row.minus_tolerance)
    const chars = charsBySig.get(sig)
    if (normalizeValue(row.nominal_value) === '' || rowsBySig.get(sig)?.length !== 1 || chars?.length !== 1) {
      plan.manual.push(row.id)
      continue
    }
    const c = chars[0]
    adoptedKeys.add(c.sourceKey)
    plan.adopted.push({ rowId: row.id, sourceKey: c.sourceKey })
    record(row, c)
  }

  // 3. Number what is left above every number this file has used.
  const tableMax = Math.max(0, ...rows.map((r) => balloonNumberValue(r.balloon_number) ?? 0))
  let next = Math.max(Math.floor(input.highestUsedNumber) || 0, tableMax) + 1
  const fresh = inReadingOrder(
    candidates.filter((c) => !adoptedKeys.has(c.sourceKey)),
    sheets,
  )
  for (const c of fresh) {
    plan.added.push({
      ...emptyRowValues(0),
      ...geometryOf(c),
      id: newId(),
      balloon_number: String(next++),
    })
  }
  return plan
}

/**
 * The table after the merge: matched rows refreshed, the selected missing rows removed, new rows
 * appended, all sorted by balloon number with `sort_order` renumbered.
 */
export function applyCharacteristicMerge(
  rows: InspectionRowInput[],
  plan: CharacteristicMergePlan,
  removeMissingIds: Set<string>,
): InspectionRowInput[] {
  const afterById = new Map(plan.updated.map((u) => [u.rowId, u.after]))
  const missingIds = new Set(plan.missing.map((r) => r.id))
  const kept = rows
    .filter((r) => !(missingIds.has(r.id) && removeMissingIds.has(r.id)))
    .map((r) => afterById.get(r.id) ?? r)
  return sortByBalloonNumber([...kept, ...plan.added]).map((r, i) => ({ ...r, sort_order: i }))
}
