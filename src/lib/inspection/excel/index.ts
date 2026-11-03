/**
 * Inspection report Excel engine: templates in, filled reports out, returned results back in.
 * exceljs and pdfjs-dist load lazily on first use. Plan: `.cursor/plans/inspection-tables-system.plan.md`.
 */
export { analyzeTemplate, type LayoutIssue, type LayoutIssueCode, type TemplateLayout, type TemplateRowCell } from './analyze'
export { builtInTemplates, type BuiltInTemplate } from './builtIn'
export { formatSpec, formatTolerance, type InspectionReportRow } from './format'
export { sha256Hex, specFingerprint } from './fingerprint'
export {
  generateInspectionReport,
  InspectionTemplateError,
  type DrawingPageImage,
  type InspectionReportInput,
} from './generate'
export { rasterizePdf } from './rasterizePdf'
export {
  readReturnedResults,
  type ReturnedIssue,
  type ReturnedIssueCode,
  type ReturnedResults,
  type ReturnedResultsExpectation,
  type ReturnedRow,
  type TamperReason,
} from './results'
export { DEFAULT_FIELD_CAPTIONS, ROW_FIELDS, SCALAR_NAMES, type RowField, type ScalarName } from './tokens'
export { computeVerdict, limitsOf, parseVerdictText, summarizeResults, type ResultsSummary, type Verdict } from './verdict'
