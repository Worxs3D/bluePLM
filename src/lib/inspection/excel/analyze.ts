/**
 * Template analysis: where the tokens of an inspection report template are, and what is wrong
 * with it. The result (`TemplateLayout`) is JSON and is stored with the template
 * (`inspection_template.layout`). Issues carry codes, not text: the UI translates them.
 */
import type { Workbook, Worksheet } from 'exceljs'

import { parseTokens, type ParsedToken, type RowField } from './tokens'
import { address, cellText, decodeRange, isMasterOrSingle, mergeRanges, META_SHEET, readWorkbook } from './workbook'

export type LayoutIssueCode =
  /** No `{{COL:<field>}}` token anywhere: there is nowhere to put the characteristics. */
  | 'NO_ROW_TEMPLATE'
  /** The row template names no known field. */
  | 'NO_KNOWN_FIELDS'
  /** A cell of the row template is merged across several rows; it cannot be repeated. */
  | 'ROW_TEMPLATE_VERTICAL_MERGE'
  /** `{{INSPECTION_TABLE}}` without a `{{COL:...}}` header row above it. */
  | 'TABLE_ANCHOR_WITHOUT_HEADER'
  /** The workbook could not be read as .xlsx. */
  | 'UNREADABLE_WORKBOOK'
  | 'UNKNOWN_TOKEN'
  | 'UNKNOWN_FIELD'
  /** A Google Sheets token the Excel engine does not fill (`{{PART_PREVIEW}}`); it is blanked. */
  | 'UNSUPPORTED_TOKEN'
  /** A row token (`COL`, `RESULT`, `VERDICT`, `INPUT`) outside the row template; it is blanked. */
  | 'ROW_TOKEN_OUTSIDE_TEMPLATE'
  /** More than one `{{DRAWING}}`; only the first is used. */
  | 'DUPLICATE_DRAWING_ANCHOR'
  | 'DUPLICATE_RESULT_INDEX'
  | 'DUPLICATE_VERDICT'
  | 'DUPLICATE_ENTRY'
  /** A result, verdict, input or entry cell also holds other text, which is dropped. */
  | 'TOKEN_CELL_HAS_TEXT'
  /** No `{{RESULT}}`: the report collects no measured values. */
  | 'NO_RESULT_COLUMNS'
  /** The template has a `_blueplm` sheet; it is replaced. */
  | 'RESERVED_SHEET_NAME'
  /** A formula in the row template; it is copied unchanged (references are not shifted). */
  | 'FORMULA_IN_ROW_TEMPLATE'

export interface LayoutIssue {
  code: LayoutIssueCode
  sheet?: string
  cell?: string
  /** The token or field concerned, when there is one. */
  token?: string
}

export type TemplateRowCell =
  | { col: number; cell: string; kind: 'field'; fields: RowField[] }
  | { col: number; cell: string; kind: 'result'; index: number }
  | { col: number; cell: string; kind: 'verdict' }
  | { col: number; cell: string; kind: 'input'; name: string }

export interface TemplateLayout {
  version: 1
  sheets: { name: string; state: 'visible' | 'hidden' | 'veryHidden'; rowCount: number; columnCount: number }[]
  rowTemplate: {
    sheet: string
    /** 1-based row that repeats once per characteristic. */
    row: number
    /** Legacy `{{INSPECTION_TABLE}}` templates: the header row whose `{{COL:...}}` cells get captions. */
    legacyHeaderRow: number | null
    cells: TemplateRowCell[]
    /** Rows printed at the top of every page (`5:5`), or null. */
    printTitleRows: string | null
  } | null
  /** Header cells holding scalar or `PROP` tokens. */
  scalars: { sheet: string; cell: string; tokens: string[] }[]
  /** `{{ENTRY:<name>}}` cells the recipient fills in. */
  entries: { sheet: string; cell: string; name: string }[]
  /** Custom property names the template asks for (`{{PROP:<name>}}`). */
  properties: string[]
  /** Number of measured-value columns (highest `RESULT:n`). */
  resultCount: number
  hasVerdict: boolean
  drawingAnchor: { sheet: string; cell: string } | null
  errors: LayoutIssue[]
  warnings: LayoutIssue[]
}

/** A token-bearing cell found while scanning. */
export interface ScannedCell {
  row: number
  col: number
  cell: string
  text: string
  tokens: ParsedToken[]
  isFormula: boolean
}

export interface ScannedSheet {
  ws: Worksheet
  cells: ScannedCell[]
}

const ERROR_CODES: ReadonlySet<LayoutIssueCode> = new Set<LayoutIssueCode>([
  'NO_ROW_TEMPLATE',
  'NO_KNOWN_FIELDS',
  'ROW_TEMPLATE_VERTICAL_MERGE',
  'TABLE_ANCHOR_WITHOUT_HEADER',
  'UNREADABLE_WORKBOOK',
])

export function scanSheet(ws: Worksheet): ScannedSheet {
  const cells: ScannedCell[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!isMasterOrSingle(cell)) return
      const text = cellText(cell)
      if (!text.includes('{{')) return
      const tokens = parseTokens(text)
      if (tokens.length === 0) return
      const value = cell.value
      const isFormula = typeof value === 'object' && value !== null && ('formula' in value || 'sharedFormula' in value)
      cells.push({ row: rowNumber, col: colNumber, cell: address(rowNumber, colNumber), text, tokens, isFormula })
    })
  })
  return { ws, cells }
}

export interface Analysis {
  layout: TemplateLayout
  scanned: Map<string, ScannedSheet>
}

/** Analyse an opened workbook (shared by `analyzeTemplate` and the generator). */
export function analyzeWorkbook(workbook: Workbook): Analysis {
  const issues: LayoutIssue[] = []
  const scanned = new Map<string, ScannedSheet>()
  const sheets: TemplateLayout['sheets'] = []

  for (const ws of workbook.worksheets) {
    if (ws.name === META_SHEET) {
      issues.push({ code: 'RESERVED_SHEET_NAME', sheet: ws.name })
      continue
    }
    sheets.push({ name: ws.name, state: ws.state, rowCount: ws.rowCount, columnCount: ws.columnCount })
    scanned.set(ws.name, scanSheet(ws))
  }

  // Row template: the legacy anchor row if the sheet has one, else the first row with COL tokens.
  let rowTemplate: TemplateLayout['rowTemplate'] = null
  for (const { ws, cells } of scanned.values()) {
    const colRows = [...new Set(cells.filter((c) => c.tokens.some((t) => t.kind === 'col' || t.kind === 'unknownCol')).map((c) => c.row))].sort(
      (a, b) => a - b,
    )
    const anchor = cells.find((c) => c.tokens.some((t) => t.kind === 'tableAnchor'))
    if (anchor) {
      const header = colRows.filter((r) => r < anchor.row).pop()
      if (header === undefined) {
        issues.push({ code: 'TABLE_ANCHOR_WITHOUT_HEADER', sheet: ws.name, cell: anchor.cell })
        continue
      }
      rowTemplate = { sheet: ws.name, row: anchor.row, legacyHeaderRow: header, cells: [], printTitleRows: null }
      break
    }
    if (colRows.length > 0) {
      rowTemplate = { sheet: ws.name, row: colRows[0], legacyHeaderRow: null, cells: [], printTitleRows: null }
      break
    }
  }

  const scalars: TemplateLayout['scalars'] = []
  const entries: TemplateLayout['entries'] = []
  const properties = new Set<string>()
  let drawingAnchor: TemplateLayout['drawingAnchor'] = null
  const resultIndexes = new Set<number>()
  let hasVerdict = false

  for (const { ws, cells } of scanned.values()) {
    const isTableSheet = rowTemplate?.sheet === ws.name
    for (const c of cells) {
      const inTemplateRow = isTableSheet && rowTemplate !== null && c.row === rowTemplate.row
      const inLegacyHeader = isTableSheet && rowTemplate?.legacyHeaderRow === c.row
      const scalarTokens: string[] = []
      const exclusive = c.tokens.length === 1 && c.text.trim() === c.tokens[0].raw
      for (const t of c.tokens) {
        const at = { sheet: ws.name, cell: c.cell }
        switch (t.kind) {
          case 'scalar':
            scalarTokens.push(t.name)
            break
          case 'prop':
            scalarTokens.push(`PROP:${t.name}`)
            properties.add(t.name)
            break
          case 'entry':
            if (entries.some((e) => e.name === t.name)) issues.push({ code: 'DUPLICATE_ENTRY', ...at, token: t.raw })
            else entries.push({ ...at, name: t.name })
            if (!exclusive) issues.push({ code: 'TOKEN_CELL_HAS_TEXT', ...at, token: t.raw })
            break
          case 'drawing':
            if (drawingAnchor) issues.push({ code: 'DUPLICATE_DRAWING_ANCHOR', ...at })
            else drawingAnchor = at
            break
          case 'tableAnchor':
            break
          case 'legacy':
            issues.push({ code: 'UNSUPPORTED_TOKEN', ...at, token: t.raw })
            break
          case 'unknown':
            issues.push({ code: 'UNKNOWN_TOKEN', ...at, token: t.raw })
            break
          case 'unknownCol':
            if (inTemplateRow || inLegacyHeader) issues.push({ code: 'UNKNOWN_FIELD', ...at, token: t.field })
            else issues.push({ code: 'ROW_TOKEN_OUTSIDE_TEMPLATE', ...at, token: t.raw })
            break
          case 'col':
            if (!inTemplateRow && !inLegacyHeader) issues.push({ code: 'ROW_TOKEN_OUTSIDE_TEMPLATE', ...at, token: t.raw })
            break
          case 'result':
          case 'verdict':
          case 'input':
            if (!inTemplateRow) issues.push({ code: 'ROW_TOKEN_OUTSIDE_TEMPLATE', ...at, token: t.raw })
            break
        }
      }
      if (scalarTokens.length > 0) scalars.push({ sheet: ws.name, cell: c.cell, tokens: scalarTokens })

      if (inTemplateRow && rowTemplate) {
        if (c.isFormula) issues.push({ code: 'FORMULA_IN_ROW_TEMPLATE', sheet: ws.name, cell: c.cell })
        const rowCell = templateRowCell(c, rowTemplate.legacyHeaderRow !== null)
        if (rowCell) {
          if (rowCell.kind === 'result') {
            if (resultIndexes.has(rowCell.index)) {
              issues.push({ code: 'DUPLICATE_RESULT_INDEX', sheet: ws.name, cell: c.cell, token: `RESULT:${rowCell.index}` })
              continue
            }
            resultIndexes.add(rowCell.index)
          }
          if (rowCell.kind === 'verdict') {
            if (hasVerdict) {
              issues.push({ code: 'DUPLICATE_VERDICT', sheet: ws.name, cell: c.cell })
              continue
            }
            hasVerdict = true
          }
          if (rowCell.kind !== 'field' && !(c.tokens.length === 1 && c.text.trim() === c.tokens[0].raw)) {
            issues.push({ code: 'TOKEN_CELL_HAS_TEXT', sheet: ws.name, cell: c.cell, token: c.tokens[0].raw })
          }
          rowTemplate.cells.push(rowCell)
        }
      }
    }
  }

  if (rowTemplate && rowTemplate.legacyHeaderRow !== null) {
    // Legacy: the fields come from the header row above the anchor, one column each.
    const header = scanned.get(rowTemplate.sheet)?.cells.filter((c) => c.row === rowTemplate?.legacyHeaderRow) ?? []
    for (const c of header) {
      const fields = c.tokens.flatMap((t) => (t.kind === 'col' ? [t.field] : []))
      if (fields.length > 0 && !rowTemplate.cells.some((x) => x.col === c.col)) {
        rowTemplate.cells.push({ col: c.col, cell: address(rowTemplate.row, c.col), kind: 'field', fields: [fields[0]] })
      }
    }
  }

  if (rowTemplate) {
    rowTemplate.cells.sort((a, b) => a.col - b.col)
    const tableWs = scanned.get(rowTemplate.sheet)?.ws
    if (tableWs) {
      checkVerticalMerges(tableWs, rowTemplate.row, issues)
      rowTemplate.printTitleRows = printTitleRows(tableWs, rowTemplate.row, rowTemplate.legacyHeaderRow)
    }
    if (!rowTemplate.cells.some((c) => c.kind === 'field')) issues.push({ code: 'NO_KNOWN_FIELDS', sheet: rowTemplate.sheet })
    if (resultIndexes.size === 0) issues.push({ code: 'NO_RESULT_COLUMNS', sheet: rowTemplate.sheet })
  } else if (!issues.some((i) => i.code === 'TABLE_ANCHOR_WITHOUT_HEADER')) {
    issues.push({ code: 'NO_ROW_TEMPLATE' })
  }

  const layout: TemplateLayout = {
    version: 1,
    sheets,
    rowTemplate,
    scalars,
    entries,
    properties: [...properties],
    resultCount: resultIndexes.size === 0 ? 0 : Math.max(...resultIndexes),
    hasVerdict,
    drawingAnchor,
    errors: issues.filter((i) => ERROR_CODES.has(i.code)),
    warnings: issues.filter((i) => !ERROR_CODES.has(i.code)),
  }
  return { layout, scanned }
}

function templateRowCell(c: ScannedCell, legacy: boolean): TemplateRowCell | null {
  const base = { col: c.col, cell: c.cell }
  const first = c.tokens.find((t) => t.kind === 'result' || t.kind === 'verdict' || t.kind === 'input')
  if (first?.kind === 'result') return { ...base, kind: 'result', index: first.index }
  if (first?.kind === 'verdict') return { ...base, kind: 'verdict' }
  if (first?.kind === 'input') return { ...base, kind: 'input', name: first.name }
  if (legacy) return null
  const fields = c.tokens.flatMap((t) => (t.kind === 'col' ? [t.field] : []))
  return fields.length > 0 ? { ...base, kind: 'field', fields } : null
}

function checkVerticalMerges(ws: Worksheet, row: number, issues: LayoutIssue[]): void {
  for (const range of mergeRanges(ws)) {
    const box = decodeRange(range)
    if (box.top <= row && box.bottom >= row && box.bottom > box.top) {
      issues.push({ code: 'ROW_TEMPLATE_VERTICAL_MERGE', sheet: ws.name, cell: range })
    }
  }
}

/** The header row(s) directly above the row template: the row above, widened by any merge ending on it. */
function printTitleRows(ws: Worksheet, row: number, legacyHeaderRow: number | null): string | null {
  const bottom = legacyHeaderRow ?? row - 1
  if (bottom < 1) return null
  let top = bottom
  for (const range of mergeRanges(ws)) {
    const box = decodeRange(range)
    if (box.bottom === bottom && box.top < top) top = box.top
  }
  return `${top}:${bottom}`
}

export function isLayoutIssueError(code: LayoutIssueCode): boolean {
  return ERROR_CODES.has(code)
}

/** Analyse an .xlsx template. Never throws: an unreadable file is an error in the layout. */
export async function analyzeTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateLayout> {
  let workbook: Workbook
  try {
    workbook = await readWorkbook(bytes)
  } catch {
    return {
      version: 1,
      sheets: [],
      rowTemplate: null,
      scalars: [],
      entries: [],
      properties: [],
      resultCount: 0,
      hasVerdict: false,
      drawingAnchor: null,
      errors: [{ code: 'UNREADABLE_WORKBOOK' }],
      warnings: [],
    }
  }
  return analyzeWorkbook(workbook).layout
}
