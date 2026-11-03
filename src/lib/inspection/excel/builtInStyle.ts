/**
 * The design every built-in template shares (5.5.0's professional style): a title band with the
 * logo and the report identity, label / value blocks, a summary strip counted by formula, the
 * characteristic table (dark header, banded rows, PASS / FAIL colours), a sign-off block, and print
 * setup (landscape, one page wide, header row repeated, footer with report number and page x of y).
 *
 * Two kinds of sheet: a report sheet (`addReportSheet`, the characteristic table the engine fills
 * one row per characteristic) and a form sheet (`addFormSheet`, header fields and entry tables
 * only, such as AS9102 Forms 1 and 2). Captions are workbook content, in English (see builtIn.ts).
 */
import type { Alignment, Borders, ConditionalFormattingOptions, Fill, Font, Style, Workbook, Worksheet } from 'exceljs'

import { fitRowHeight } from './place'
import { address, columnLetter } from './workbook'

export const NAVY = 'FF1F3864'
export const INPUT_HEAD = 'FF2F5496'
const GRID = 'FFBFBFBF'
export const LABEL_FILL = 'FFF2F2F2'
export const TEXT_DARK = 'FF404040'

const grid = { style: 'thin' as const, color: { argb: GRID } }
export const BOX: Partial<Borders> = { top: grid, left: grid, bottom: grid, right: grid }
export const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
export const font = (over: Partial<Font> = {}): Partial<Font> => ({ name: 'Calibri', size: 10, ...over })

/** Formula-free conditional format styles (Excel's own good / bad / neutral colours). */
const GOOD = { font: { color: { argb: 'FF006100' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } } }
const BAD = { font: { color: { argb: 'FF9C0006' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } }
const NEUTRAL = { font: { color: { argb: 'FF9C5700' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFEB9C' } } }
/** Sample cells a characteristic does not need (beyond its part count). */
export const UNUSED = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFE7E9ED' } } }
const BAND = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF5F7FA' } } }

/** Add a conditional format (rule objects are plain data; exceljs' rule types are stricter than its writer). */
export function conditional(ws: Worksheet, ref: string, rules: Record<string, unknown>[]): void {
  ws.addConditionalFormatting({ ref, rules } as unknown as ConditionalFormattingOptions)
}

export interface Column {
  caption: string
  token: string
  width: number
  /** Completed by the inspector (lighter header). */
  input?: boolean
  align?: Alignment['horizontal']
}

/** `[label, token, input?]`; label '' leaves the pair empty. */
export type Pair = [string, string, boolean?]

export interface ReportSpec {
  sheet: string
  title: string
  subtitle: string
  columns: Column[]
  /** Last column of the left half of two-pair rows (label takes 2 columns, value the rest). */
  mid: number
  /** Report identity at the top right of the title band. */
  bandItems: Pair[]
  pairs: Pair[]
  signOff: Pair[]
  note: string
  /** Caption of the first summary value (default "Characteristics"; "Measurements" when rows are samples). */
  countCaption?: string
  /** Leave out the general tolerances row. */
  noGeneralTolerances?: boolean
}

/** Write a value across `left..right` of `row` (merged when wider than one column). */
export function put(ws: Worksheet, row: number, left: number, right: number, value: string, style: Partial<Style>): void {
  if (right > left) ws.mergeCells(row, left, row, right)
  for (let c = left; c <= right; c++) {
    const cell = ws.getCell(row, c)
    if (style.border) cell.border = style.border
    if (style.fill) cell.fill = style.fill
  }
  const cell = ws.getCell(row, left)
  cell.value = value === '' ? null : value
  cell.style = { ...cell.style, ...style }
}

export const LABEL: Partial<Style> = {
  font: font({ bold: true, size: 9, color: { argb: TEXT_DARK } }),
  fill: solid(LABEL_FILL),
  border: BOX,
  alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
}
export const VALUE: Partial<Style> = { font: font(), border: BOX, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 } }
export const INPUT_VALUE: Partial<Style> = { ...VALUE, fill: solid('FFFFFDF0') }
const HEADING: Partial<Font> = font({ bold: true, size: 11, color: { argb: NAVY } })

/** Label / value pairs, two per row (left half up to `mid`, right half to `last`). */
export function pairRows(ws: Worksheet, start: number, pairs: Pair[], mid: number, last: number, height: number): number {
  pairs.forEach(([label, token, input], i) => {
    const row = start + Math.floor(i / 2)
    const [l, r] = i % 2 === 0 ? [1, mid] : [mid + 1, last]
    ws.getRow(row).height = height
    if (label === '') return
    put(ws, row, l, l + 1, label, LABEL)
    put(ws, row, l + 2, r, token, input ? INPUT_VALUE : VALUE)
  })
  return start + Math.ceil(pairs.length / 2)
}

function setWidths(ws: Worksheet, widths: readonly number[]): void {
  // exceljs treats a width of exactly 9 as its default and does not write it, so Excel and
  // LibreOffice fall back to 8.43 (the 5.4.0 "Part nur" truncation). Nudge it.
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w === 9 ? 9.01 : w))
}

/** Logo (A:C), title and subtitle, report identity at the right; a navy rule under row 3. */
function titleBand(ws: Worksheet, last: number, title: string, subtitle: string, bandItems: Pair[]): void {
  ws.getRow(1).height = 22
  ws.getRow(2).height = 22
  ws.getRow(3).height = 20
  ws.mergeCells(1, 1, 3, 3)
  ws.getCell(1, 1).value = '{{LOGO}}'
  ws.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' }
  ws.mergeCells(1, 4, 2, last - 3)
  ws.getCell(1, 4).value = title
  ws.getCell(1, 4).style = { font: font({ size: 18, bold: true, color: { argb: NAVY } }), alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } }
  ws.mergeCells(3, 4, 3, last - 3)
  ws.getCell(3, 4).value = subtitle
  ws.getCell(3, 4).style = { font: font({ size: 10, color: { argb: TEXT_DARK } }), alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } }
  bandItems.forEach(([label, token], i) => {
    put(ws, 1 + i, last - 2, last - 1, label, LABEL)
    put(ws, 1 + i, last, last, token, { ...VALUE, font: font({ bold: true }) })
  })
  for (let c = 1; c <= last; c++) {
    const cell = ws.getCell(3, c)
    cell.border = { ...cell.border, bottom: { style: 'medium', color: { argb: NAVY } } }
  }
  ws.getRow(4).height = 8
}

/** Sign-off pairs with a writing line under each value. Returns the next free row. */
function signOffBlock(ws: Worksheet, start: number, signOff: Pair[], mid: number, last: number): number {
  ws.getCell(start, 1).value = 'Sign-off'
  ws.getCell(start, 1).font = HEADING
  const end = pairRows(ws, start + 1, signOff, mid, last, 26)
  for (let r = start + 1; r < end; r++) {
    for (let c = 1; c <= last; c++) {
      const cell = ws.getCell(r, c)
      if (cell.fill && (cell.fill as { fgColor?: { argb?: string } }).fgColor?.argb === LABEL_FILL) continue
      cell.border = { ...cell.border, bottom: { style: 'thin', color: { argb: TEXT_DARK } } }
    }
  }
  return end
}

function noteRow(ws: Worksheet, row: number, last: number, note: string): void {
  put(ws, row, 1, last, note, { font: font({ italic: true, size: 8, color: { argb: TEXT_DARK } }), alignment: { wrapText: true, vertical: 'top' } })
  ws.getRow(row).height = 24
  fitRowHeight(ws, row)
}

/** Landscape, one page wide; a form sheet (no title rows) also one page tall. */
function printSetup(ws: Worksheet, printTitlesRow: number | null): void {
  ws.pageSetup = {
    ...ws.pageSetup,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: printTitlesRow === null ? 1 : 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    ...(printTitlesRow !== null ? { printTitlesRow: `${printTitlesRow}:${printTitlesRow}` } : {}),
  }
  ws.headerFooter.oddFooter = '&L&8 Report {{REPORT_NUMBER}}  ·  {{PART_NUMBER}} rev {{REVISION}}&R&8 Page &P of &N'
}

/** The characteristic table sheet: band, part block, summary, table (one template row), sign-off. */
export function addReportSheet(wb: Workbook, spec: ReportSpec): Worksheet {
  const ws = wb.addWorksheet(spec.sheet)
  const last = spec.columns.length
  setWidths(ws, spec.columns.map((c) => c.width))
  titleBand(ws, last, spec.title, spec.subtitle, spec.bandItems)

  // Part block and general tolerances.
  let row = pairRows(ws, 5, spec.pairs, spec.mid, last, 18)
  if (!spec.noGeneralTolerances) {
    put(ws, row, 1, 2, 'General tolerances', { ...LABEL, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 } })
    put(ws, row, 3, last, '{{GENERAL_TOLERANCES}}', { ...VALUE, alignment: { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 } })
    ws.getRow(row).height = 36
    row += 1
  }
  ws.getRow(row).height = 8
  row += 1

  // Summary strip: captions over formula values. The ranges name the row template row; the
  // engine grows them with the table.
  const headerRow = row + 3
  const firstDataRow = headerRow + 1
  const verdictCol = spec.columns.findIndex((c) => c.token === '{{VERDICT}}') + 1
  const requirementCol = spec.columns.findIndex((c) => c.token === '{{COL:spec}}') + 1
  const v = `$${columnLetter(verdictCol)}$${firstDataRow}:$${columnLetter(verdictCol)}$${firstDataRow}`
  const req = `$${columnLetter(requirementCol)}$${firstDataRow}:$${columnLetter(requirementCol)}$${firstDataRow}`
  const valueRow = row + 1
  const spans: [number, number][] = [
    [1, 2],
    [3, 3],
    [4, 4],
    [5, spec.mid],
    [spec.mid + 1, last],
  ]
  const total = address(valueRow, 1)
  const pass = address(valueRow, 3)
  const fail = address(valueRow, 4)
  const open = address(valueRow, 5)
  const summary: [string, string][] = [
    [spec.countCaption ?? 'Characteristics', `COUNTA(${req})`],
    ['Passed', `COUNTIF(${v},"PASS")`],
    ['Failed', `COUNTIF(${v},"FAIL")`],
    ['Open', `${total}-${pass}-${fail}`],
    ['Overall result', `IF(${total}=0,"",IF(${fail}>0,"REJECTED",IF(${open}>0,"INCOMPLETE","ACCEPTED")))`],
  ]
  summary.forEach(([caption, formula], i) => {
    const [l, r] = spans[i]
    put(ws, row, l, r, caption, { ...LABEL, alignment: { vertical: 'middle', horizontal: 'center' } })
    put(ws, valueRow, l, r, '', { font: font({ size: 12, bold: true }), border: BOX, alignment: { vertical: 'middle', horizontal: 'center' } })
    ws.getCell(valueRow, l).value = { formula }
  })
  ws.getRow(valueRow).height = 22
  const overall = `${address(valueRow, spec.mid + 1)}:${address(valueRow, last)}`
  conditional(ws, overall, [
    { type: 'cellIs', operator: 'equal', formulae: ['"ACCEPTED"'], style: GOOD, priority: 1 },
    { type: 'cellIs', operator: 'equal', formulae: ['"REJECTED"'], style: BAD, priority: 2 },
    { type: 'cellIs', operator: 'equal', formulae: ['"INCOMPLETE"'], style: NEUTRAL, priority: 3 },
  ])
  ws.getRow(row + 2).height = 8

  // Characteristic table.
  ws.getRow(headerRow).height = 30
  ws.getRow(firstDataRow).height = 18
  spec.columns.forEach((c, i) => {
    // Text columns read left-aligned, codes and measurements centred; the heading follows its column.
    const horizontal = c.align ?? 'center'
    const indent = horizontal === 'left' ? 1 : 0
    const header = ws.getCell(headerRow, i + 1)
    header.value = c.caption
    header.style = {
      font: font({ bold: true, color: { argb: 'FFFFFFFF' } }),
      fill: solid(c.input ? INPUT_HEAD : NAVY),
      border: BOX,
      alignment: { wrapText: true, vertical: 'middle', horizontal, indent },
    }
    const cell = ws.getCell(firstDataRow, i + 1)
    cell.value = c.token
    cell.style = { font: font(), border: BOX, alignment: { vertical: 'middle', horizontal, indent, wrapText: true } }
  })
  // Long captions wrap; the header grows to hold them.
  fitRowHeight(ws, headerRow)
  const tableRef = `${address(firstDataRow, 1)}:${address(firstDataRow, last)}`
  const verdictRef = `${address(firstDataRow, verdictCol)}:${address(firstDataRow, verdictCol)}`
  conditional(ws, verdictRef, [
    { type: 'cellIs', operator: 'equal', formulae: ['"PASS"'], style: GOOD, priority: 1, stopIfTrue: true },
    { type: 'cellIs', operator: 'equal', formulae: ['"FAIL"'], style: BAD, priority: 2, stopIfTrue: true },
  ])
  conditional(ws, tableRef, [{ type: 'expression', formulae: ['MOD(ROW(),2)=0'], style: BAND, priority: 3 }])

  // Sign-off block and note.
  const after = signOffBlock(ws, firstDataRow + 2, spec.signOff, spec.mid, last) + 1
  noteRow(ws, after, last, spec.note)

  printSetup(ws, headerRow)
  ws.views = [
    { state: 'frozen', ySplit: headerRow, xSplit: 0, topLeftCell: `A${firstDataRow}`, activeCell: `A${firstDataRow}`, showGridLines: false },
  ]
  return ws
}

/** A block of a form sheet. */
export type FormBlock =
  /** Label / value pairs, two per row. */
  | { kind: 'pairs'; heading?: string; pairs: Pair[] }
  /** A table of entry cells: `rows` rows of the given columns, each cell `{{ENTRY:<prefix>_<row>_<col>}}`. */
  | { kind: 'table'; heading: string; columns: { caption: string; span: number }[]; rows: number; prefix: string }
  /** One tall entry cell across the sheet (comments). */
  | { kind: 'text'; heading: string; token: string; height: number }

export interface FormSpec {
  sheet: string
  title: string
  subtitle: string
  /** Column widths; the blocks lay out over these columns. */
  widths: number[]
  /** Last column of the left half of pair rows. */
  mid: number
  bandItems: Pair[]
  blocks: FormBlock[]
  signOff: Pair[]
  note: string
}

/**
 * A form sheet with no characteristic table: header fields, entry tables and a sign-off. Values
 * BluePLM does not know are entries (unlocked, read back from the returned workbook).
 */
export function addFormSheet(wb: Workbook, spec: FormSpec): Worksheet {
  const ws = wb.addWorksheet(spec.sheet)
  const last = spec.widths.length
  setWidths(ws, spec.widths)
  titleBand(ws, last, spec.title, spec.subtitle, spec.bandItems)

  let row = 5
  for (const block of spec.blocks) {
    if (block.kind !== 'pairs' || block.heading) {
      const heading = block.kind === 'pairs' ? (block.heading ?? '') : block.heading
      put(ws, row, 1, last, heading, { font: HEADING, alignment: { vertical: 'bottom', horizontal: 'left' } })
      ws.getRow(row).height = 20
      row += 1
    }
    if (block.kind === 'pairs') {
      row = pairRows(ws, row, block.pairs, spec.mid, last, 20)
    } else if (block.kind === 'table') {
      let col = 1
      for (const column of block.columns) {
        const right = Math.min(last, col + column.span - 1)
        put(ws, row, col, right, column.caption, {
          font: font({ bold: true, color: { argb: 'FFFFFFFF' } }),
          fill: solid(INPUT_HEAD),
          border: BOX,
          alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
        })
        col = right + 1
      }
      ws.getRow(row).height = 30
      fitRowHeight(ws, row)
      row += 1
      for (let r = 1; r <= block.rows; r++) {
        col = 1
        block.columns.forEach((column, c) => {
          const right = Math.min(last, col + column.span - 1)
          put(ws, row, col, right, `{{ENTRY:${block.prefix}_${r}_${c + 1}}}`, { ...INPUT_VALUE, alignment: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true } })
          col = right + 1
        })
        ws.getRow(row).height = 20
        row += 1
      }
    } else {
      put(ws, row, 1, last, block.token, { ...INPUT_VALUE, alignment: { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true } })
      ws.getRow(row).height = block.height
      row += 1
    }
    ws.getRow(row).height = 8
    row += 1
  }

  const after = signOffBlock(ws, row, spec.signOff, spec.mid, last) + 1
  noteRow(ws, after, last, spec.note)
  printSetup(ws, null)
  ws.views = [{ showGridLines: false }]
  return ws
}
