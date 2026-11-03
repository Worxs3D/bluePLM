/**
 * Translated text for the Excel engine's issue codes (template analysis, returned workbooks) and
 * for the reasons a report went out without its drawing. The engine returns codes only.
 */
import { t } from '@/lib/i18n'
import { builtInTemplateInfo, type LayoutIssue, type LayoutIssueCode, type ReturnedIssue, type ReturnedIssueCode } from '@/lib/inspection/excel'
import type { InspectionReportType } from '@/types/inspectionReports'

/** Why a report went out without the drawing pages. */
export type DrawingOmittedReason =
  | 'web_no_render'
  | 'needs_solidworks'
  | 'not_a_drawing'
  | 'render_failed'
  | 'rasterize_failed'

/** Every template issue code; `Record` makes the compiler insist on a new code being listed. */
const TEMPLATE_CODES: Record<LayoutIssueCode, true> = {
  NO_ROW_TEMPLATE: true,
  NO_KNOWN_FIELDS: true,
  ROW_TEMPLATE_VERTICAL_MERGE: true,
  TABLE_ANCHOR_WITHOUT_HEADER: true,
  UNREADABLE_WORKBOOK: true,
  UNKNOWN_TOKEN: true,
  UNKNOWN_FIELD: true,
  UNSUPPORTED_TOKEN: true,
  ROW_TOKEN_OUTSIDE_TEMPLATE: true,
  DUPLICATE_DRAWING_ANCHOR: true,
  DUPLICATE_RESULT_INDEX: true,
  DUPLICATE_VERDICT: true,
  DUPLICATE_ENTRY: true,
  TOKEN_CELL_HAS_TEXT: true,
  NO_RESULT_COLUMNS: true,
  RESERVED_SHEET_NAME: true,
  FORMULA_IN_ROW_TEMPLATE: true,
}

const RETURNED_CODES: Record<ReturnedIssueCode, true> = {
  NOT_A_REPORT: true,
  UNKNOWN_FORMAT: true,
  REPORT_ID_MISMATCH: true,
  TABLE_SHEET_MISSING: true,
  MISSING_ROW: true,
  UNKNOWN_ROW: true,
  TAMPERED_ROW: true,
  UNRECOGNIZED_VERDICT: true,
  VERDICT_CONFLICT: true,
}

export const TEMPLATE_ISSUE_CODES = Object.keys(TEMPLATE_CODES) as LayoutIssueCode[]
export const RETURNED_ISSUE_CODES = Object.keys(RETURNED_CODES) as ReturnedIssueCode[]

export const DRAWING_OMITTED_REASONS: readonly DrawingOmittedReason[] = [
  'web_no_render',
  'needs_solidworks',
  'not_a_drawing',
  'render_failed',
  'rasterize_failed',
]

export function templateIssueKey(code: LayoutIssueCode): string {
  return `source.inspection.tplIssue_${code}`
}

export function returnedIssueKey(code: ReturnedIssueCode | string): string {
  return `source.inspection.rptIssue_${code}`
}

export function drawingOmittedKey(reason: DrawingOmittedReason): string {
  return `source.inspection.rptNoDrawing_${reason}`
}

/** `Inspection!B7` style location, or ''. */
function location(sheet?: string, cell?: string): string {
  if (sheet && cell) return `${sheet}!${cell}`
  return sheet ?? cell ?? ''
}

export function templateIssueText(issue: LayoutIssue): string {
  const text = t(templateIssueKey(issue.code), { token: issue.token ?? '' })
  const where = location(issue.sheet, issue.cell)
  return where ? `${text} (${where})` : text
}

export function returnedIssueText(issue: ReturnedIssue): string {
  const text = t(returnedIssueKey(issue.code), { detail: issue.detail ?? '' })
  return issue.balloon ? `${text} (${t('source.inspection.rptBalloon')} ${issue.balloon})` : text
}

/** Stored warning codes (inspection_report.results.warnings) back to text. */
export function storedWarningText(code: string): string {
  return code in RETURNED_CODES ? t(returnedIssueKey(code)) : code
}

/** i18n key of a built-in template's name (`builtInTemplates()` names are English workbook content). */
export const BUILT_IN_NAME_KEYS: Readonly<Record<string, string>> = {
  'dimensional-inspection': 'source.inspection.tplBuiltinDimensional',
  'first-article-accountability': 'source.inspection.tplBuiltinFirstArticle',
  'first-article-as9102': 'source.inspection.tplBuiltinAs9102',
  'production-lot': 'source.inspection.tplBuiltinProduction',
  'receiving-inspection': 'source.inspection.tplBuiltinReceiving',
  reinspection: 'source.inspection.tplBuiltinReinspection',
}

export const BUILT_IN_DESCRIPTION_KEYS: Readonly<Record<string, string>> = {
  'dimensional-inspection': 'source.inspection.tplBuiltinDimensionalDesc',
  'first-article-accountability': 'source.inspection.tplBuiltinFirstArticleDesc',
  'first-article-as9102': 'source.inspection.tplBuiltinAs9102Desc',
  'production-lot': 'source.inspection.tplBuiltinProductionDesc',
  'receiving-inspection': 'source.inspection.tplBuiltinReceivingDesc',
  reinspection: 'source.inspection.tplBuiltinReinspectionDesc',
}

/**
 * Built-ins offered next to the organization's templates, names translated by key, with the report
 * types each serves and is the built-in default for (`builtInTemplateInfo()`).
 */
export function builtInTemplateNames(): Array<{
  key: string
  name: string
  reportTypes: InspectionReportType[]
  defaultFor: InspectionReportType[]
}> {
  return builtInTemplateInfo().map((info) => ({
    key: info.key,
    name: BUILT_IN_NAME_KEYS[info.key] ? t(BUILT_IN_NAME_KEYS[info.key]) : info.name,
    reportTypes: info.reportTypes,
    defaultFor: info.defaultFor,
  }))
}
