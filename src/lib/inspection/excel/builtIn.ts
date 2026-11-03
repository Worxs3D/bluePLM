/**
 * Built-in starter templates, built with exceljs at runtime (no binary assets in the repo).
 *
 * Captions are workbook content, not UI: they are English, like a template an admin authors, so a
 * template reads the same whoever downloads it. An organization that wants other wording
 * downloads a starter, edits it, and uploads it as its own template.
 *
 * Both layouts are original and share one design: a title band with the logo and the report
 * identity, a part block, a summary strip counted by formula, the characteristic table (dark
 * header, banded rows, PASS / FAIL colours), a sign-off block, and print setup (landscape, one
 * page wide, header row repeated, footer with report number and page x of y). The drawing pages
 * are added by the engine under the sign-off block. The first article layout names and numbers
 * the AS9102 Form 3 fields it fills (part and report identity, characteristic number, reference
 * location, designator, requirement, results, tooling, nonconformance number, comments) in a
 * layout of its own.
 */
import type { Alignment, Borders, ConditionalFormattingOptions, Fill, Font, Style, Worksheet } from 'exceljs'

import { fitRowHeight } from './place'
import { address, columnLetter, newWorkbook, writeWorkbook } from './workbook'

export interface BuiltInTemplate {
  key: string
  name: string
  description: string
  bytes: Uint8Array
}

const NAVY = 'FF1F3864'
const INPUT_HEAD = 'FF2F5496'
const GRID = 'FFBFBFBF'
const LABEL_FILL = 'FFF2F2F2'
const TEXT_DARK = 'FF404040'

const grid = { style: 'thin' as const, color: { argb: GRID } }
const BOX: Partial<Borders> = { top: grid, left: grid, bottom: grid, right: grid }
const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const font = (over: Partial<Font> = {}): Partial<Font> => ({ name: 'Calibri', size: 10, ...over })

/** Formula-free conditional format styles (Excel's own good / bad / neutral colours). */
const GOOD = { font: { color: { argb: 'FF006100' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } } }
const BAD = { font: { color: { argb: 'FF9C0006' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } }
const NEUTRAL = { font: { color: { argb: 'FF9C5700' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFEB9C' } } }
const BAND = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF5F7FA' } } }

/** Add a conditional format (rule objects are plain data; exceljs' rule types are stricter than its writer). */
function conditional(ws: Worksheet, ref: string, rules: Record<string, unknown>[]): void {
  ws.addConditionalFormatting({ ref, rules } as unknown as ConditionalFormattingOptions)
}

interface Column {
  caption: string
  token: string
  width: number
  /** Completed by the inspector (lighter header). */
  input?: boolean
  align?: Alignment['horizontal']
}

/** `[label, token, input?]`; label '' leaves the pair empty. */
type Pair = [string, string, boolean?]

interface ReportSpec {
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
}

/** Write a value across `left..right` of `row` (merged when wider than one column). */
function put(ws: Worksheet, row: number, left: number, right: number, value: string, style: Partial<Style>): void {
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

const LABEL: Partial<Style> = {
  font: font({ bold: true, size: 9, color: { argb: TEXT_DARK } }),
  fill: solid(LABEL_FILL),
  border: BOX,
  alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
}
const VALUE: Partial<Style> = { font: font(), border: BOX, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 } }
const INPUT_VALUE: Partial<Style> = { ...VALUE, fill: solid('FFFFFDF0') }

function pairRows(ws: Worksheet, start: number, pairs: Pair[], mid: number, last: number, height: number): number {
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

async function buildReport(spec: ReportSpec): Promise<Uint8Array> {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet(spec.sheet)
  const last = spec.columns.length
  // exceljs treats a width of exactly 9 as its default and does not write it, so Excel and
  // LibreOffice fall back to 8.43 (the 5.4.0 "Part nur" truncation). Nudge it.
  spec.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width === 9 ? 9.01 : c.width))

  // Title band: logo (A:C), title and subtitle, report identity at the right.
  ws.getRow(1).height = 22
  ws.getRow(2).height = 22
  ws.getRow(3).height = 20
  ws.mergeCells(1, 1, 3, 3)
  ws.getCell(1, 1).value = '{{LOGO}}'
  ws.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' }
  ws.mergeCells(1, 4, 2, last - 3)
  ws.getCell(1, 4).value = spec.title
  ws.getCell(1, 4).style = { font: font({ size: 18, bold: true, color: { argb: NAVY } }), alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } }
  ws.mergeCells(3, 4, 3, last - 3)
  ws.getCell(3, 4).value = spec.subtitle
  ws.getCell(3, 4).style = { font: font({ size: 10, color: { argb: TEXT_DARK } }), alignment: { vertical: 'middle', horizontal: 'left', indent: 1 } }
  spec.bandItems.forEach(([label, token], i) => {
    put(ws, 1 + i, last - 2, last - 1, label, LABEL)
    put(ws, 1 + i, last, last, token, { ...VALUE, font: font({ bold: true }) })
  })
  for (let c = 1; c <= last; c++) {
    const cell = ws.getCell(3, c)
    cell.border = { ...cell.border, bottom: { style: 'medium', color: { argb: NAVY } } }
  }
  ws.getRow(4).height = 8

  // Part block and general tolerances.
  let row = pairRows(ws, 5, spec.pairs, spec.mid, last, 18)
  put(ws, row, 1, 2, 'General tolerances', { ...LABEL, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 } })
  put(ws, row, 3, last, '{{GENERAL_TOLERANCES}}', { ...VALUE, alignment: { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 } })
  ws.getRow(row).height = 36
  row += 1
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
    ['Characteristics', `COUNTA(${req})`],
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
  let after = firstDataRow + 2
  ws.getCell(after, 1).value = 'Sign-off'
  ws.getCell(after, 1).font = font({ bold: true, size: 11, color: { argb: NAVY } })
  after += 1
  after = pairRows(ws, after, spec.signOff, spec.mid, last, 26)
  for (let r = after - Math.ceil(spec.signOff.length / 2); r < after; r++) {
    for (let c = 1; c <= last; c++) {
      const cell = ws.getCell(r, c)
      if (cell.fill && (cell.fill as { fgColor?: { argb?: string } }).fgColor?.argb === LABEL_FILL) continue
      cell.border = { ...cell.border, bottom: { style: 'thin', color: { argb: TEXT_DARK } } }
    }
  }
  after += 1
  put(ws, after, 1, last, spec.note, { font: font({ italic: true, size: 8, color: { argb: TEXT_DARK } }), alignment: { wrapText: true, vertical: 'top' } })
  ws.getRow(after).height = 24

  // Print setup and view.
  ws.pageSetup = {
    ...ws.pageSetup,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    printTitlesRow: `${headerRow}:${headerRow}`,
  }
  ws.headerFooter.oddFooter = '&L&8 Report {{REPORT_NUMBER}}  ·  {{PART_NUMBER}} rev {{REVISION}}&R&8 Page &P of &N'
  ws.views = [
    { state: 'frozen', ySplit: headerRow, xSplit: 0, topLeftCell: `A${firstDataRow}`, activeCell: `A${firstDataRow}`, showGridLines: false },
  ]
  return writeWorkbook(wb)
}

function dimensionalReport(): Promise<Uint8Array> {
  return buildReport({
    sheet: 'Inspection',
    title: 'Dimensional Inspection Report',
    subtitle: '{{ORG_NAME}}',
    columns: [
      { caption: 'Balloon', token: '{{COL:balloon_number}}', width: 10 },
      { caption: 'Zone', token: '{{COL:zone}}', width: 7 },
      { caption: 'Characteristic', token: '{{COL:char_type}}', width: 14, align: 'left' },
      { caption: 'Requirement', token: '{{COL:spec}}', width: 30, align: 'left' },
      { caption: 'Unit', token: '{{COL:unit}}', width: 7 },
      { caption: 'Method', token: '{{COL:inspection_method}}', width: 17, align: 'left' },
      { caption: 'Measured 1', token: '{{RESULT:1}}', width: 12, input: true },
      { caption: 'Measured 2', token: '{{RESULT:2}}', width: 12, input: true },
      { caption: 'Measured 3', token: '{{RESULT:3}}', width: 12, input: true },
      { caption: 'Result', token: '{{VERDICT}}', width: 11, input: true },
      { caption: 'Remarks', token: '{{INPUT:remarks}}', width: 28, input: true, align: 'left' },
    ],
    mid: 6,
    bandItems: [
      ['Report no.', '{{REPORT_NUMBER}}'],
      ['Date issued', '{{DATE}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
    ],
    pairs: [
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
      ['Description', '{{DESCRIPTION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
    ],
    signOff: [
      ['Inspected by', '{{ENTRY:inspected_by}}', true],
      ['Date', '{{ENTRY:inspection_date}}', true],
      ['Approved by', '{{ENTRY:approved_by}}', true],
      ['Date', '{{ENTRY:approval_date}}', true],
    ],
    note: 'Columns with a lighter heading are completed by the inspector. Balloon numbers match the ballooned drawing pages that follow.',
  })
}

/**
 * Characteristic accountability laid out on the AS9102 Form 3 fields the drawing can fill
 * truthfully, numbered as the standard numbers them (1-4 identity, 5-11 per characteristic,
 * 14 comments). Fields only the supplier knows (serial number, results, tooling, nonconformance)
 * are inputs; nothing is pre-filled that the drawing does not say.
 */
function firstArticleAccountability(): Promise<Uint8Array> {
  return buildReport({
    sheet: 'Characteristics',
    title: 'First Article Inspection Report',
    subtitle: 'Characteristic accountability (AS9102 Form 3 fields)  ·  {{ORG_NAME}}',
    columns: [
      { caption: '5. Char. no.', token: '{{COL:balloon_number}}', width: 9 },
      { caption: '6. Reference location', token: '{{COL:zone}}', width: 11 },
      { caption: '7. Characteristic designator', token: '{{COL:classification}}', width: 14 },
      { caption: '8. Requirement', token: '{{COL:spec}}', width: 32, align: 'left' },
      { caption: 'Unit', token: '{{COL:unit}}', width: 7 },
      { caption: '9. Results', token: '{{RESULT:1}}', width: 14, input: true },
      { caption: '10. Designed / qualified tooling', token: '{{INPUT:tool}}', width: 17, input: true, align: 'left' },
      { caption: '11. Nonconformance number', token: '{{INPUT:nonconformance}}', width: 16, input: true },
      { caption: 'Pass / fail', token: '{{VERDICT}}', width: 10, input: true },
      { caption: '14. Comments', token: '{{INPUT:remarks}}', width: 26, input: true, align: 'left' },
    ],
    mid: 6,
    bandItems: [
      ['4. FAI report no.', '{{REPORT_NUMBER}}'],
      ['Date issued', '{{DATE}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
    ],
    pairs: [
      ['1. Part number', '{{PART_NUMBER}}'],
      ['2. Part name', '{{PART_NAME}}'],
      ['Revision', '{{REVISION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['3. Serial number', '{{ENTRY:serial_number}}', true],
      ['Lot / batch', '{{ENTRY:lot_number}}', true],
      ['Supplier', '{{ENTRY:supplier}}', true],
      ['Purchase order', '{{ENTRY:purchase_order}}', true],
      ['Customer', '{{ORG_NAME}}'],
      ['Reason for FAI', '{{ENTRY:fai_reason}}', true],
    ],
    signOff: [
      ['Inspected by', '{{ENTRY:inspected_by}}', true],
      ['Date', '{{ENTRY:inspection_date}}', true],
      ['Approved by', '{{ENTRY:approved_by}}', true],
      ['Date', '{{ENTRY:approval_date}}', true],
    ],
    note: 'Numbered fields follow AS9102 Form 3. Each characteristic on the drawing is listed once, numbered as ballooned on the drawing pages that follow; the reference location is the drawing zone. Columns with a lighter heading are completed by the inspector.',
  })
}

/** The starter templates offered to every organization. Each analyzes with no errors. */
export async function builtInTemplates(): Promise<BuiltInTemplate[]> {
  return [
    {
      key: 'dimensional-inspection',
      name: 'Dimensional inspection report',
      description:
        'Requirement, method, three measured values, result and remarks per characteristic, a summary and sign-off, with the ballooned drawing pages under the table.',
      bytes: await dimensionalReport(),
    },
    {
      key: 'first-article-accountability',
      name: 'First article inspection — characteristic accountability',
      description:
        'AS9102 Form 3 fields: part and report identity, serial, lot, supplier and purchase order, one row per ballooned characteristic with reference location, designator, requirement, result, tooling, nonconformance number and pass / fail, a summary, sign-off, and the drawing pages under the table.',
      bytes: await firstArticleAccountability(),
    },
  ]
}
