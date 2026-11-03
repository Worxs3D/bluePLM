/**
 * Fill an inspection report template: scalars, one row per characteristic, the logo, the drawing
 * pages under the table (or at `{{DRAWING}}`), the `_blueplm` identity sheet, and sheet protection
 * with only the recipient's cells unlocked.
 */
import type { Cell, CellValue, Workbook, Worksheet } from 'exceljs'

import { analyzeWorkbook, type LayoutIssue, type ScannedSheet, type TemplateLayout, type TemplateRowCell } from './analyze'
import { fieldText, fieldValue, type InspectionReportRow } from './format'
import { cellsFingerprint, sha256Hex, specFingerprint, SPEC_FIELDS } from './fingerprint'
import { shiftSheetReferences } from './formulaShift'
import { fitRowHeight, placeDrawingPages, placeLogo, type DrawingPageImage, type ReportLogo } from './place'
import { DEFAULT_FIELD_CAPTIONS, parseTokens, type ParsedToken, type RowField, type ScalarName } from './tokens'
import { address, decodeAddress, decodeRange, encodeRange, mergeRanges, META_SHEET, readWorkbook, writeWorkbook, type Box } from './workbook'

export type { DrawingPageImage, ReportLogo } from './place'

export interface InspectionReportInput {
  /** The template .xlsx. */
  template: Uint8Array | ArrayBuffer
  /** SHA-256 hex of the template (its storage hash); computed when omitted. */
  templateHash?: string
  reportId: string
  fileId: string
  fileVersionId: string
  /** Characteristics in report order. */
  rows: readonly InspectionReportRow[]
  /** Scalar token values. `PART_NAME` defaults to DESCRIPTION, then DRAWING_NAME; `DATE` to today. */
  scalars?: Partial<Record<ScalarName, string>>
  /** Custom property values for `{{PROP:<name>}}` (names match case-insensitively). */
  properties?: Readonly<Record<string, string>>
  /** Drawing page images (`rasterizePdf`). None: no drawing is embedded. */
  drawingPages?: readonly DrawingPageImage[]
  /** Organization logo for `{{LOGO}}` cells. None: those cells are left empty. */
  logo?: ReportLogo | null
  /**
   * Caption above each drawing page (`index` 0-based). Default English:
   * "Drawing sheet 1 of 3: <DRAWING_NAME>". Workbook content, like the built-in captions.
   */
  drawingCaption?: (index: number, total: number, drawingName: string) => string
  /** Text of the single merged row of a report with no characteristics (default "No characteristics"). */
  noRowsText?: string
  /** Captions for legacy `{{INSPECTION_TABLE}}` header cells (default English). */
  columnLabels?: Partial<Record<RowField, string>>
  generatedAt?: Date
}

/** Thrown when the template has layout errors (`analyzeTemplate(...).errors`). */
export class InspectionTemplateError extends Error {
  constructor(readonly errors: LayoutIssue[]) {
    super(`Inspection template has errors: ${errors.map((e) => e.code).join(', ')}`)
    this.name = 'InspectionTemplateError'
  }
}

/** Format tag in `_blueplm!B1`. */
export const META_FORMAT = 'blueplm-inspection-report/1'
/** First data row of the per-row table in `_blueplm`. */
export const META_ROWS_START = 11
export const META_ROW_COLUMNS = ['row_index', 'sheet_row', 'row_id', 'source_key', 'balloon', 'spec_fingerprint', 'cells_fingerprint', 'spec'] as const

/** What `_blueplm!B7` records so a returned workbook can be read without the template. */
export interface MetaLayout {
  sheet: string
  firstRow: number
  count: number
  cells: TemplateRowCell[]
  entries: TemplateLayout['entries']
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function unlock(cell: Cell, textFormat: boolean): void {
  const style = clone(cell.style) ?? {}
  style.protection = { locked: false }
  if (textFormat) style.numFmt = '@'
  cell.style = style
}

interface FillContext {
  scalars: Partial<Record<ScalarName, string>>
  properties: Map<string, string>
  captions: Record<RowField, string>
}

function tokenReplacement(t: ParsedToken, ctx: FillContext, legacyHeader: boolean): string {
  switch (t.kind) {
    case 'scalar':
      return ctx.scalars[t.name] ?? ''
    case 'prop':
      return ctx.properties.get(t.name.toLowerCase()) ?? ''
    case 'col':
      return legacyHeader ? ctx.captions[t.field] : ''
    case 'unknownCol':
      return legacyHeader ? t.field : ''
    default:
      return ''
  }
}

function replaceIn(text: string, ctx: FillContext, legacyHeader: boolean): string {
  let out = text
  for (const t of parseTokens(text)) out = out.split(t.raw).join(tokenReplacement(t, ctx, legacyHeader))
  return out
}

const HEADER_FOOTER_KEYS = ['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter'] as const

/** Scalar tokens in print headers and footers (`&` in a value is escaped as `&&`). */
function fillHeaderFooter(ws: Worksheet, ctx: FillContext): void {
  const hf = ws.headerFooter as unknown as Partial<Record<(typeof HEADER_FOOTER_KEYS)[number], string>> | undefined
  if (!hf) return
  for (const key of HEADER_FOOTER_KEYS) {
    const text = hf[key]
    if (typeof text !== 'string' || !text.includes('{{')) continue
    let out = text
    for (const t of parseTokens(text)) out = out.split(t.raw).join(tokenReplacement(t, ctx, false).replace(/&/g, '&&'))
    hf[key] = out
  }
}

/** Replace header tokens in a cell, keeping rich text runs when each token sits inside one run. */
function fillHeaderCell(cell: Cell, ctx: FillContext, legacyHeader: boolean): void {
  const value = cell.value
  if (value && typeof value === 'object' && 'richText' in value) {
    const runs = value.richText.map((r) => ({ ...r, text: replaceIn(r.text, ctx, legacyHeader) }))
    const joined = runs.map((r) => r.text).join('')
    if (parseTokens(joined).length === 0) {
      cell.value = joined.trim() === '' ? null : { richText: runs }
      return
    }
  }
  const text = typeof value === 'string' ? value : value && typeof value === 'object' && 'richText' in value ? value.richText.map((r) => r.text).join('') : null
  if (text === null) return // formula or other: tokens inside formulas are not touched
  const replaced = replaceIn(text, ctx, legacyHeader)
  cell.value = replaced.trim() === '' && replaced !== text ? null : replaced
}

function defaultScalars(input: InspectionReportInput): Partial<Record<ScalarName, string>> {
  const s = { ...input.scalars }
  const date = input.generatedAt ?? new Date()
  if (s.DATE === undefined) s.DATE = date.toISOString().slice(0, 10)
  if (s.PART_NAME === undefined) s.PART_NAME = s.DESCRIPTION || s.DRAWING_NAME || ''
  return s
}

/** Insert `extra` copies of row `t` below it, keeping styles, heights and merges; content below shifts. */
function expandRowTemplate(ws: Worksheet, t: number, extra: number): void {
  if (extra <= 0) return
  const merges = mergeRanges(ws).map(decodeRange)
  for (const m of merges) ws.unMergeCells(encodeRange(m))

  for (const image of ws.getImages()) {
    const range = image.range as unknown as { tl: { nativeRow: number }; br?: { nativeRow: number } }
    if (range.tl.nativeRow >= t) {
      range.tl.nativeRow += extra
      if (range.br) range.br.nativeRow += extra
    }
  }

  ws.spliceRows(t + 1, 0, ...Array.from({ length: extra }, () => []))
  shiftSheetReferences(ws, t, extra)

  const src = ws.getRow(t)
  for (let i = 1; i <= extra; i++) {
    const dst = ws.getRow(t + i)
    if (src.height !== undefined) dst.height = src.height
    src.eachCell({ includeEmpty: true }, (cell, col) => {
      const d = dst.getCell(col)
      d.style = clone(cell.style)
      d.value = clone(cell.value) as CellValue
    })
  }

  for (const m of merges) {
    const box: Box = { ...m }
    if (m.top > t) {
      box.top += extra
      box.bottom += extra
    } else if (m.bottom >= t && m.top < t) {
      box.bottom += extra
    }
    ws.mergeCellsWithoutStyle(encodeRange(box))
    if (m.top === t && m.bottom === t) {
      for (let i = 1; i <= extra; i++) ws.mergeCellsWithoutStyle(encodeRange({ ...m, top: t + i, bottom: t + i }))
    }
  }

  const printArea = ws.pageSetup.printArea
  if (printArea && !printArea.includes('&&') && /^\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+$/i.test(printArea)) {
    const box = decodeRange(printArea.replace(/\$/g, ''))
    if (box.bottom >= t) ws.pageSetup.printArea = encodeRange({ ...box, bottom: box.bottom + extra })
  }
}

function writeFieldCell(cell: Cell, pattern: string, row: InspectionReportRow): string {
  const tokens = parseTokens(pattern)
  if (tokens.length === 1 && tokens[0].kind === 'col' && pattern.trim() === tokens[0].raw) {
    const v = fieldValue(row, tokens[0].field)
    cell.value = v === '' ? null : v
    return v === null ? '' : String(v)
  }
  let out = pattern
  for (const t of tokens) out = out.split(t.raw).join(t.kind === 'col' ? fieldText(row, t.field) : '')
  cell.value = out === '' ? null : out
  return out
}

interface WrittenRow {
  sheetRow: number
  row: InspectionReportRow
  cellsFingerprint: string
}

function writeMetaSheet(
  workbook: Workbook,
  input: InspectionReportInput,
  templateHash: string,
  meta: MetaLayout,
  written: WrittenRow[],
): Worksheet {
  const ws = workbook.addWorksheet(META_SHEET, { state: 'veryHidden' })
  const pairs: [string, string][] = [
    ['format', META_FORMAT],
    ['report_id', input.reportId],
    ['file_id', input.fileId],
    ['file_version_id', input.fileVersionId],
    ['template_hash', templateHash],
    ['generated_at', (input.generatedAt ?? new Date()).toISOString()],
    ['layout', JSON.stringify(meta)],
  ]
  pairs.forEach(([k, v], i) => {
    ws.getCell(i + 1, 1).value = k
    ws.getCell(i + 1, 2).value = v
  })
  META_ROW_COLUMNS.forEach((h, i) => (ws.getCell(META_ROWS_START - 1, i + 1).value = h))
  written.forEach((w, i) => {
    const r = META_ROWS_START + i
    const spec = SPEC_FIELDS.map((f) => fieldText(w.row, f))
    const values = [String(i + 1), String(w.sheetRow), w.row.id, w.row.source_key ?? '', w.row.balloon_number ?? '', specFingerprint(w.row), w.cellsFingerprint, JSON.stringify(spec)]
    values.forEach((v, c) => (ws.getCell(r, c + 1).value = v))
  })
  return ws
}

/** A report with no characteristics: the row template becomes one merged, locked row saying so. */
function writeNoRows(ws: Worksheet, rt: NonNullable<TemplateLayout['rowTemplate']>, text: string): void {
  let left = Math.min(...rt.cells.map((c) => c.col))
  let right = Math.max(...rt.cells.map((c) => c.col))
  for (const range of mergeRanges(ws)) {
    const box = decodeRange(range)
    if (box.top === rt.row && box.bottom === rt.row) {
      left = Math.min(left, box.left)
      right = Math.max(right, box.right)
      ws.unMergeCells(range)
    }
  }
  for (let c = left; c <= right; c++) ws.getCell(rt.row, c).value = null
  if (right > left) ws.mergeCells(rt.row, left, rt.row, right)
  const cell = ws.getCell(rt.row, left)
  cell.value = text
  cell.font = { ...cell.font, italic: true, bold: false }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

/** Texts of a row's locked (field) cells as they read in the sheet, in column order. */
export function lockedCellTexts(read: (col: number) => string, cells: readonly TemplateRowCell[]): string[] {
  return cells.filter((c) => c.kind === 'field').map((c) => read(c.col))
}

/** Generate a filled report workbook (.xlsx bytes). Throws `InspectionTemplateError` on a broken template. */
export async function generateInspectionReport(input: InspectionReportInput): Promise<Uint8Array> {
  const templateBytes = input.template instanceof ArrayBuffer ? new Uint8Array(input.template) : input.template
  const templateHash = input.templateHash ?? (await sha256Hex(templateBytes))
  const workbook = await readWorkbook(templateBytes)
  const existingMeta = workbook.getWorksheet(META_SHEET)
  if (existingMeta) workbook.removeWorksheet(existingMeta.id)

  const { layout, scanned } = analyzeWorkbook(workbook)
  if (layout.errors.length > 0 || !layout.rowTemplate) throw new InspectionTemplateError(layout.errors)
  const rt = layout.rowTemplate

  const ctx: FillContext = {
    scalars: defaultScalars(input),
    properties: new Map(Object.entries(input.properties ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    captions: { ...DEFAULT_FIELD_CAPTIONS, ...input.columnLabels },
  }

  // 1. Header tokens everywhere except the row template's own cells.
  const rowCellCols = new Set(rt.cells.map((c) => c.col))
  const entryCells = new Set(layout.entries.map((e) => `${e.sheet}!${e.cell}`))
  for (const [sheetName, sheet] of scanned as Map<string, ScannedSheet>) {
    for (const c of sheet.cells) {
      if (sheetName === rt.sheet && c.row === rt.row && rowCellCols.has(c.col)) continue
      const cell = sheet.ws.getCell(c.row, c.col)
      if (entryCells.has(`${sheetName}!${c.cell}`)) {
        cell.value = null
        unlock(cell, true)
        continue
      }
      fillHeaderCell(cell, ctx, sheetName === rt.sheet && c.row === rt.legacyHeaderRow)
    }
  }

  // 2. Repeat the row template and fill it.
  const ws = scanned.get(rt.sheet)?.ws
  if (!ws) throw new InspectionTemplateError([{ code: 'NO_ROW_TEMPLATE' }])
  const patterns = new Map<number, string>()
  for (const c of scanned.get(rt.sheet)?.cells ?? []) if (c.row === rt.row) patterns.set(c.col, c.text)

  const count = input.rows.length
  expandRowTemplate(ws, rt.row, count - 1)

  const written: WrittenRow[] = []
  if (count === 0) writeNoRows(ws, rt, input.noRowsText ?? 'No characteristics')
  for (let i = 0; i < count; i++) {
    const r = rt.row + i
    const row = input.rows[i]
    const texts: string[] = []
    for (const c of rt.cells) {
      const cell = ws.getCell(r, c.col)
      if (c.kind === 'field') {
        const pattern =
          rt.legacyHeaderRow !== null || !patterns.has(c.col) ? c.fields.map((f) => `{{COL:${f}}}`).join(' ') : (patterns.get(c.col) ?? '')
        texts.push(writeFieldCell(cell, pattern, row))
      } else {
        cell.value = null
        unlock(cell, c.kind !== 'verdict')
        if (c.kind === 'verdict') {
          cell.dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: ['"PASS,FAIL"'] }
        }
      }
    }
    fitRowHeight(ws, r)
    written.push({ sheetRow: r, row, cellsFingerprint: cellsFingerprint(texts) })
  }

  if (rt.printTitleRows && !ws.pageSetup.printTitlesRow) ws.pageSetup.printTitlesRow = rt.printTitleRows

  // 3. Print headers and footers, logo, drawing pages.
  for (const sheet of workbook.worksheets) fillHeaderFooter(sheet, ctx)
  // Cells below the row template moved down by the inserted rows.
  const shifted = <T extends { sheet: string; cell: string }>(at: T): T => {
    const { row, col } = decodeAddress(at.cell)
    return at.sheet === rt.sheet && row > rt.row && count > 1 ? { ...at, cell: address(row + count - 1, col) } : at
  }
  placeLogo(workbook, (layout.logoAnchors ?? []).map(shifted), input.logo)
  const drawingName = ctx.scalars.DRAWING_NAME ?? ''
  const caption = input.drawingCaption ?? ((i: number, n: number, name: string) => `Drawing sheet ${i + 1} of ${n}${name ? `: ${name}` : ''}`)
  placeDrawingPages(workbook, {
    anchor: layout.drawingAnchor ? shifted(layout.drawingAnchor) : null,
    tableSheet: rt.sheet,
    pages: input.drawingPages ?? [],
    caption: (i, n) => caption(i, n, drawingName),
  })
  // Summary formulas lost their cached results when their ranges grew.
  workbook.calcProperties = { ...workbook.calcProperties, fullCalcOnLoad: true }

  // 4. Identity sheet.
  const meta: MetaLayout = { sheet: rt.sheet, firstRow: rt.row, count, cells: rt.cells, entries: layout.entries.map(shifted) }
  writeMetaSheet(workbook, input, templateHash, meta, written)

  // 5. Protect every sheet; only unlocked cells (results, verdicts, inputs, entries) are editable.
  for (const sheet of workbook.worksheets) {
    await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true })
  }

  return writeWorkbook(workbook)
}
