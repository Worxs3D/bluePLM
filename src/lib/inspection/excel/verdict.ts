/**
 * Pass / fail of a characteristic from its measured values. Pure: no exceljs.
 *
 * A verdict is computed only when the requirement is numeric: a nominal with a plus / minus
 * tolerance, limits, a one-sided `MIN` / `MAX`, or a GTOL / surface finish value (a maximum).
 * Angles may be written in decimal degrees or degrees-minutes-seconds; a measured value written
 * in the other length unit (mm vs in) is converted. Anything else (threads, notes, a basic or
 * untoleranced dimension, a GTOL at MMC / LMC, a non-numeric measurement) has no computed verdict: the recipient's
 * own verdict decides.
 */
import { oneSidedMarker, type InspectionReportRow } from './format'

export type Verdict = 'pass' | 'fail'

type QuantityUnit = 'mm' | 'in' | 'deg' | null

interface Quantity {
  value: number
  unit: QuantityUnit
}

const MM_PER_IN = 25.4

function normalizeUnit(unit: string | null | undefined): QuantityUnit {
  const u = (unit ?? '').trim().toLowerCase()
  if (u === 'mm') return 'mm'
  if (u === 'in' || u === 'inch' || u === '"' || u === 'inches') return 'in'
  if (u === '°' || u === 'deg' || u === 'degree' || u === 'degrees') return 'deg'
  return null
}

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`
const NUMBER_RE = new RegExp(`^${NUMBER}$`)
const DMS_RE = new RegExp(
  String.raw`^([+-])?\s*(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′])?\s*(?:(\d+(?:\.\d+)?)\s*["″])?$`,
)
const FRACTION_RE = /^([+-])?\s*(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+)$/

/** Parse a value written on a drawing or by an inspector, or null when it is not one number. */
export function parseQuantity(input: string | number | null | undefined): Quantity | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input, unit: null } : null
  let s = input.trim().replace(/[−–]/g, '-').replace(/\s+/g, ' ')
  if (s === '') return null
  // Instance count (`4X`), diameter / radius prefixes, one-sided markers.
  s = s.replace(/^\d+\s*[xX×]\s+/, '')
  s = s.replace(/^(?:[Ø⌀∅]|S[Ø⌀∅]|SR|R)\s*/, '')
  s = s.replace(/\s*\b(?:MIN|MAX)\.?$/i, '').trim()
  // Decimal comma (`12,5`), only when unambiguous.
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.')

  const dms = DMS_RE.exec(s)
  if (dms) {
    const deg = Number(dms[2]) + Number(dms[3] ?? 0) / 60 + Number(dms[4] ?? 0) / 3600
    return { value: dms[1] === '-' ? -deg : deg, unit: 'deg' }
  }

  let unit: QuantityUnit = null
  const unitMatch = /\s*(mm|in|inch|inches|"|deg|degrees?)$/i.exec(s)
  if (unitMatch) {
    unit = normalizeUnit(unitMatch[1])
    s = s.slice(0, unitMatch.index).trim()
  }
  if (NUMBER_RE.test(s)) return { value: Number(s), unit }
  const frac = FRACTION_RE.exec(s)
  if (frac && Number(frac[4]) !== 0) {
    const v = Number(frac[2] ?? 0) + Number(frac[3]) / Number(frac[4])
    return { value: frac[1] === '-' ? -v : v, unit }
  }
  return null
}

function convert(q: Quantity, to: QuantityUnit): number | null {
  if (q.unit === null || to === null || q.unit === to) return q.value
  if (q.unit === 'deg' || to === 'deg') return null
  return q.unit === 'in' ? q.value * MM_PER_IN : q.value / MM_PER_IN
}

export interface Limits {
  lower: number
  upper: number
  unit: QuantityUnit
}

function text(v: string | null | undefined): string {
  return (v ?? '').trim()
}

/** Signed tolerance; an unsigned value takes `defaultSign`. */
function tolerance(raw: string, unit: QuantityUnit, defaultSign: 1 | -1): number | null {
  const s = raw.replace(/^±\s*/, '')
  const q = parseQuantity(s)
  if (!q) return null
  const v = convert(q, unit)
  if (v === null) return null
  return /^[+-]/.test(s.trim()) ? v : defaultSign * Math.abs(v)
}

const MODIFIER_SYMBOL_RE = /[ⓂⓁ]|\bMMC\b|\bLMC\b|\(\s*[ML]\s*\)/i
/** A bare `M` / `L` modifier written as text after the value (`Ø0.10 M`), GTOL rows only. */
const MODIFIER_LETTER_RE = /(?:^|[\s\d.])[ML](?:\s|$)/

/**
 * A GTOL requirement at MMC / LMC (ISO 2692, ASME Y14.5 Ⓜ / Ⓛ) gets bonus tolerance from the
 * feature's actual size, which the row does not carry: no fixed limit is the acceptance limit.
 */
export function hasMaterialConditionModifier(row: InspectionReportRow): boolean {
  const fields = [row.nominal_value, row.upper_limit, row.lower_limit, row.plus_tolerance, row.minus_tolerance, row.sub_type]
  const joined = fields.map((v) => text(v)).join(' ')
  if (MODIFIER_SYMBOL_RE.test(joined)) return true
  if (text(row.char_type).toLowerCase() !== 'gtol') return false
  return [row.nominal_value, row.upper_limit, row.lower_limit].some((v) => MODIFIER_LETTER_RE.test(text(v)))
}

/** Acceptance limits of a row, or null when its requirement is not numeric. */
export function limitsOf(row: InspectionReportRow): Limits | null {
  if (hasMaterialConditionModifier(row)) return null
  const nominalText = text(row.nominal_value)
  const nominal = parseQuantity(nominalText)
  const unit = nominal?.unit ?? normalizeUnit(row.unit)
  const upperQ = parseQuantity(text(row.upper_limit))
  const lowerQ = parseQuantity(text(row.lower_limit))
  if (upperQ || lowerQ) {
    const upper = upperQ ? convert(upperQ, unit) : Infinity
    const lower = lowerQ ? convert(lowerQ, unit) : -Infinity
    if (upper === null || lower === null) return null
    return { lower: Math.min(lower, upper), upper: Math.max(lower, upper), unit }
  }
  if (!nominal) return null
  const marker = oneSidedMarker(nominalText)
  if (marker === 'MIN') return { lower: nominal.value, upper: Infinity, unit }
  if (marker === 'MAX') return { lower: -Infinity, upper: nominal.value, unit }

  const plusRaw = text(row.plus_tolerance)
  const minusRaw = text(row.minus_tolerance)
  if (plusRaw !== '' || minusRaw !== '') {
    let plus: number | null
    let minus: number | null
    if (plusRaw.startsWith('±') || (minusRaw === '' && !/^[+-]/.test(plusRaw))) {
      const t = tolerance(plusRaw, unit, 1)
      if (t === null) return null
      plus = Math.abs(t)
      minus = -Math.abs(t)
    } else if (plusRaw === '' && minusRaw.startsWith('±')) {
      const t = tolerance(minusRaw, unit, 1)
      if (t === null) return null
      plus = Math.abs(t)
      minus = -Math.abs(t)
    } else {
      plus = plusRaw === '' ? 0 : tolerance(plusRaw, unit, 1)
      minus = minusRaw === '' ? 0 : tolerance(minusRaw, unit, -1)
    }
    if (plus === null || minus === null) return null
    const a = nominal.value + plus
    const b = nominal.value + minus
    return { lower: Math.min(a, b), upper: Math.max(a, b), unit }
  }

  // A GTOL frame or surface finish value is a maximum (ISO 1101 tolerance zone, ISO 1302 Ra).
  const type = text(row.char_type).toLowerCase()
  const sub = text(row.sub_type).toLowerCase()
  if (type === 'gtol' || sub === 'surface finish') return { lower: -Infinity, upper: nominal.value, unit }
  return null
}

/**
 * Verdict from measured values: 'fail' when any value is outside the limits, 'pass' when at least
 * `required` values are there and all are within, null when there is nothing to compute from or
 * values are still missing (a characteristic measured on 5 parts with one value is open, not
 * passed). One out-of-tolerance value fails the characteristic whatever is still missing.
 */
export function computeVerdict(row: InspectionReportRow, measured: readonly string[], required = 1): Verdict | null {
  const limits = limitsOf(row)
  if (!limits) return null
  const values = measured.map((m) => m.trim()).filter((m) => m !== '')
  if (values.length === 0) return null
  const eps = 1e-9 * Math.max(1, Math.abs(Number.isFinite(limits.lower) ? limits.lower : 0), Math.abs(Number.isFinite(limits.upper) ? limits.upper : 0))
  let pass = true
  for (const raw of values) {
    const q = parseQuantity(raw)
    if (!q) return null
    const v = convert(q, limits.unit)
    if (v === null) return null
    if (v < limits.lower - eps || v > limits.upper + eps) pass = false
  }
  if (!pass) return 'fail'
  return values.length >= required ? 'pass' : null
}

const PASS_WORDS = new Set(['pass', 'passed', 'p', 'ok', 'accept', 'accepted', 'acc', 'yes', 'y', 'go', 'conforming', 'conform', '✓', '✔'])
const FAIL_WORDS = new Set(['fail', 'failed', 'f', 'ng', 'nok', 'nc', 'reject', 'rejected', 'rej', 'no', 'n', 'no go', 'nogo', 'nonconforming', 'non-conforming', '✗', '✘', 'x'])

/** A verdict typed by the recipient (`PASS`, `OK`, `NG`, `Reject`...), or null. */
export function parseVerdictText(value: string): Verdict | null {
  const v = value.trim().toLowerCase()
  if (PASS_WORDS.has(v)) return 'pass'
  if (FAIL_WORDS.has(v)) return 'fail'
  return null
}

export interface ResultsSummary {
  total: number
  pass: number
  fail: number
  blank: number
}

export function summarizeResults(rows: ReadonlyArray<{ verdict: Verdict | null }>): ResultsSummary {
  let pass = 0
  let fail = 0
  for (const r of rows) {
    if (r.verdict === 'pass') pass++
    else if (r.verdict === 'fail') fail++
  }
  return { total: rows.length, pass, fail, blank: rows.length - pass - fail }
}
