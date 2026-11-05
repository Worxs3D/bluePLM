/**
 * General (title block) tolerances: read the "unless otherwise specified" tolerance block from a
 * sheet's notes, and give a characteristic with no tolerance of its own the tolerance that block
 * assigns to it. Pure.
 *
 * Two layouts are read:
 * - one note holding the whole block, line by line (`TWO PLACE DECIMAL ±.01`, `ISO 2768-mK`);
 * - a grid of separate notes, a label note and a value note on one line (`.XX` | `±0.01`), which
 *   is how most sheet formats lay the block out in table cells.
 *
 * Either layout may be a table with column headers (`LINEAR` | `ANGLE`) over per-decimal-place
 * rows (`X. ±0.2` | `X. ±1`): an entry belongs to the column whose header it sits under, so an
 * angle column gives per-decimal-place angle rules instead of being read as lengths.
 *
 * Nothing is guessed. A label with no value (the stock SOLIDWORKS ANSI block ships
 * `TWO PLACE DECIMAL ±` with the value blank) is no rule, and a characteristic no rule covers keeps
 * a null tolerance.
 */
import type { ExtractedCharacteristic, ExtractedDrawingCharacteristics, ExtractedSheetNote } from './types'

export type LengthUnit = 'mm' | 'in'
export type Iso2768Class = 'f' | 'm' | 'c' | 'v'
export type Iso2768GeometricClass = 'H' | 'K' | 'L'

/** A tolerance as written: its value and the number of decimals it was written with. */
export interface ToleranceValue {
  value: number
  /** Decimals as written (`.005` → 3); null for a fraction (`1/64`). */
  places: number | null
  /** The value as written, for display (`.005`, `1/64`, `0°30'`). */
  text: string
}

export interface DecimalPlaceRule {
  /** Decimal places of the values the rule covers (`.XX` → 2, `X` → 0). */
  places: number
  tolerance: ToleranceValue
}

export interface GeneralToleranceRules {
  /** Unit the block states (`DIMENSIONS ARE IN INCHES`), or null when it does not say. */
  unit: LengthUnit | null
  /** Symmetric tolerance per number of decimal places. */
  decimal: DecimalPlaceRule[]
  /** One symmetric tolerance for every linear value (`TOLERANCES ±0.1`). */
  linear: ToleranceValue | null
  /** For values written as fractions, in inches (`FRACTIONAL ±1/64`). */
  fractional: ToleranceValue | null
  /** For angles, in degrees (`ANGULAR: MACH ±0.5°`). */
  angular: ToleranceValue | null
  /** For angles, per number of decimal places, in degrees (an `ANGLE` column of `X.X ±0.5`). */
  angularDecimal: DecimalPlaceRule[]
  /** `ISO 2768-mK`: linear class and, when given, the geometrical class (ISO 2768-2). */
  iso2768: { linear: Iso2768Class; geometric: Iso2768GeometricClass | null } | null
}

/** Which rule gave a characteristic its tolerance. */
export type GeneralToleranceBasis =
  | { kind: 'decimal'; places: number; tolerance: string }
  | { kind: 'linear'; tolerance: string }
  | { kind: 'fractional'; tolerance: string }
  /** `places` set: the angle rule for that number of decimal places. */
  | { kind: 'angular'; tolerance: string; places?: number }
  | {
      kind: 'iso2768'
      cls: Iso2768Class
      /** ISO 2768-1 table: 1 linear dimensions, 2 broken edges (external radii, chamfer heights). */
      table: 1 | 2
      /** The nominal size range the value fell in, mm (`over 6 up to 30`). */
      rangeMm: { over: number; upTo: number | null }
      /** Permissible deviation, ± mm. */
      toleranceMm: number
    }

export interface GeneralTolerance {
  /** Signed, formatted like the service's own (`+0.10`). */
  plus: string
  minus: string
  upper: string
  lower: string
  basis: GeneralToleranceBasis
}

// ---------------------------------------------------------------------------------------------
// ISO 2768-1:1989, "General tolerances - Part 1: Tolerances for linear and angular dimensions
// without individual tolerance indications". Permissible deviations in mm.
// Table 1 (linear dimensions except broken edges), nominal size ranges:
//   0.5 up to 3 | over 3 up to 6 | over 6 up to 30 | over 30 up to 120 | over 120 up to 400 |
//   over 400 up to 1000 | over 1000 up to 2000 | over 2000 up to 4000
//   f (fine)       ±0.05  ±0.05  ±0.1  ±0.15  ±0.2  ±0.3  ±0.5  -
//   m (medium)     ±0.1   ±0.1   ±0.2  ±0.3   ±0.5  ±0.8  ±1.2  ±2
//   c (coarse)     ±0.2   ±0.3   ±0.5  ±0.8   ±1.2  ±2    ±3    ±4
//   v (very coarse) -     ±0.5   ±1    ±1.5   ±2.5  ±4    ±6    ±8
// Table 2 (broken edges: external radii and chamfer heights):
//   0.5 up to 3 | over 3 up to 6 | over 6
//   f, m  ±0.2  ±0.5  ±1
//   c, v  ±0.4  ±1    ±2
// Below 0.5 mm the standard requires the deviation to be indicated next to the nominal size, and
// "-" cells have no general tolerance: both give no tolerance here.
// Table 3 (angular dimensions) is keyed on the length of the shorter leg of the angle, which the
// drawing does not give for an angular dimension, so ISO 2768 angles are left untoleranced.
// ---------------------------------------------------------------------------------------------
const ISO_TABLE1_UPPER = [3, 6, 30, 120, 400, 1000, 2000, 4000] as const
const ISO_TABLE1: Record<Iso2768Class, readonly (number | null)[]> = {
  f: [0.05, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, null],
  m: [0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2],
  c: [0.2, 0.3, 0.5, 0.8, 1.2, 2, 3, 4],
  v: [null, 0.5, 1, 1.5, 2.5, 4, 6, 8],
}
const ISO_TABLE2_UPPER = [3, 6, null] as const
const ISO_TABLE2: Record<Iso2768Class, readonly number[]> = {
  f: [0.2, 0.5, 1],
  m: [0.2, 0.5, 1],
  c: [0.4, 1, 2],
  v: [0.4, 1, 2],
}
const ISO_MIN_NOMINAL_MM = 0.5

/** ISO 2768-1 deviation for a nominal size in mm, with the range it fell in; null when none applies. */
export function iso2768Deviation(
  cls: Iso2768Class,
  nominalMm: number,
  table: 1 | 2,
): { toleranceMm: number; rangeMm: { over: number; upTo: number | null } } | null {
  const n = Math.abs(nominalMm)
  if (!Number.isFinite(n) || n < ISO_MIN_NOMINAL_MM) return null
  const uppers: readonly (number | null)[] = table === 1 ? ISO_TABLE1_UPPER : ISO_TABLE2_UPPER
  const values = table === 1 ? ISO_TABLE1[cls] : ISO_TABLE2[cls]
  for (let i = 0; i < uppers.length; i++) {
    const upTo = uppers[i]
    if (upTo === null || n <= upTo) {
      const tol = values[i]
      if (tol === null || tol === undefined) return null
      const over = i === 0 ? ISO_MIN_NOMINAL_MM : (uppers[i - 1] as number)
      return { toleranceMm: tol, rangeMm: { over, upTo } }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

/** Upper-case text with SOLIDWORKS note codes resolved and the ± spellings unified. */
export function normalizeNoteText(text: string): string {
  return text
    .replace(/<MOD-PM>/gi, '±')
    .replace(/<MOD-DEG>/gi, '°')
    .replace(/<MOD-DIAM>/gi, 'Ø')
    .replace(/<[^<>]*>/g, ' ')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\+\s*\/\s*-|\+\s*-(?=\s*[\d.,])/g, '±')
    .replace(/\t/g, ' ') // NFKC already turned no-break spaces into spaces
}

const NUM = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`
/**
 * A number must end here: not followed by more digits, a fraction bar, a colon, a letter, or a
 * separator that continues the number (a list comma or full stop after it is fine).
 */
const NUM_END = String.raw`(?![\d/:A-Z]|[.,]\d)`
/**
 * Boundary between two note fragments joined on one spatial line. A value may follow its label
 * across one boundary only as one fragment (`±0.01`); a `±` and a number in different fragments
 * are not one value (a blank value cell next to an unrelated number, such as a revision).
 */
export const FRAGMENT_SEPARATOR = String.fromCharCode(0x1f)
const PM = String.raw`^\s*[:=]?\s*(?:${FRAGMENT_SEPARATOR}\s*)?[:=]?\s*±\s*`

function decimalsOf(token: string): number {
  const sep = token.search(/[.,]/)
  return sep < 0 ? 0 : token.length - sep - 1
}

function toNumber(token: string): number {
  return Number(token.replace(',', '.'))
}

/** A ±length right at the start of `tail`: decimal (`.01`, `0,1`) or fraction (`1/64`). */
function lengthValueAt(tail: string, allowFraction: boolean): ToleranceValue | null {
  const pm = new RegExp(PM).exec(tail)
  if (!pm) return null
  const rest = tail.slice(pm[0].length)
  if (allowFraction) {
    const frac = new RegExp(String.raw`^(\d+)\s*/\s*(\d+)${NUM_END}`).exec(rest)
    if (frac) {
      const den = Number(frac[2])
      if (den === 0) return null
      return { value: Number(frac[1]) / den, places: null, text: `${frac[1]}/${frac[2]}` }
    }
  }
  const dec = new RegExp(String.raw`^${NUM}\s*(?:MM|IN\b|")?${NUM_END}`).exec(rest)
  if (!dec) return null
  const value = toNumber(dec[1])
  if (!Number.isFinite(value) || value <= 0) return null
  return { value, places: decimalsOf(dec[1]), text: dec[1].replace(',', '.') }
}

/** A ±angle right at the start of `tail`, in degrees: `0.5°`, `1°`, `0°30'`, `30'`, `1/2°`, `.5`. */
function angleValueAt(tail: string): ToleranceValue | null {
  const pm = new RegExp(PM).exec(tail)
  if (!pm) return null
  const rest = tail.slice(pm[0].length)
  const minutesOnly = /^(\d+(?:\.\d+)?)\s*['′](?![\d'′])/.exec(rest)
  if (minutesOnly) {
    const value = Number(minutesOnly[1]) / 60
    return value > 0 ? { value, places: null, text: `${minutesOnly[1]}'` } : null
  }
  const frac = /^(\d+)\s*\/\s*(\d+)\s*°/.exec(rest)
  if (frac) {
    const den = Number(frac[2])
    if (den === 0) return null
    return { value: Number(frac[1]) / den, places: null, text: `${frac[1]}/${frac[2]}°` }
  }
  const deg = new RegExp(
    String.raw`^${NUM}\s*(°)?(?:\s*(\d+(?:\.\d+)?)\s*['′])?${NUM_END}`,
  ).exec(rest)
  if (!deg) return null
  const degrees = toNumber(deg[1])
  const minutes = deg[3] ? Number(deg[3]) : 0
  // A bare number with neither ° nor ' is read as degrees only when nothing else follows it.
  const value = degrees + minutes / 60
  if (!Number.isFinite(value) || value <= 0) return null
  const text = `${deg[1].replace(',', '.')}°${deg[3] ? `${deg[3]}'` : ''}`
  return { value, places: deg[3] ? null : decimalsOf(deg[1]), text }
}

const PLACE_WORDS: Record<string, number> = {
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
}

/** Sanity bound on a symmetric linear general tolerance; anything larger is not a tolerance. */
function plausibleLinear(value: number, unit: LengthUnit | null): boolean {
  return value > 0 && value <= (unit === 'in' ? 0.5 : 5)
}

function plausibleAngle(value: number): boolean {
  return value > 0 && value <= 10
}

interface PartialRules {
  unit: LengthUnit | null
  decimal: Map<number, ToleranceValue>
  linear: ToleranceValue | null
  fractional: ToleranceValue | null
  angular: ToleranceValue | null
  angularDecimal: Map<number, ToleranceValue>
  iso2768: GeneralToleranceRules['iso2768']
}

function emptyPartial(): PartialRules {
  return {
    unit: null,
    decimal: new Map(),
    linear: null,
    fractional: null,
    angular: null,
    angularDecimal: new Map(),
    iso2768: null,
  }
}

/** A decimal-place label in a line (`.XX`, `X.`, `TWO PLACE DECIMAL`) and the text after it. */
interface PlaceEntry {
  index: number
  places: number
  tail: string
}

function placeEntries(line: string): PlaceEntry[] {
  const out: PlaceEntry[] = []
  const collect = (re: RegExp, places: (m: RegExpExecArray) => number) => {
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      out.push({ index: m.index, places: places(m), tail: line.slice(m.index + m[0].length) })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  // Worded: `TWO PLACE DECIMAL`, `3 PL DEC`, `ONE PLACE DECIMALS`.
  collect(
    /\b(ZERO|ONE|TWO|THREE|FOUR|[0-4])[\s-]*(?:PLACES?|PL\.?)(?:\s+DECIMALS?|\s+DEC\.?)?/g,
    (m) => PLACE_WORDS[m[1]],
  )
  // Notation: `.XX`, `X.XX`, `0.00`, `.000`, and `X` / `X.` (whole numbers). A label is a rule
  // only where a ± value follows it (`lengthValueAt` / `angleValueAt`).
  collect(/(?<![A-Z0-9.,])(?:[X0]?[.,](X{1,4}|0{1,4})|X[.,]?)(?![A-Z0-9.,])/g, (m) =>
    m[1] ? m[1].length : 0,
  )
  return out.sort((a, b) => a.index - b.index)
}

/** One logical line, with the horizontal position of each of its characters. */
interface Row {
  text: string
  /** Position of character `i`: sheet metres for joined notes, the character column in one note. */
  xAt: (i: number) => number
}

type ColumnKind = 'linear' | 'angular'
interface Column {
  kind: ColumnKind
  x: number
}

const HEADER_FRAGMENT =
  /^[\s:]*(?:(?:LINEAR|LENGTHS?|ANGULAR|ANGLES?|ANG\.)(?:\s+(?:DIMENSIONS?|TOLERANCES?))?[\s:]*)+$/
const HEADER_WORD = /LINEAR|LENGTHS?|ANGULAR|ANGLES?|ANG\./g

/**
 * Column headers of a tolerance table (`LINEAR` | `ANGLE`): a line with no ± in which at least one
 * fragment is made only of header words. Null when the line is not a header.
 */
function columnHeader(row: Row): Column[] | null {
  if (row.text.includes('±')) return null
  const columns: Column[] = []
  let offset = 0
  for (const fragment of row.text.split(FRAGMENT_SEPARATOR)) {
    if (HEADER_FRAGMENT.test(fragment)) {
      HEADER_WORD.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = HEADER_WORD.exec(fragment)) !== null) {
        columns.push({ kind: m[0].startsWith('L') ? 'linear' : 'angular', x: row.xAt(offset + m.index) })
      }
    }
    offset += fragment.length + FRAGMENT_SEPARATOR.length
  }
  return columns.length > 0 ? columns.sort((a, b) => a.x - b.x) : null
}

/**
 * The column of each entry: the header nearest its position. When that puts two entries under one
 * header while the row has exactly one entry per column, the row is read left to right instead.
 */
function assignColumns(entries: readonly PlaceEntry[], row: Row, columns: readonly Column[]): ColumnKind[] {
  const nearest = entries.map((e) => {
    const x = row.xAt(e.index)
    let best = 0
    columns.forEach((c, i) => {
      if (Math.abs(c.x - x) < Math.abs(columns[best].x - x)) best = i
    })
    return best
  })
  if (new Set(nearest).size !== nearest.length && entries.length === columns.length) {
    return columns.map((c) => c.kind)
  }
  return nearest.map((i) => columns[i].kind)
}

function addDecimal(acc: PartialRules, places: number, tail: string): void {
  if (acc.decimal.has(places)) return
  const value = lengthValueAt(tail, false)
  if (value && plausibleLinear(value.value, acc.unit)) acc.decimal.set(places, value)
}

function addAngularDecimal(acc: PartialRules, places: number, tail: string): void {
  if (acc.angularDecimal.has(places)) return
  const value = angleValueAt(tail)
  if (value && plausibleAngle(value.value)) acc.angularDecimal.set(places, value)
}

/** Lines between a column header and its first row before the header no longer applies. */
const HEADER_GAP_LINES = 1

/**
 * Rules in lines read top to bottom. After a column header, each decimal-place entry goes to the
 * column it sits under, until a line with no entry follows the table's rows.
 */
function parseRows(rows: readonly Row[], acc: PartialRules): void {
  let columns: Column[] | null = null
  let rowsSeen = 0
  let gap = 0
  for (const row of rows) {
    const header = columnHeader(row)
    if (header) {
      columns = header
      rowsSeen = 0
      gap = 0
      continue
    }
    const entries = columns ? placeEntries(row.text) : []
    if (!columns || entries.length === 0) {
      if (columns && (rowsSeen > 0 || ++gap > HEADER_GAP_LINES)) columns = null
      parseLine(row.text, acc)
      continue
    }
    rowsSeen++
    const kinds = assignColumns(entries, row, columns)
    entries.forEach((e, i) => {
      if (kinds[i] === 'angular') addAngularDecimal(acc, e.places, e.tail)
      else addDecimal(acc, e.places, e.tail)
    })
    parseLine(row.text, acc, false)
  }
}

/**
 * Rules found in one logical line, added where `acc` has none yet. `places` false leaves the
 * decimal-place entries to the caller (a table row).
 */
function parseLine(line: string, acc: PartialRules, places = true): void {
  const unit = /\b(?:DIMENSIONS?|UNITS?)\s*(?:ARE\s+)?(?:IN|:)\s*(INCH(?:ES)?|IN\b|MILLIMET(?:ER|RE)S?|MM\b)/.exec(line)
  if (unit && acc.unit === null) acc.unit = unit[1].startsWith('M') ? 'mm' : 'in'

  const iso = /\bISO\s*2768(?:\s*-\s*1)?\s*[-–]?\s*(?:CLASS\s*)?([FMCV])\s*([HKL])?(?![A-Z0-9])/.exec(line)
  if (iso && acc.iso2768 === null) {
    acc.iso2768 = {
      linear: iso[1].toLowerCase() as Iso2768Class,
      geometric: (iso[2] as Iso2768GeometricClass | undefined) ?? null,
    }
  }

  const each = (re: RegExp, fn: (m: RegExpExecArray, tail: string) => void) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      fn(m, line.slice(m.index + m[0].length))
      if (m[0].length === 0) re.lastIndex++
    }
  }

  if (places) for (const e of placeEntries(line)) addDecimal(acc, e.places, e.tail)

  if (acc.fractional === null) {
    each(/\bFRACTIONS?(?:AL)?S?\b/g, (_m, tail) => {
      if (acc.fractional) return
      const value = lengthValueAt(tail, true)
      if (value && plausibleLinear(value.value, 'in')) acc.fractional = value
    })
  }

  if (acc.angular === null) {
    each(/\b(?:ANGULAR|ANGLES?|ANG\.)\s*(?::\s*)?(?:MACH(?:INED|\.)?\s*)?/g, (_m, tail) => {
      if (acc.angular) return
      const value = angleValueAt(tail)
      if (value && plausibleAngle(value.value)) acc.angular = value
    })
  }

  if (acc.linear === null) {
    each(/\b(?:LINEAR|TOLERANCES?)\b/g, (_m, tail) => {
      if (acc.linear) return
      const value = lengthValueAt(tail, false)
      if (value && plausibleLinear(value.value, acc.unit)) acc.linear = value
    })
  }
}

/** Default character height when a note does not report one (3.5 mm, ISO 3098 / ASME Y14.2). */
const DEFAULT_TEXT_HEIGHT_M = 0.0035
/** Line pitch of a multi-line note as a multiple of its character height. */
const LINE_PITCH = 1.6
/** Character width as a fraction of its height, to estimate where a fragment's text ends. */
const CHAR_WIDTH_RATIO = 0.6
/** Fragments closer than this many character heights read as one piece of text. */
const JOIN_GAP_HEIGHTS = 1

interface PlacedLine {
  text: string
  x: number
  y: number
  height: number
}

/**
 * Lines of separate notes joined by position: every note line is placed (lines of a multi-line
 * note step down by `LINE_PITCH` × height), lines whose y agree within half a character height
 * form one logical line, read left to right. Fragments that touch (gap under one character
 * height after the estimated end of the text) are joined with a space, others with
 * `FRAGMENT_SEPARATOR`, which a value cannot be read across.
 */
export function spatialLines(notes: readonly ExtractedSheetNote[]): string[] {
  return spatialRows(notes).map((r) => r.text)
}

/** `spatialLines`, keeping where each character sits on the sheet (for table columns). */
function spatialRows(notes: readonly ExtractedSheetNote[]): Row[] {
  const placed: PlacedLine[] = []
  for (const note of notes) {
    const height = note.height && note.height > 0 ? note.height : DEFAULT_TEXT_HEIGHT_M
    note.text.split(/\r?\n|\r/).forEach((text, i) => {
      if (text.trim() === '') return
      placed.push({ text, x: note.x, y: note.y - i * height * LINE_PITCH, height })
    })
  }
  placed.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Row[] = []
  let group: PlacedLine[] = []
  const flush = () => {
    group.sort((a, b) => a.x - b.x)
    let text = ''
    const segments: { start: number; x: number; charWidth: number }[] = []
    group.forEach((l, i) => {
      if (i > 0) {
        const prev = group[i - 1]
        const prevEnd = prev.x + prev.text.length * prev.height * CHAR_WIDTH_RATIO
        const touching = l.x - prevEnd <= JOIN_GAP_HEIGHTS * Math.max(prev.height, l.height)
        text += touching ? ' ' : ` ${FRAGMENT_SEPARATOR} `
      }
      segments.push({ start: text.length, x: l.x, charWidth: l.height * CHAR_WIDTH_RATIO })
      text += l.text
    })
    if (group.length > 0) {
      lines.push({
        text,
        xAt: (i) => {
          let s = segments[0]
          for (const seg of segments) if (seg.start <= i) s = seg
          return s.x + (i - s.start) * s.charWidth
        },
      })
    }
    group = []
  }
  for (const line of placed) {
    const top = group[0]
    if (top && top.y - line.y > Math.max(top.height, line.height) / 2) flush()
    group.push(line)
  }
  flush()
  return lines
}

/**
 * The general tolerance rules a sheet's notes state, or null when they state none. Each note is
 * read on its own first; rules still missing are then read from note lines joined by position
 * (a label note and a value note side by side).
 */
export function parseGeneralTolerances(
  notes: readonly ExtractedSheetNote[] | null | undefined,
): GeneralToleranceRules | null {
  if (!notes || notes.length === 0) return null
  const acc = emptyPartial()
  for (const note of notes) {
    const lines = normalizeNoteText(note.text).split(/\r?\n|\r/)
    parseRows(
      lines.map((text) => ({ text, xAt: (i: number) => i })),
      acc,
    )
  }
  const normalized = notes.map((n) => ({ ...n, text: normalizeNoteText(n.text) }))
  parseRows(spatialRows(normalized), acc)

  const sorted = (m: Map<number, ToleranceValue>): DecimalPlaceRule[] =>
    [...m.entries()].sort(([a], [b]) => a - b).map(([places, tolerance]) => ({ places, tolerance }))
  const decimal = sorted(acc.decimal)
  const angularDecimal = sorted(acc.angularDecimal)
  if (
    decimal.length === 0 &&
    angularDecimal.length === 0 &&
    !acc.linear &&
    !acc.fractional &&
    !acc.angular &&
    !acc.iso2768
  ) {
    return null
  }
  return {
    unit: acc.unit,
    decimal,
    linear: acc.linear,
    fractional: acc.fractional,
    angular: acc.angular,
    angularDecimal,
    iso2768: acc.iso2768,
  }
}

/**
 * Drawing-level rules for each sheet: a sheet's own block, else the first sheet's that has one.
 * General tolerances apply to the whole drawing; continuation sheets often carry a reduced title
 * block without them (ASME Y14.1 / ISO 7200).
 */
export function generalTolerancesBySheet(
  data: Pick<ExtractedDrawingCharacteristics, 'sheets'>,
): Map<string, GeneralToleranceRules | null> {
  const own = new Map<string, GeneralToleranceRules | null>()
  for (const sheet of data.sheets) own.set(sheet.name, parseGeneralTolerances(sheet.notes))
  const drawingLevel = [...own.values()].find((r) => r !== null) ?? null
  const out = new Map<string, GeneralToleranceRules | null>()
  for (const [name, rules] of own) out.set(name, rules ?? drawingLevel)
  return out
}

// ---------------------------------------------------------------------------------------------
// Applying the rules
// ---------------------------------------------------------------------------------------------

interface ParsedNominal {
  value: number
  /** Decimals as written; null for a fraction. */
  places: number | null
  /** Written without a leading zero (`.500`). */
  bareDecimal: boolean
  angle: boolean
}

/**
 * The number in a nominal the general tolerance can apply to: an optional count (`4X`), an
 * optional Ø / R / SØ / SR prefix, one decimal or fraction, an optional unit. Anything else
 * (threads, callout text, degrees-minutes) is not a plain value.
 */
export function parseNominal(nominal: string): ParsedNominal | null {
  const text = normalizeNoteText(nominal).trim()
  const m = new RegExp(
    String.raw`^(?:\d+\s*[X×]\s*)?(?:S?[Ø⌀∅]|S?R)?\s*(?:(\d+)\s+(\d+)\s*/\s*(\d+)|(\d+)\s*/\s*(\d+)|${NUM})\s*(MM|IN|"|°)?$`,
  ).exec(text)
  if (!m) return null
  const angle = m[7] === '°'
  if (m[1] !== undefined) {
    const den = Number(m[3])
    if (den === 0) return null
    return { value: Number(m[1]) + Number(m[2]) / den, places: null, bareDecimal: false, angle }
  }
  if (m[4] !== undefined) {
    const den = Number(m[5])
    if (den === 0) return null
    return { value: Number(m[4]) / den, places: null, bareDecimal: false, angle }
  }
  const token = m[6]
  const value = toNumber(token)
  if (!Number.isFinite(value)) return null
  return { value, places: decimalsOf(token), bareDecimal: /^[.,]/.test(token), angle }
}

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ''

/**
 * Tolerance types under which the title block governs: SOLIDWORKS `Block` (the document's block
 * tolerance), `General` and `Unknown`. Values the service reports for them are not stated on the
 * annotation.
 */
export function isBlockToleranceType(toleranceType: string | null | undefined): boolean {
  const type = toleranceType?.trim().toLowerCase() ?? ''
  return type === 'block' || type === 'general' || type === 'unknown'
}

/** No tolerance of its own: type None / unset with no values, or a block-governed type. */
export function isUntoleranced(c: ExtractedCharacteristic): boolean {
  if (isBlockToleranceType(c.toleranceType)) return true
  const type = c.toleranceType?.trim().toLowerCase() ?? ''
  if (type !== '' && type !== 'none') return false
  return blank(c.plusTolerance) && blank(c.minusTolerance) && blank(c.upperLimit) && blank(c.lowerLimit)
}

function isAngular(c: ExtractedCharacteristic, nominal: ParsedNominal): boolean {
  return nominal.angle || c.unit === '°' || c.subType?.toLowerCase() === 'angular'
}

/** ISO 2768-1 Table 2 covers external radii and chamfer heights. */
function isBrokenEdge(c: ExtractedCharacteristic): boolean {
  const sub = c.subType?.toLowerCase() ?? ''
  return sub === 'radius' || sub === 'chamfer'
}

function format(value: number, places: number, bare: boolean): string {
  const text = value.toFixed(places)
  return bare ? text.replace(/^(-?)0\./, '$1.') : text
}

const FRACTION_PLACES = 4

function build(
  nominal: ParsedNominal,
  tolerance: number,
  tolerancePlaces: number | null,
  basis: GeneralToleranceBasis,
  suffix = '',
): GeneralTolerance {
  const places = Math.max(nominal.places ?? FRACTION_PLACES, tolerancePlaces ?? FRACTION_PLACES)
  const bare = nominal.bareDecimal
  return {
    plus: `+${format(tolerance, places, bare)}${suffix}`,
    minus: `-${format(tolerance, places, bare)}${suffix}`,
    upper: `${format(nominal.value + tolerance, places, bare)}${suffix}`,
    lower: `${format(nominal.value - tolerance, places, bare)}${suffix}`,
    basis,
  }
}

/**
 * The general tolerance of a characteristic that has none of its own (tolerance type None or
 * unset, a plain numeric nominal, not basic, not reference, a dimension or hole callout value).
 * Null when it does not qualify or no rule covers it.
 *
 * Order: a fraction takes the fractional rule; a decimal takes the rule for its number of decimal
 * places, then the all-values rule, then ISO 2768-1. Decimal and all-values rules apply only when
 * the block states no unit or the value's own unit. Angles take the angle rule for their number of
 * decimal places, then the one angular rule.
 */
export function generalToleranceFor(
  c: ExtractedCharacteristic,
  rules: GeneralToleranceRules | null,
  units: ExtractedDrawingCharacteristics['units'],
): GeneralTolerance | null {
  if (!rules) return null
  if (c.kind !== 'dimension' && c.kind !== 'holeCallout') return null
  if (c.isReference || !isUntoleranced(c)) return null
  const nominal = parseNominal(c.nominal)
  if (!nominal || nominal.value <= 0) return null

  if (isAngular(c, nominal)) {
    const byPlaces = rules.angularDecimal.find((r) => r.places === nominal.places)
    const tolerance = byPlaces?.tolerance ?? rules.angular
    if (!tolerance) return null
    const suffix = /°/.test(c.nominal) ? '°' : ''
    const places = Math.max(nominal.places ?? 0, tolerance.places ?? 2)
    const value = tolerance.value
    return {
      plus: `+${value.toFixed(places)}${suffix}`,
      minus: `-${value.toFixed(places)}${suffix}`,
      upper: `${(nominal.value + value).toFixed(places)}${suffix}`,
      lower: `${(nominal.value - value).toFixed(places)}${suffix}`,
      basis: byPlaces
        ? { kind: 'angular', tolerance: tolerance.text, places: byPlaces.places }
        : { kind: 'angular', tolerance: tolerance.text },
    }
  }

  const unit: LengthUnit | null =
    c.unit === 'mm' || c.unit === 'in' ? c.unit : units === 'mm' || units === 'in' ? units : null

  if (nominal.places === null) {
    if (!rules.fractional || unit === 'mm') return null
    return build(nominal, rules.fractional.value, rules.fractional.places, {
      kind: 'fractional',
      tolerance: rules.fractional.text,
    })
  }

  const unitMatches = rules.unit === null || unit === null || rules.unit === unit
  if (unitMatches) {
    const rule = rules.decimal.find((r) => r.places === nominal.places)
    if (rule) {
      return build(nominal, rule.tolerance.value, rule.tolerance.places, {
        kind: 'decimal',
        places: rule.places,
        tolerance: rule.tolerance.text,
      })
    }
    if (rules.linear) {
      return build(nominal, rules.linear.value, rules.linear.places, {
        kind: 'linear',
        tolerance: rules.linear.text,
      })
    }
  }

  if (rules.iso2768 && unit) {
    const toMm = unit === 'in' ? 25.4 : 1
    const table = isBrokenEdge(c) ? 2 : 1
    const deviation = iso2768Deviation(rules.iso2768.linear, nominal.value * toMm, table)
    if (!deviation) return null
    const tolerance = deviation.toleranceMm / toMm
    const tolPlaces = unit === 'in' ? 4 : decimalsOf(String(deviation.toleranceMm))
    return build(nominal, tolerance, tolPlaces, {
      kind: 'iso2768',
      cls: rules.iso2768.linear,
      table,
      rangeMm: deviation.rangeMm,
      toleranceMm: deviation.toleranceMm,
    })
  }
  return null
}
