/**
 * Built-in starter templates, built with exceljs at runtime (no binary assets in the repo).
 *
 * Captions are workbook content, not UI: they are English, like a template an admin authors, so a
 * template reads the same whoever downloads it. An organization that wants other wording
 * downloads a starter, edits it, and uploads it as its own template.
 *
 * Both layouts are original. The first article layout covers the usual characteristic
 * accountability fields (part and drawing identity, serial / lot, supplier, characteristic
 * number, requirement, results, tool, pass / fail, sign-off) without copying any published form.
 */
import type { Borders, Fill, Font, Worksheet } from 'exceljs'

import { columnLetter, newWorkbook, writeWorkbook } from './workbook'

export interface BuiltInTemplate {
  key: string
  name: string
  description: string
  bytes: Uint8Array
}

const THIN: Partial<Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}
const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }
const INPUT_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E6' } }
const BOLD: Partial<Font> = { bold: true }

interface Column {
  caption: string
  token: string
  width: number
  input?: boolean
}

function title(ws: Worksheet, text: string, lastCol: number): void {
  ws.mergeCells(1, 1, 1, lastCol)
  const cell = ws.getCell(1, 1)
  cell.value = text
  cell.font = { bold: true, size: 16 }
  cell.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 28
}

/** Label / value pairs laid out two pairs per row; returns the next free row. */
function infoBlock(ws: Worksheet, startRow: number, pairs: [string, string, boolean?][], lastCol: number): number {
  const half = Math.floor(lastCol / 2)
  pairs.forEach(([label, token, input], i) => {
    const row = startRow + Math.floor(i / 2)
    const left = i % 2 === 0 ? 1 : half + 1
    const right = i % 2 === 0 ? half : lastCol
    const labelCell = ws.getCell(row, left)
    labelCell.value = label
    labelCell.font = BOLD
    labelCell.fill = HEADER_FILL
    labelCell.border = THIN
    ws.mergeCells(row, left + 1, row, right)
    const valueCell = ws.getCell(row, left + 1)
    valueCell.value = token
    valueCell.border = THIN
    valueCell.alignment = { wrapText: true, vertical: 'top' }
    if (input) valueCell.fill = INPUT_FILL
  })
  return startRow + Math.ceil(pairs.length / 2)
}

function table(ws: Worksheet, headerRow: number, columns: Column[]): void {
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width
    const header = ws.getCell(headerRow, i + 1)
    header.value = c.caption
    header.font = BOLD
    header.fill = HEADER_FILL
    header.border = THIN
    header.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    const cell = ws.getCell(headerRow + 1, i + 1)
    cell.value = c.token
    cell.border = THIN
    cell.alignment = { vertical: 'top', wrapText: true }
    if (c.input) cell.fill = INPUT_FILL
  })
  ws.getRow(headerRow).height = 30
}

function signOff(ws: Worksheet, startRow: number, items: [string, string][], lastCol: number): void {
  infoBlock(
    ws,
    startRow,
    items.map(([label, token]) => [label, token, true]),
    lastCol,
  )
}

function pageSetup(ws: Worksheet, headerRow: number): void {
  ws.pageSetup = {
    ...ws.pageSetup,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    printTitlesRow: `${headerRow}:${headerRow}`,
  }
  ws.headerFooter.oddFooter = '&L&F&RPage &P of &N'
  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0, topLeftCell: `A${headerRow + 1}`, activeCell: `A${headerRow + 1}` }]
}

async function dimensionalReport(): Promise<Uint8Array> {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet('Inspection')
  const columns: Column[] = [
    { caption: 'Balloon', token: '{{COL:balloon_number}}', width: 9 },
    { caption: 'Zone', token: '{{COL:zone}}', width: 7 },
    { caption: 'Type', token: '{{COL:char_type}}', width: 11 },
    { caption: 'Requirement', token: '{{COL:spec}}', width: 24 },
    { caption: 'Unit', token: '{{COL:unit}}', width: 6 },
    { caption: 'Method', token: '{{COL:inspection_method}}', width: 14 },
    { caption: 'Measured 1', token: '{{RESULT:1}}', width: 12, input: true },
    { caption: 'Measured 2', token: '{{RESULT:2}}', width: 12, input: true },
    { caption: 'Measured 3', token: '{{RESULT:3}}', width: 12, input: true },
    { caption: 'Result', token: '{{VERDICT}}', width: 9, input: true },
    { caption: 'Remarks', token: '{{INPUT:remarks}}', width: 22, input: true },
  ]
  const last = columns.length
  title(ws, 'Dimensional Inspection Report', last)
  let row = infoBlock(
    ws,
    3,
    [
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
      ['Description', '{{DESCRIPTION}}'],
      ['Report number', '{{REPORT_NUMBER}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
      ['Organization', '{{ORG_NAME}}'],
      ['Date issued', '{{DATE}}'],
    ],
    last,
  )
  ws.mergeCells(row, 2, row, last)
  ws.getCell(row, 1).value = 'General tolerances'
  ws.getCell(row, 1).font = BOLD
  ws.getCell(row, 1).fill = HEADER_FILL
  ws.getCell(row, 1).border = THIN
  ws.getCell(row, 2).value = '{{GENERAL_TOLERANCES}}'
  ws.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' }
  ws.getCell(row, 2).border = THIN
  ws.getRow(row).height = 45
  row += 2
  const headerRow = row
  table(ws, headerRow, columns)
  signOff(
    ws,
    headerRow + 3,
    [
      ['Inspected by', '{{ENTRY:inspected_by}}'],
      ['Inspection date', '{{ENTRY:inspection_date}}'],
    ],
    last,
  )
  pageSetup(ws, headerRow)

  const drawing = wb.addWorksheet('Drawing', { views: [{ showGridLines: false }] })
  drawing.pageSetup = { ...drawing.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
  drawing.getCell('A1').value = '{{DRAWING}}'
  return writeWorkbook(wb)
}

async function firstArticleAccountability(): Promise<Uint8Array> {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet('Characteristics')
  const columns: Column[] = [
    { caption: 'Char. no.', token: '{{COL:balloon_number}}', width: 9 },
    { caption: 'Drawing zone', token: '{{COL:zone}}', width: 9 },
    { caption: 'Designator', token: '{{COL:classification}}', width: 12 },
    { caption: 'Requirement', token: '{{COL:spec}}', width: 26 },
    { caption: 'Units', token: '{{COL:unit}}', width: 7 },
    { caption: 'Result', token: '{{RESULT:1}}', width: 14, input: true },
    { caption: 'Measuring tool', token: '{{INPUT:tool}}', width: 16, input: true },
    { caption: 'Pass / Fail', token: '{{VERDICT}}', width: 10, input: true },
    { caption: 'Remarks', token: '{{INPUT:remarks}}', width: 24, input: true },
  ]
  const last = columns.length
  title(ws, 'First Article Inspection — Characteristic Accountability', last)
  let row = infoBlock(
    ws,
    3,
    [
      ['Part number', '{{PART_NUMBER}}'],
      ['Part name', '{{PART_NAME}}'],
      ['Revision', '{{REVISION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
      ['Report number', '{{REPORT_NUMBER}}'],
      ['Serial number', '{{ENTRY:serial_number}}', true],
      ['Lot / batch', '{{ENTRY:lot_number}}', true],
      ['Supplier', '{{ENTRY:supplier}}', true],
      ['Purchase order', '{{ENTRY:purchase_order}}', true],
      ['Customer', '{{ORG_NAME}}'],
      ['Date issued', '{{DATE}}'],
    ],
    last,
  )
  ws.mergeCells(row, 2, row, last)
  ws.getCell(row, 1).value = 'General tolerances'
  ws.getCell(row, 1).font = BOLD
  ws.getCell(row, 1).fill = HEADER_FILL
  ws.getCell(row, 1).border = THIN
  ws.getCell(row, 2).value = '{{GENERAL_TOLERANCES}}'
  ws.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' }
  ws.getCell(row, 2).border = THIN
  ws.getRow(row).height = 45
  row += 2
  const headerRow = row
  table(ws, headerRow, columns)
  signOff(
    ws,
    headerRow + 3,
    [
      ['Inspected by', '{{ENTRY:inspected_by}}'],
      ['Inspection date', '{{ENTRY:inspection_date}}'],
      ['Approved by', '{{ENTRY:approved_by}}'],
      ['Approval date', '{{ENTRY:approval_date}}'],
    ],
    last,
  )
  pageSetup(ws, headerRow)
  ws.getCell(`${columnLetter(1)}${headerRow + 6}`).value = 'Each characteristic on the drawing is listed once, numbered as ballooned on the attached drawing.'
  ws.getCell(`${columnLetter(1)}${headerRow + 6}`).font = { italic: true, size: 9 }
  return writeWorkbook(wb)
}

/** The starter templates offered to every organization. Each analyzes with no errors. */
export async function builtInTemplates(): Promise<BuiltInTemplate[]> {
  return [
    {
      key: 'dimensional-inspection',
      name: 'Dimensional inspection report',
      description: 'Requirement, method, three measured values, result and remarks per characteristic, with the ballooned drawing on its own sheet.',
      bytes: await dimensionalReport(),
    },
    {
      key: 'first-article-accountability',
      name: 'First article inspection — characteristic accountability',
      description: 'Part and drawing identity, serial, lot, supplier and purchase order, one row per ballooned characteristic with result, measuring tool and pass / fail, and sign-off. Drawing pages are added as sheets.',
      bytes: await firstArticleAccountability(),
    },
  ]
}
