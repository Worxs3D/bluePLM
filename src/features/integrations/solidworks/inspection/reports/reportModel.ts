/**
 * Pure pieces of the inspection reports UI: report numbers, grouping by drawing version, the
 * stored shape of returned results, permissions and file names. No store, no Supabase, no React,
 * so it is unit-tested directly (`reportModel.test.ts`).
 */
import type { BadgeTone } from '@/components/core/ui'
import { formatSpec, type InspectionReportRow, type ReturnedResults, type Verdict } from '@/lib/inspection/excel'
import type { Json } from '@/types/supabase'
import type {
  InspectionReport,
  InspectionReportStatus,
  InspectionResultsSummary,
  InspectionTemplate,
} from '@/types/inspectionReports'

// ---------------------------------------------------------------------------
// Report numbers
// ---------------------------------------------------------------------------

/** Characters kept in a report number segment; anything else becomes `_`. */
function numberSegment(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const IR_SUFFIX = /-IR(\d+)$/i

/**
 * The next report number of a drawing: `<part>-<rev>-IR<n>`, where n is one more than the highest
 * `IR<n>` any report of the drawing already carries (so numbers never repeat, whatever the
 * revision). Falls back to the drawing name when the version has no part number.
 */
export function nextReportNumber(
  partNumber: string | null | undefined,
  revision: string | null | undefined,
  drawingName: string,
  existingNumbers: ReadonlyArray<string | null>,
): string {
  const part = numberSegment(partNumber) || numberSegment(drawingName.replace(/\.[^.]+$/, '')) || 'DRAWING'
  const rev = numberSegment(revision)
  let highest = 0
  for (const number of existingNumbers) {
    const match = number ? IR_SUFFIX.exec(number) : null
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${part}${rev ? `-${rev}` : ''}-IR${highest + 1}`
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface VersionInfo {
  id: string
  version: number
  revision: string | null
  partNumber: string | null
  description: string | null
  createdAt: string | null
}

export interface ReportVersionGroup {
  fileVersionId: string
  /** null when the version is not in the loaded version list. */
  version: number | null
  revision: string | null
  reports: InspectionReport[]
}

/** Reports grouped by drawing version, newest version first; newest report first inside a group. */
export function groupReportsByVersion(
  reports: readonly InspectionReport[],
  versions: readonly VersionInfo[],
): ReportVersionGroup[] {
  const byId = new Map(versions.map((v) => [v.id, v]))
  const groups = new Map<string, ReportVersionGroup>()
  for (const report of reports) {
    let group = groups.get(report.fileVersionId)
    if (!group) {
      const v = byId.get(report.fileVersionId)
      group = {
        fileVersionId: report.fileVersionId,
        version: v?.version ?? null,
        revision: v?.revision ?? null,
        reports: [],
      }
      groups.set(report.fileVersionId, group)
    }
    group.reports.push(report)
  }
  const out = [...groups.values()]
  for (const g of out) g.reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  out.sort((a, b) => (b.version ?? -1) - (a.version ?? -1))
  return out
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function statusTone(status: InspectionReportStatus): BadgeTone {
  switch (status) {
    case 'issued':
      return 'neutral'
    case 'sent':
      return 'info'
    case 'returned':
      return 'warning'
    case 'accepted':
      return 'success'
    case 'rejected':
      return 'error'
  }
}

/** i18n key of a status label. */
export function statusKey(status: InspectionReportStatus): string {
  return `source.inspection.rptStatus_${status}`
}

/** Whether the user may delete a report: its creator or an administrator (the database decides too). */
export function canDeleteReport(
  report: Pick<InspectionReport, 'createdBy'>,
  userId: string | null | undefined,
  isAdmin: boolean,
): boolean {
  return isAdmin || (!!userId && report.createdBy === userId)
}

export interface ReportActions {
  markSent: boolean
  importResults: boolean
  accept: boolean
  reject: boolean
}

/** Which status actions make sense for a report in its status. */
export function reportActions(status: InspectionReportStatus): ReportActions {
  return {
    markSent: status === 'issued',
    importResults: status === 'issued' || status === 'sent' || status === 'returned' || status === 'rejected',
    accept: status === 'returned' || status === 'rejected',
    reject: status === 'returned' || status === 'accepted',
  }
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

/** A file name safe on Windows, macOS and in a browser download. */
export function safeFileName(name: string, fallback = 'inspection-report'): string {
  const cleaned = Array.from(name)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
  return cleaned || fallback
}

export function reportFileName(report: Pick<InspectionReport, 'reportNumber' | 'title'>, returned = false): string {
  const base = safeFileName(report.reportNumber || report.title || 'inspection-report')
  return `${base}${returned ? '-returned' : ''}.xlsx`
}

// ---------------------------------------------------------------------------
// Templates offered for generation
// ---------------------------------------------------------------------------

export type TemplateChoice =
  | { kind: 'org'; template: InspectionTemplate }
  | { kind: 'builtin'; key: string; name: string }

export function templateChoiceId(choice: TemplateChoice): string {
  return choice.kind === 'org' ? `org:${choice.template.id}` : `builtin:${choice.key}`
}

/** The organization's live templates (default first), then the built-ins. */
export function templateChoices(
  templates: readonly InspectionTemplate[],
  builtIns: ReadonlyArray<{ key: string; name: string }>,
): TemplateChoice[] {
  const live = templates
    .filter((t) => !t.archivedAt)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  return [
    ...live.map((template): TemplateChoice => ({ kind: 'org', template })),
    ...builtIns.map((b): TemplateChoice => ({ kind: 'builtin', key: b.key, name: b.name })),
  ]
}

/** The preselected template: the org default, else the first org template, else the first built-in. */
export function defaultTemplateChoice(choices: readonly TemplateChoice[]): TemplateChoice | null {
  return (
    choices.find((c) => c.kind === 'org' && c.template.isDefault) ??
    choices.find((c) => c.kind === 'org') ??
    choices[0] ??
    null
  )
}

// ---------------------------------------------------------------------------
// Returned results as stored in inspection_report.results
// ---------------------------------------------------------------------------

export interface StoredResultRow {
  rowId: string | null
  sourceKey: string | null
  balloon: string | null
  /** Requirement text at import (`25.40 ±0.10`), from the version's snapshot row. */
  requirement: string
  measured: string[]
  inputs: Record<string, string>
  enteredVerdict: string
  verdict: Verdict | null
  verdictConflict: boolean
  tampered: boolean
  /** No characteristic of the version matches the row. */
  unknown: boolean
}

export interface StoredResults {
  format: 'blueplm-inspection-results/1'
  entries: Record<string, string>
  rows: StoredResultRow[]
  /** Balloons of characteristics the workbook had no row for. */
  missing: string[]
  warnings: string[]
}

function balloonOrder(a: string | null, b: string | null): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && a !== null && b !== null) return na - nb
  return (a ?? '').localeCompare(b ?? '', undefined, { numeric: true })
}

/** The JSON stored with a report after an import, built from the reader's output and the version's rows. */
export function toStoredResults(
  returned: ReturnedResults,
  expectedRows: readonly InspectionReportRow[],
): StoredResults {
  const byId = new Map(expectedRows.map((r) => [r.id, r]))
  const byKey = new Map(expectedRows.filter((r) => r.source_key).map((r) => [r.source_key as string, r]))
  const matched = new Set<string>()
  const rows: StoredResultRow[] = returned.rows.map((r) => {
    const exp = (r.rowId ? byId.get(r.rowId) : undefined) ?? (r.sourceKey ? byKey.get(r.sourceKey) : undefined)
    if (exp) matched.add(exp.id)
    return {
      rowId: r.rowId,
      sourceKey: r.sourceKey,
      balloon: r.balloon ?? exp?.balloon_number ?? null,
      requirement: exp ? formatSpec(exp) : '',
      measured: r.measured,
      inputs: r.inputs,
      enteredVerdict: r.enteredVerdictText,
      verdict: r.verdict,
      verdictConflict: r.verdictConflict,
      tampered: r.tampered,
      unknown: !exp,
    }
  })
  rows.sort((a, b) => balloonOrder(a.balloon, b.balloon))
  const missing = expectedRows
    .filter((r) => !matched.has(r.id))
    .map((r) => r.balloon_number ?? '')
  return {
    format: 'blueplm-inspection-results/1',
    entries: returned.entries,
    rows,
    missing,
    warnings: [...new Set(returned.warnings.map((w) => w.code))],
  }
}

/** Results summary from stored rows (pass / fail / blank over the rows that match a characteristic). */
export function summarizeStored(results: StoredResults): InspectionResultsSummary {
  const summary = { total: 0, pass: 0, fail: 0, blank: 0 }
  for (const row of results.rows) {
    if (row.unknown) continue
    summary.total++
    if (row.verdict === 'pass') summary.pass++
    else if (row.verdict === 'fail') summary.fail++
    else summary.blank++
  }
  summary.total += results.missing.length
  summary.blank += results.missing.length
  return summary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v
  return out
}

/** Read `inspection_report.results` back; null when it is absent or not in the known shape. */
export function parseStoredResults(json: Json | null): StoredResults | null {
  if (!isRecord(json) || json.format !== 'blueplm-inspection-results/1' || !Array.isArray(json.rows)) return null
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const rows: StoredResultRow[] = (json.rows as unknown[]).filter(isRecord).map((r) => ({
    rowId: str(r.rowId),
    sourceKey: str(r.sourceKey),
    balloon: str(r.balloon),
    requirement: str(r.requirement) ?? '',
    measured: Array.isArray(r.measured) ? r.measured.map((m) => String(m ?? '')) : [],
    inputs: stringRecord(r.inputs),
    enteredVerdict: str(r.enteredVerdict) ?? '',
    verdict: r.verdict === 'pass' || r.verdict === 'fail' ? r.verdict : null,
    verdictConflict: r.verdictConflict === true,
    tampered: r.tampered === true,
    unknown: r.unknown === true,
  }))
  return {
    format: 'blueplm-inspection-results/1',
    entries: stringRecord(json.entries),
    rows,
    missing: Array.isArray(json.missing) ? json.missing.map((m) => String(m ?? '')) : [],
    warnings: Array.isArray(json.warnings) ? json.warnings.map((w) => String(w ?? '')) : [],
  }
}

/** Results JSON as the database column takes it. */
export function storedResultsJson(results: StoredResults): Json {
  return JSON.parse(JSON.stringify(results)) as Json
}

// ---------------------------------------------------------------------------
// Whether a returned workbook may be recorded on a report
// ---------------------------------------------------------------------------

export interface ImportVerdict {
  /** Recording is refused. */
  blocked: boolean
  /** `not_a_report`: no readable BluePLM report; `other_version`: generated for another drawing or version. */
  reason: 'not_a_report' | 'other_version' | null
  /** Same drawing version, another report of it: may be recorded with a warning. */
  reportIdMismatch: boolean
}

const UNREADABLE_CODES = new Set(['NOT_A_REPORT', 'UNKNOWN_FORMAT', 'TABLE_SHEET_MISSING'])

/**
 * A workbook generated for another drawing or drawing version is never recorded: its
 * measurements would be graded against requirements they were not taken for. A workbook of
 * another report of the same version (same requirements) may be recorded, with a warning.
 */
export function importVerdict(
  report: Pick<InspectionReport, 'id' | 'fileId' | 'fileVersionId'>,
  parsed: Pick<ReturnedResults, 'reportId' | 'fileId' | 'fileVersionId' | 'warnings'>,
): ImportVerdict {
  if (parsed.warnings.some((w) => UNREADABLE_CODES.has(w.code))) {
    return { blocked: true, reason: 'not_a_report', reportIdMismatch: false }
  }
  if (parsed.fileId !== report.fileId || parsed.fileVersionId !== report.fileVersionId) {
    return { blocked: true, reason: 'other_version', reportIdMismatch: parsed.reportId !== report.id }
  }
  return { blocked: false, reason: null, reportIdMismatch: parsed.reportId !== report.id }
}
