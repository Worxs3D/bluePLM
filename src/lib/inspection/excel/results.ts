/**
 * Read a returned (filled-in) inspection report: measured values, verdicts and entries, matched
 * to the characteristics through the `_blueplm` sheet, with a tamper check on each row's
 * requirement cells.
 */
import type { Worksheet } from 'exceljs'

import type { InspectionReportRow } from './format'
import { cellsFingerprint, specFingerprint, SPEC_FIELDS } from './fingerprint'
import { META_FORMAT, META_ROW_COLUMNS, META_ROWS_START, lockedCellTexts, type MetaLayout } from './generate'
import { computeVerdict, parseVerdictText, summarizeResults, type ResultsSummary, type Verdict } from './verdict'
import { cellText, decodeAddress, META_SHEET, readWorkbook } from './workbook'

export interface ReturnedResultsExpectation {
  /** The report the workbook should belong to. */
  reportId?: string
  /** The characteristics the report was generated from (that version's snapshot rows). */
  rows?: readonly InspectionReportRow[]
}

export type TamperReason =
  /** A requirement cell in the sheet no longer reads as generated. */
  | 'cells'
  /** The `_blueplm` record of the requirement does not match the expected characteristic or itself. */
  | 'spec'

export interface ReturnedRow {
  rowId: string | null
  sourceKey: string | null
  balloon: string | null
  /** Measured values in `RESULT:n` order (index 0 = RESULT:1); '' when blank. */
  measured: string[]
  /** `{{INPUT:<name>}}` values. */
  inputs: Record<string, string>
  /** Verdict cell text as typed. */
  enteredVerdictText: string
  enteredVerdict: Verdict | null
  computedVerdict: Verdict | null
  /** Computed verdict when the requirement is numeric, else the entered one. */
  verdict: Verdict | null
  /** Entered and computed verdicts disagree. */
  verdictConflict: boolean
  tampered: boolean
  tamperReasons: TamperReason[]
}

export type ReturnedIssueCode =
  /** No `_blueplm` sheet: not a workbook BluePLM generated. */
  | 'NOT_A_REPORT'
  /** `_blueplm` is from a newer or unknown format. */
  | 'UNKNOWN_FORMAT'
  | 'REPORT_ID_MISMATCH'
  /** The table sheet named in `_blueplm` is gone. */
  | 'TABLE_SHEET_MISSING'
  /** An expected characteristic has no row in the workbook. */
  | 'MISSING_ROW'
  /** A workbook row matches no expected characteristic. */
  | 'UNKNOWN_ROW'
  | 'TAMPERED_ROW'
  /** A verdict cell holds text that is neither pass nor fail. */
  | 'UNRECOGNIZED_VERDICT'
  | 'VERDICT_CONFLICT'

export interface ReturnedIssue {
  code: ReturnedIssueCode
  rowId?: string
  balloon?: string
  detail?: string
}

export interface ReturnedResults {
  reportId: string | null
  fileId: string | null
  fileVersionId: string | null
  templateHash: string | null
  /** `{{ENTRY:<name>}}` values (serial number, supplier, sign-off). */
  entries: Record<string, string>
  rows: ReturnedRow[]
  summary: ResultsSummary
  warnings: ReturnedIssue[]
}

function metaValue(ws: Worksheet, key: string): string | null {
  for (let r = 1; r < META_ROWS_START - 1; r++) {
    if (cellText(ws.getCell(r, 1)) === key) return cellText(ws.getCell(r, 2))
  }
  return null
}

function parseMetaLayout(json: string | null): MetaLayout | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as Partial<MetaLayout>
    if (typeof value.sheet !== 'string' || typeof value.firstRow !== 'number' || !Array.isArray(value.cells)) return null
    return { sheet: value.sheet, firstRow: value.firstRow, count: value.count ?? 0, cells: value.cells, entries: value.entries ?? [] }
  } catch {
    return null
  }
}

/** A requirement reconstructed from `_blueplm` (used when the caller passes no expected rows). */
function rowFromSpec(spec: string[], id: string, sourceKey: string): InspectionReportRow | null {
  if (spec.length !== SPEC_FIELDS.length) return null
  const row: Record<string, string | number | null> = { id, sort_order: 0, source_key: sourceKey || null }
  SPEC_FIELDS.forEach((f, i) => (row[f] = spec[i] === '' ? null : spec[i]))
  return row as unknown as InspectionReportRow
}

const EMPTY: ResultsSummary = { total: 0, pass: 0, fail: 0, blank: 0 }

/** Read a returned report workbook. Never throws for a readable .xlsx; problems are warnings. */
export async function readReturnedResults(
  bytes: Uint8Array | ArrayBuffer,
  expected: ReturnedResultsExpectation = {},
): Promise<ReturnedResults> {
  const workbook = await readWorkbook(bytes)
  const meta = workbook.getWorksheet(META_SHEET)
  const result: ReturnedResults = {
    reportId: null,
    fileId: null,
    fileVersionId: null,
    templateHash: null,
    entries: {},
    rows: [],
    summary: EMPTY,
    warnings: [],
  }
  if (!meta) {
    result.warnings.push({ code: 'NOT_A_REPORT' })
    return result
  }
  if (metaValue(meta, 'format') !== META_FORMAT) {
    result.warnings.push({ code: 'UNKNOWN_FORMAT', detail: metaValue(meta, 'format') ?? '' })
    return result
  }
  result.reportId = metaValue(meta, 'report_id')
  result.fileId = metaValue(meta, 'file_id')
  result.fileVersionId = metaValue(meta, 'file_version_id')
  result.templateHash = metaValue(meta, 'template_hash')
  if (expected.reportId && result.reportId !== expected.reportId) {
    result.warnings.push({ code: 'REPORT_ID_MISMATCH', detail: result.reportId ?? '' })
  }

  const layout = parseMetaLayout(metaValue(meta, 'layout'))
  const table = layout ? workbook.getWorksheet(layout.sheet) : undefined
  if (!layout || !table) {
    result.warnings.push({ code: 'TABLE_SHEET_MISSING', detail: layout?.sheet ?? '' })
    return result
  }

  for (const e of layout.entries) {
    const ws = workbook.getWorksheet(e.sheet)
    if (!ws) continue
    const { row, col } = decodeAddress(e.cell)
    result.entries[e.name] = cellText(ws.getCell(row, col)).trim()
  }

  const expectedById = new Map((expected.rows ?? []).map((r) => [r.id, r]))
  const expectedByKey = new Map((expected.rows ?? []).filter((r) => r.source_key).map((r) => [r.source_key as string, r]))
  const seen = new Set<string>()
  const col = (name: (typeof META_ROW_COLUMNS)[number]) => META_ROW_COLUMNS.indexOf(name) + 1
  const resultCols = layout.cells.flatMap((c) => (c.kind === 'result' ? [c] : [])).sort((a, b) => a.index - b.index)
  const maxIndex = resultCols.length === 0 ? 0 : resultCols[resultCols.length - 1].index

  for (let r = META_ROWS_START; r < META_ROWS_START + layout.count; r++) {
    const sheetRow = Number(cellText(meta.getCell(r, col('sheet_row'))))
    const rowId = cellText(meta.getCell(r, col('row_id'))) || null
    const sourceKey = cellText(meta.getCell(r, col('source_key'))) || null
    const balloon = cellText(meta.getCell(r, col('balloon'))) || null
    const storedSpecFp = cellText(meta.getCell(r, col('spec_fingerprint')))
    const storedCellsFp = cellText(meta.getCell(r, col('cells_fingerprint')))
    let spec: string[] = []
    try {
      const parsed: unknown = JSON.parse(cellText(meta.getCell(r, col('spec'))) || '[]')
      if (Array.isArray(parsed)) spec = parsed.map((v) => String(v))
    } catch {
      spec = []
    }
    if (!Number.isInteger(sheetRow) || sheetRow < 1) continue

    const reasons: TamperReason[] = []
    const texts = lockedCellTexts((c) => cellText(table.getCell(sheetRow, c)), layout.cells)
    if (cellsFingerprint(texts) !== storedCellsFp) reasons.push('cells')

    const exp = (rowId ? expectedById.get(rowId) : undefined) ?? (sourceKey ? expectedByKey.get(sourceKey) : undefined)
    if (exp) seen.add(exp.id)
    else if (expected.rows) result.warnings.push({ code: 'UNKNOWN_ROW', rowId: rowId ?? undefined, balloon: balloon ?? undefined })
    const specRow = rowFromSpec(spec, rowId ?? '', sourceKey ?? '')
    const specSelfConsistent = specRow !== null && specFingerprint(specRow) === storedSpecFp
    if (!specSelfConsistent || (exp && specFingerprint(exp) !== storedSpecFp)) reasons.push('spec')

    const measured: string[] = Array.from({ length: maxIndex }, () => '')
    const inputs: Record<string, string> = {}
    let enteredVerdictText = ''
    for (const c of layout.cells) {
      const value = cellText(table.getCell(sheetRow, c.col)).trim()
      if (c.kind === 'result') measured[c.index - 1] = value
      else if (c.kind === 'input') inputs[c.name] = value
      else if (c.kind === 'verdict') enteredVerdictText = value
    }

    const enteredVerdict = parseVerdictText(enteredVerdictText)
    if (enteredVerdictText !== '' && enteredVerdict === null) {
      result.warnings.push({ code: 'UNRECOGNIZED_VERDICT', rowId: rowId ?? undefined, balloon: balloon ?? undefined, detail: enteredVerdictText })
    }
    const basis = exp ?? (specSelfConsistent ? specRow : null)
    const computedVerdict = basis ? computeVerdict(basis, measured) : null
    const verdictConflict = enteredVerdict !== null && computedVerdict !== null && enteredVerdict !== computedVerdict
    if (verdictConflict) result.warnings.push({ code: 'VERDICT_CONFLICT', rowId: rowId ?? undefined, balloon: balloon ?? undefined })
    if (reasons.length > 0) result.warnings.push({ code: 'TAMPERED_ROW', rowId: rowId ?? undefined, balloon: balloon ?? undefined, detail: reasons.join(',') })

    result.rows.push({
      rowId,
      sourceKey,
      balloon,
      measured,
      inputs,
      enteredVerdictText,
      enteredVerdict,
      computedVerdict,
      verdict: computedVerdict ?? enteredVerdict,
      verdictConflict,
      tampered: reasons.length > 0,
      tamperReasons: reasons,
    })
  }

  for (const r of expected.rows ?? []) {
    if (!seen.has(r.id)) result.warnings.push({ code: 'MISSING_ROW', rowId: r.id, balloon: r.balloon_number ?? undefined })
  }
  result.summary = summarizeResults(result.rows)
  return result
}
