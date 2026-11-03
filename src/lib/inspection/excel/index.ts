/**
 * Inspection report Excel engine: templates in, filled reports out, returned results back in.
 * exceljs and pdfjs-dist load lazily on first use. Plan: `.cursor/plans/inspection-tables-system.plan.md`.
 */
export { analyzeTemplate, type LayoutIssue, type LayoutIssueCode, type TemplateLayout, type TemplateRowCell } from './analyze'
export {
  buildBuiltInTemplate,
  builtInTemplateInfo,
  builtInTemplates,
  type BuiltInOptions,
  type BuiltInTemplate,
  type BuiltInTemplateInfo,
} from './builtIn'
export { MAX_SAMPLE_COLUMNS } from './builtInTypes'
export { formatSpec, formatTolerance, type InspectionReportRow } from './format'
export { sha256Hex, specFingerprint, SPEC_FIELDS } from './fingerprint'
export {
  generateInspectionReport,
  InspectionTemplateError,
  type DrawingPageImage,
  type InspectionReportInput,
  type ReportLogo,
} from './generate'
export { imageSize } from './place'
export { rasterizePdf, rasterScale } from './rasterizePdf'
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
