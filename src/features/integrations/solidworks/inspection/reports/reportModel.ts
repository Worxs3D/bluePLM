/**
 * Pure pieces of the inspection reports UI: report numbers, grouping by drawing version, the
 * stored shape of returned results, permissions and file names. No store, no Supabase, no React,
 * so it is unit-tested directly (`reportModel.test.ts`).
 */
import type { BadgeTone } from '@/components/core/ui'
import {
  formatSpec,
  type InspectionReportRow,
  type ReturnedResults,
  type Verdict,
} from '@/lib/inspection/excel'
import type { Json } from '@/types/supabase'
import { reportTypeCode, templateServes } from '@/lib/inspection/reportTypes'
import type {
  InspectionReport,
  InspectionReportStatus,
  InspectionReportType,
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

/**
 * Default report number pattern: `BR-103849-201_RevA_FAIR`, `..._PIR`. The part, revision and type
 * already say which report it is (the version is in the report's history), so there is no counter:
 * a second report with the same number becomes `..._PIR_2`, `..._PIR_3`. An organization's saved
 * pattern is kept as saved (5.5.0's default was `{partNumber}_Rev{rev}_IRv{n}`, 5.6.0's
 * `{partNumber}_Rev{rev}_{type}{n}`).
 */
export const DEFAULT_REPORT_NUMBER_PATTERN = '{partNumber}_Rev{rev}_{type}'

/** Tokens a report number pattern may use, in the order the settings list them. */
export const REPORT_NUMBER_TOKENS = [
  'partNumber',
  'rev',
  'version',
  'drawing',
  'type',
  'date',
  'n',
] as const
export type ReportNumberToken = (typeof REPORT_NUMBER_TOKENS)[number]

/** Where `{n}` counts: over every report of the drawing, or restarting for each revision. */
export type ReportSequenceScope = 'drawing' | 'revision'

/** The organization's report naming (`organization.settings.inspection_reports`), defaults applied. */
export interface ReportNaming {
  numberPattern: string
  sequenceScope: ReportSequenceScope
  includeLogo: boolean
  /** Characteristics of a production or receiving report when none are chosen. */
  lotScope: 'classified' | 'all'
  /** Parts per characteristic of a lot report generated without options. */
  defaultSampleSize: number
}

/** Parts per characteristic when the organization has not set one: a fixed sample of 5. */
export const DEFAULT_SAMPLE_SIZE = 5
/** Largest default sample size the settings accept. */
export const MAX_DEFAULT_SAMPLE_SIZE = 500

export const DEFAULT_REPORT_NAMING: ReportNaming = {
  numberPattern: DEFAULT_REPORT_NUMBER_PATTERN,
  sequenceScope: 'drawing',
  includeLogo: true,
  lotScope: 'classified',
  defaultSampleSize: DEFAULT_SAMPLE_SIZE,
}

/** Longest pattern kept; anything longer is cut (a report number is also a file name). */
export const MAX_PATTERN_LENGTH = 200
/** Longest report number produced. */
export const MAX_REPORT_NUMBER_LENGTH = 120

/** Read the stored setting; anything missing or malformed takes the default. */
export function reportNamingFromSettings(raw: unknown): ReportNaming {
  const value =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const pattern =
    typeof value.number_pattern === 'string'
      ? value.number_pattern.trim().slice(0, MAX_PATTERN_LENGTH)
      : ''
  return {
    numberPattern: pattern || DEFAULT_REPORT_NUMBER_PATTERN,
    sequenceScope: value.sequence_scope === 'revision' ? 'revision' : 'drawing',
    includeLogo: value.include_logo !== false,
    lotScope: value.lot_characteristics === 'all' ? 'all' : 'classified',
    defaultSampleSize:
      typeof value.default_sample_size === 'number' &&
      Number.isInteger(value.default_sample_size) &&
      value.default_sample_size >= 1 &&
      value.default_sample_size <= MAX_DEFAULT_SAMPLE_SIZE
        ? value.default_sample_size
        : DEFAULT_SAMPLE_SIZE,
  }
}

/** Whether the pattern numbers its reports (`{n}`); without it a suffix keeps numbers unique. */
export function patternHasSequence(pattern: string): boolean {
  return /\{n\}/i.test(pattern)
}

/** Whether the pattern names the report type (`{type}`); then `{n}` counts per type. */
export function patternHasType(pattern: string): boolean {
  return /\{type\}/i.test(pattern)
}

/** Tokens in the pattern that are not known (shown as a warning in the settings). */
export function unknownPatternTokens(pattern: string): string[] {
  const known = new Set<string>(REPORT_NUMBER_TOKENS.map((tok) => tok.toLowerCase()))
  const out: string[] = []
  for (const match of pattern.matchAll(/\{([^{}]*)\}/g)) {
    const name = match[1].trim()
    if (!known.has(name.toLowerCase()) && !out.includes(name)) out.push(name)
  }
  return out
}

export type ReportNumberValues = Record<ReportNumberToken, string>

/** `YYYY-MM-DD` in local time, for `{date}`. */
export function reportDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Fill a report number pattern. Token values lose characters a file name cannot hold; unknown
 * tokens stay as typed (minus braces). The result is safe as a file name, with runs of `_` from
 * empty values collapsed, and never empty.
 */
export function formatReportNumber(pattern: string, values: ReportNumberValues): string {
  const byName = new Map<string, string>(
    REPORT_NUMBER_TOKENS.map((tok) => [tok.toLowerCase(), numberSegment(values[tok])]),
  )
  const filled = (pattern || DEFAULT_REPORT_NUMBER_PATTERN).replace(
    /\{([^{}]*)\}/g,
    (_all, name: string) => {
      const known = byName.get(name.trim().toLowerCase())
      return known ?? name
    },
  )
  const cleaned = Array.from(filled)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, MAX_REPORT_NUMBER_LENGTH)
  return cleaned || values.n || '1'
}

/** A trailing `IR<n>` / `IRv<n>` of a report number from before `sequence` was stored. */
const LEGACY_SEQUENCE = /[-_]IRv?(\d+)$/i

/** A report's place in its drawing's sequence: the stored `sequence`, else parsed from the number. */
export function reportSequence(report: {
  reportNumber: string | null
  sequence?: number | null
}): number | null {
  if (typeof report.sequence === 'number' && Number.isFinite(report.sequence))
    return report.sequence
  const match = report.reportNumber ? LEGACY_SEQUENCE.exec(report.reportNumber.trim()) : null
  return match ? Number(match[1]) : null
}

function sameRevision(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

/**
 * `{n}` of the next report: one more than the highest sequence in scope. Scope `drawing` counts
 * every report of the drawing; `revision` only reports of versions with the same revision (a
 * report whose version is unknown is left out, so its number is never assumed).
 */
export function nextReportSequence(
  reports: ReadonlyArray<{
    reportNumber: string | null
    sequence?: number | null
    fileVersionId: string
    reportType?: InspectionReportType | null
  }>,
  scope: ReportSequenceScope,
  revision: string | null | undefined,
  revisionOfVersion: ReadonlyMap<string, string | null>,
  /** Count only reports of this type (a pattern with `{type}`); undefined counts every report. */
  perType?: InspectionReportType | null,
): number {
  let highest = 0
  for (const report of reports) {
    if (perType !== undefined && (report.reportType ?? null) !== perType) continue
    if (scope === 'revision') {
      if (!revisionOfVersion.has(report.fileVersionId)) continue
      if (!sameRevision(revisionOfVersion.get(report.fileVersionId), revision)) continue
    }
    const n = reportSequence(report)
    if (n !== null) highest = Math.max(highest, n)
  }
  return highest + 1
}

/**
 * The next report number and its sequence. Report numbers are unique per drawing (and are file
 * names), so a number another report already has moves on to the next `n`. A pattern without `{n}`
 * keeps its plain number while it is free, then gets `_2`, `_3`, ... counted on that number alone,
 * so `RevC_PIR` follows `RevB_PIR_3` instead of jumping to the drawing-wide count. Bounded by the
 * number of reports.
 */
export function nextReportName(
  pattern: string,
  values: Omit<ReportNumberValues, 'n'>,
  startSequence: number,
  existingNumbers: ReadonlyArray<string | null>,
): { reportNumber: string; sequence: number } {
  const taken = new Set(existingNumbers.filter((n): n is string => !!n).map((n) => n.toLowerCase()))
  const hasN = patternHasSequence(pattern)
  if (!hasN) {
    const base = formatReportNumber(pattern, { ...values, n: String(startSequence) })
    if (!taken.has(base.toLowerCase())) return { reportNumber: base, sequence: startSequence }
    for (let k = 2; k <= taken.size + 2; k++) {
      const candidate = `${base}_${k}`
      if (!taken.has(candidate.toLowerCase()))
        return { reportNumber: candidate, sequence: startSequence }
    }
  }
  const limit = startSequence + taken.size + 1
  for (let n = startSequence; n <= limit; n++) {
    const base = formatReportNumber(pattern, { ...values, n: String(n) })
    const candidate =
      hasN || (n === startSequence && !taken.has(base.toLowerCase())) ? base : `${base}_${n}`
    if (!taken.has(candidate.toLowerCase())) return { reportNumber: candidate, sequence: n }
  }
  // Unreachable: more candidates were tried than numbers exist.
  const n = limit + 1
  return {
    reportNumber: `${formatReportNumber(pattern, { ...values, n: String(n) })}_${n}`,
    sequence: n,
  }
}

// ---------------------------------------------------------------------------
// Part number, description and revision of a report
// ---------------------------------------------------------------------------

export interface ReportIdentity {
  partNumber: string | null
  description: string | null
  revision: string | null
}

function filled(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  return v ? v : null
}

/**
 * Each field from the first source that has it: the drawing version, then the file's current row,
 * then the model the drawing references at that version. Blank stays blank (never guessed).
 */
export function resolveReportIdentity(
  ...sources: ReadonlyArray<Partial<ReportIdentity> | null | undefined>
): ReportIdentity {
  const pick = (key: keyof ReportIdentity): string | null => {
    for (const source of sources) {
      const v = filled(source?.[key])
      if (v) return v
    }
    return null
  }
  return {
    partNumber: pick('partNumber'),
    description: pick('description'),
    revision: pick('revision'),
  }
}

/** Whether a later source is needed for any field. */
export function identityIncomplete(identity: ReportIdentity): boolean {
  return !identity.partNumber || !identity.description || !identity.revision
}

/** Values of the report number tokens. Part number falls back to the drawing's base name. */
export function reportNumberValues(
  identity: ReportIdentity,
  drawingName: string,
  version: number,
  date: Date,
  reportType: InspectionReportType | null = null,
): Omit<ReportNumberValues, 'n'> {
  const drawing = drawingName.replace(/\.[^.]+$/, '')
  return {
    partNumber: identity.partNumber || drawing || 'DRAWING',
    rev: identity.revision ?? '',
    version: String(version),
    drawing,
    type: reportTypeCode(reportType),
    date: reportDate(date),
  }
}

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------

/** The newest checked-in version, when it is newer than the report's own. */
export function newerVersionThan(
  report: Pick<InspectionReport, 'fileVersionId'>,
  versions: readonly VersionInfo[],
): VersionInfo | null {
  const own = versions.find((v) => v.id === report.fileVersionId)
  const latest = versions.reduce<VersionInfo | null>(
    (best, v) => (!best || v.version > best.version ? v : best),
    null,
  )
  if (!latest || latest.id === report.fileVersionId) return null
  if (own && latest.version <= own.version) return null
  return latest
}

/**
 * The template a regenerate uses: the report's organization template at its current revision when
 * it is still live, else a built-in of the same name, else the default.
 */
export function regenerateTemplateChoice(
  report: Pick<InspectionReport, 'templateId' | 'templateName'> & {
    reportType?: InspectionReportType | null
  },
  choices: readonly TemplateChoice[],
): TemplateChoice | null {
  if (report.templateId) {
    const same = choices.find((c) => c.kind === 'org' && c.template.id === report.templateId)
    if (same) return same
  } else if (report.templateName) {
    const same = choices.find((c) => c.kind === 'builtin' && c.name === report.templateName)
    if (same) return same
  }
  return defaultTemplateChoice(choices, report.reportType ?? null)
}

/** Path of the report workbook next to a drawing: the drawing's folder, the report number as name. */
export function pathNextTo(drawingPath: string, fileName: string): string {
  const cut = Math.max(drawingPath.lastIndexOf('\\'), drawingPath.lastIndexOf('/'))
  if (cut < 0) return fileName
  return `${drawingPath.slice(0, cut + 1)}${fileName}`
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
  /** Who checked the version in (where read; a checked-out copy's report pins to its creator's). */
  createdBy?: string | null
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
    importResults:
      status === 'issued' || status === 'sent' || status === 'returned' || status === 'rejected',
    accept: status === 'returned' || status === 'rejected',
    reject: status === 'returned' || status === 'accepted',
  }
}

/** The one action a report's row offers beside Open: the step its status is waiting for. */
export type ReportNextStep = 'markSent' | 'importResults' | 'accept'

export function nextReportStep(status: InspectionReportStatus): ReportNextStep | null {
  if (status === 'issued') return 'markSent'
  if (status === 'sent') return 'importResults'
  if (status === 'returned') return 'accept'
  return null
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

export function reportFileName(
  report: Pick<InspectionReport, 'reportNumber' | 'title'>,
  returned = false,
): string {
  const base = safeFileName(report.reportNumber || report.title || 'inspection-report')
  return `${base}${returned ? '-returned' : ''}.xlsx`
}

// ---------------------------------------------------------------------------
// Templates offered for generation
// ---------------------------------------------------------------------------

export type TemplateChoice =
  | { kind: 'org'; template: InspectionTemplate }
  | {
      kind: 'builtin'
      key: string
      name: string
      reportTypes: readonly InspectionReportType[]
      defaultFor: readonly InspectionReportType[]
    }

export function templateChoiceId(choice: TemplateChoice): string {
  return choice.kind === 'org' ? `org:${choice.template.id}` : `builtin:${choice.key}`
}

/** A built-in as `templateChoices` takes it (no types: any type). */
export interface BuiltInChoiceInfo {
  key: string
  name: string
  reportTypes?: readonly InspectionReportType[]
  defaultFor?: readonly InspectionReportType[]
}

/** The organization's live templates (default first), then the built-ins. */
export function templateChoices(
  templates: readonly InspectionTemplate[],
  builtIns: ReadonlyArray<BuiltInChoiceInfo>,
): TemplateChoice[] {
  const live = templates
    .filter((t) => !t.archivedAt)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  return [
    ...live.map((template): TemplateChoice => ({ kind: 'org', template })),
    ...builtIns.map(
      (b): TemplateChoice => ({
        kind: 'builtin',
        key: b.key,
        name: b.name,
        reportTypes: b.reportTypes ?? [],
        defaultFor: b.defaultFor ?? [],
      }),
    ),
  ]
}

function choiceTypes(choice: TemplateChoice): {
  reportTypes: readonly InspectionReportType[]
  defaultFor: readonly InspectionReportType[]
} {
  return choice.kind === 'org' ? choice.template : choice
}

/** Whether a choice serves a report type (no types = any; a report with no type takes any). */
export function choiceServes(choice: TemplateChoice, type: InspectionReportType | null): boolean {
  return templateServes(choiceTypes(choice), type)
}

/**
 * The preselected template for a report type: the organization's default for the type, else its
 * general default when that serves the type (an organization's 5.5.0 default keeps being used),
 * else the built-in for the type, else any organization template for the type, else any choice
 * that serves it. With no type: the organization default, else the first organization template,
 * else the first built-in (5.5.0's rule).
 */
export function defaultTemplateChoice(
  choices: readonly TemplateChoice[],
  type: InspectionReportType | null = null,
): TemplateChoice | null {
  if (type === null) {
    return (
      choices.find((c) => c.kind === 'org' && c.template.isDefault) ??
      choices.find((c) => c.kind === 'org') ??
      choices[0] ??
      null
    )
  }
  return (
    choices.find((c) => c.kind === 'org' && c.template.defaultFor.includes(type)) ??
    choices.find((c) => c.kind === 'org' && c.template.isDefault && choiceServes(c, type)) ??
    choices.find((c) => c.kind === 'builtin' && c.defaultFor.includes(type)) ??
    choices.find((c) => c.kind === 'org' && c.template.reportTypes.includes(type)) ??
    choices.find((c) => choiceServes(c, type)) ??
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

/**
 * `/1`: 5.4 and 5.5 (every row of the version). `/2`: 5.6, written on typed reports, whose rows are
 * the report's own characteristics; the database refuses any other format on a typed report, so a
 * 5.5.0 client cannot record whole-version results on one.
 */
export type StoredResultsFormat = 'blueplm-inspection-results/1' | 'blueplm-inspection-results/2'

export interface StoredResults {
  format: StoredResultsFormat
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
  /** The report has a type (schema 506): stored as `/2`. */
  typed = false,
): StoredResults {
  const byId = new Map(expectedRows.map((r) => [r.id, r]))
  const byKey = new Map(
    expectedRows.filter((r) => r.source_key).map((r) => [r.source_key as string, r]),
  )
  const matched = new Set<string>()
  const rows: StoredResultRow[] = returned.rows.map((r) => {
    const exp =
      (r.rowId ? byId.get(r.rowId) : undefined) ??
      (r.sourceKey ? byKey.get(r.sourceKey) : undefined)
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
  const missing = expectedRows.filter((r) => !matched.has(r.id)).map((r) => r.balloon_number ?? '')
  return {
    format: typed ? 'blueplm-inspection-results/2' : 'blueplm-inspection-results/1',
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
  const format = isRecord(json) ? json.format : null
  if (
    !isRecord(json) ||
    (format !== 'blueplm-inspection-results/1' && format !== 'blueplm-inspection-results/2') ||
    !Array.isArray(json.rows)
  ) {
    return null
  }
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
    format,
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
  /**
   * `not_a_report`: no readable BluePLM report; `other_version`: generated for another drawing or
   * version; `other_selection`: another report of the version, with other characteristics (or
   * other parts per characteristic) than this report includes.
   */
  reason: 'not_a_report' | 'other_version' | 'other_selection' | null
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
  report: Pick<InspectionReport, 'id' | 'fileId' | 'fileVersionId'> & {
    characteristicIds?: readonly string[] | null
  },
  parsed: Pick<ReturnedResults, 'reportId' | 'fileId' | 'fileVersionId' | 'warnings'> & {
    rows?: ReadonlyArray<{ rowId: string | null }>
  },
  /** Row ids the report's workbook holds (`reportWorkbookRows`), when known. */
  expectedRowIds?: readonly string[],
): ImportVerdict {
  if (parsed.warnings.some((w) => UNREADABLE_CODES.has(w.code))) {
    return { blocked: true, reason: 'not_a_report', reportIdMismatch: false }
  }
  const reportIdMismatch = parsed.reportId !== report.id
  if (parsed.fileId !== report.fileId || parsed.fileVersionId !== report.fileVersionId) {
    return { blocked: true, reason: 'other_version', reportIdMismatch }
  }
  // Another report of the same version may be recorded only when it holds the same rows: the
  // results are graded per row, and a row this report does not include would be recorded on it.
  if (reportIdMismatch && expectedRowIds && parsed.rows) {
    const expected = new Set(expectedRowIds)
    const got = new Set(parsed.rows.map((r) => r.rowId).filter((id): id is string => !!id))
    const same = got.size === expected.size && [...got].every((id) => expected.has(id))
    if (!same) return { blocked: true, reason: 'other_selection', reportIdMismatch }
  }
  return { blocked: false, reason: null, reportIdMismatch }
}

// ---------------------------------------------------------------------------
// Generate checks
// ---------------------------------------------------------------------------

export interface WorkingCopyState {
  /** The drawing is checked out by the signed-in user. */
  checkedOutByMe: boolean
  /** The local drawing differs from the checked-in version. */
  modified: boolean
  /** Rows in the live inspection table, or null when unknown. */
  liveRows: number | null
  /** Rows the version the report is built from has. */
  versionRows: number
}

/**
 * Whether the user has drawing or inspection-table changes that the checked-in version does not
 * hold: the report is built from the version, so they are not in it.
 */
export function hasChangesNotCheckedIn(state: WorkingCopyState): boolean {
  if (!state.checkedOutByMe) return false
  return state.modified || (state.liveRows !== null && state.liveRows !== state.versionRows)
}
