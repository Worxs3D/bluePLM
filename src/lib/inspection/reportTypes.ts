/**
 * Inspection report types (schema 506): which type a new report defaults to, which
 * characteristics each type includes, how many parts each characteristic is measured on, and how a
 * report with one row per sampled part is laid out and read back. Pure, unit-tested in
 * `reportTypes.test.ts`.
 *
 * Industry basis (`.cursor/plans/inspection-report-types-5.6.plan.md`):
 * - First article (SAE AS9102): a full FAI covers every characteristic of a new part; a partial
 *   (delta) FAI re-verifies the characteristics a change affected. BluePLM computes "affected" as
 *   the characteristics whose requirement differs from (or is absent in) the version the last FAI
 *   was done on, from the two versions' inspection snapshots. The user can adjust the set.
 * - Production and receiving inspect a lot by sampling and usually measure the classified (critical
 *   / major / key) characteristics. A characteristic's own inspection rate (supplier rate for
 *   production, internal rate for receiving), when set, decides over the classification: 0 leaves
 *   it out, any other rate puts it in. Its sample size only says how many parts, not whether.
 * - Sampling plans: every part (100%) or a fixed number of parts. ANSI/ASQ Z1.4 is not offered:
 *   its tables were not transcribed from the published standard, and no plan ships with guessed
 *   values.
 * - Re-inspection after a nonconformance covers only the characteristics the user names.
 */
import type { ReturnedResults, ReturnedRow } from './excel'
import type { InspectionReportRow } from './excel/format'
import { specFingerprint } from './excel/fingerprint'
import type { FaiReason, FaiScope, InspectionReportStatus, InspectionReportType, SamplingPlan } from '@/types/inspectionReports'

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** `{type}` of a report number: FAIR, PIR, RIR, RIN; a report with no type is IR. */
export const REPORT_TYPE_CODES: Readonly<Record<InspectionReportType, string>> = {
  fai: 'FAIR',
  production: 'PIR',
  receiving: 'RIR',
  reinspection: 'RIN',
}

export const LEGACY_REPORT_CODE = 'IR'

export function reportTypeCode(type: InspectionReportType | null | undefined): string {
  return type ? REPORT_TYPE_CODES[type] : LEGACY_REPORT_CODE
}

// ---------------------------------------------------------------------------
// Default type of a new report
// ---------------------------------------------------------------------------

export interface TypedReportRef {
  fileVersionId: string
  reportType: InspectionReportType | null
  faiScope?: FaiScope | null
  status: InspectionReportStatus
  createdAt: string
}

export interface VersionRef {
  id: string
  version: number
  revision: string | null
}

function sameRevision(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

/** An FAI that counts as done: any FAI report that was not rejected. */
function countsAsFai(report: TypedReportRef): boolean {
  return report.reportType === 'fai' && report.status !== 'rejected'
}

/**
 * The version a new FAI of `target` builds on: the newest version at or before `target` with an
 * accepted FAI, else with any FAI that was not rejected. Null when the drawing has had no FAI.
 */
export function faiBaseline(
  reports: readonly TypedReportRef[],
  versions: readonly VersionRef[],
  target: VersionRef,
): { version: VersionRef; accepted: boolean } | null {
  const byId = new Map(versions.map((v) => [v.id, v]))
  let best: { version: VersionRef; accepted: boolean } | null = null
  for (const report of reports) {
    if (!countsAsFai(report)) continue
    const v = byId.get(report.fileVersionId)
    if (!v || v.version > target.version) continue
    const accepted = report.status === 'accepted'
    const better =
      !best ||
      (accepted && !best.accepted) ||
      (accepted === best.accepted && v.version > best.version.version)
    if (better) best = { version: v, accepted }
  }
  return best
}

export interface DefaultReportType {
  type: 'fai' | 'production'
  faiScope: FaiScope | null
  faiReason: FaiReason | null
  baseline: VersionRef | null
}

/**
 * What Generate makes without asking: an FAI when the part's revision has had none (partial, with
 * reason "design change", when an earlier revision had one; full, "new part", when none ever did),
 * otherwise a production report. A report from before types on the revision counts as history (it
 * may well have been its first article), so that revision defaults to production too.
 */
export function defaultReportType(
  reports: readonly TypedReportRef[],
  versions: readonly VersionRef[],
  target: VersionRef,
): DefaultReportType {
  const byId = new Map(versions.map((v) => [v.id, v]))
  byId.set(target.id, target)
  const faiThisRevision = reports.some((r) => {
    if (!countsAsFai(r) && !(r.reportType === null && r.status !== 'rejected')) return false
    const v = byId.get(r.fileVersionId)
    return !!v && v.version <= target.version && sameRevision(v.revision, target.revision)
  })
  if (faiThisRevision) return { type: 'production', faiScope: null, faiReason: null, baseline: null }
  const baseline = faiBaseline(reports, versions, target)
  return baseline
    ? { type: 'fai', faiScope: 'partial', faiReason: 'design_change', baseline: baseline.version }
    : { type: 'fai', faiScope: 'full', faiReason: 'new_part', baseline: null }
}

// ---------------------------------------------------------------------------
// Characteristic selection
// ---------------------------------------------------------------------------

/** Classifications production and receiving measure by default (case-insensitive). */
const CLASSIFIED = new Set(['critical', 'major', 'key'])

export function isClassified(row: Pick<InspectionReportRow, 'classification'>): boolean {
  return CLASSIFIED.has((row.classification ?? '').trim().toLowerCase())
}

/** Which characteristics a lot report includes when none are chosen: the classified ones, or all. */
export type LotCharacteristicScope = 'classified' | 'all'

function rowKey(row: InspectionReportRow): string | null {
  const key = (row.source_key ?? '').trim()
  if (key) return `k:${key}`
  const balloon = (row.balloon_number ?? '').trim()
  return balloon ? `b:${balloon}` : null
}

/** The requirement of a row, independent of its balloon number (renumbering changes no part). */
function requirementPrint(row: InspectionReportRow): string {
  return specFingerprint({ ...row, balloon_number: null })
}

/**
 * Carry chosen characteristics from one version to another: check-in gives every snapshot row a new
 * id, so each old row is found again by its drawing annotation, else its balloon number. Returns
 * the new ids (in the new version's order) and the balloons of rows that have no counterpart.
 */
export function mapCharacteristicIds(
  from: readonly InspectionReportRow[],
  ids: readonly string[],
  to: readonly InspectionReportRow[],
): { ids: string[]; unmapped: string[] } {
  const wanted = new Set(ids)
  const keys = new Set<string>()
  const unmapped: string[] = []
  const byKey = new Map<string, string>()
  for (const row of to) {
    const key = rowKey(row)
    if (key && !byKey.has(key)) byKey.set(key, row.id)
  }
  for (const row of from) {
    if (!wanted.has(row.id)) continue
    const key = rowKey(row)
    if (key && byKey.has(key)) keys.add(byKey.get(key) as string)
    else unmapped.push(row.balloon_number ?? row.id)
  }
  // Ids not among the old rows at all (the old snapshot is gone) cannot be carried either.
  const known = new Set(from.map((r) => r.id))
  for (const id of ids) if (!known.has(id)) unmapped.push(id)
  return { ids: to.filter((r) => keys.has(r.id)).map((r) => r.id), unmapped }
}

/**
 * Characteristics of `target` that a partial FAI re-verifies: those with no counterpart in
 * `baseline` (matched by drawing annotation, else by balloon number) and those whose requirement
 * (type, nominal, unit, tolerances, limits, tolerance source) differs. Returns target row ids.
 */
export function changedCharacteristics(
  baseline: readonly InspectionReportRow[],
  target: readonly InspectionReportRow[],
): string[] {
  const before = new Map<string, string>()
  for (const row of baseline) {
    const key = rowKey(row)
    if (key && !before.has(key)) before.set(key, requirementPrint(row))
  }
  return target
    .filter((row) => {
      const key = rowKey(row)
      if (!key) return true
      const was = before.get(key)
      return was === undefined || was !== requirementPrint(row)
    })
    .map((row) => row.id)
}

function rateOf(row: InspectionReportRow, type: InspectionReportType): number | null {
  const v = type === 'receiving' ? row.internal_inspection_rate : row.supplier_inspection_rate
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function ownSampleSize(row: InspectionReportRow): number | null {
  const v = row.sample_size
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null
}

export type SelectionNote =
  /** Partial FAI with no baseline version: it would compare against nothing. */
  | 'no_baseline'
  /** Lot report, classified scope, nothing classified: every characteristic is included. */
  | 'no_classified'
  /** Partial FAI with nothing changed since its baseline. */
  | 'none_changed'
  /** Re-inspection with no characteristic named. */
  | 'none_chosen'

export interface CharacteristicSelection {
  rows: InspectionReportRow[]
  /** Ids recorded on the report (`characteristic_ids`); null = every row of the version (full FAI). */
  ids: string[] | null
  note: SelectionNote | null
}

export interface SelectionInput {
  type: InspectionReportType
  faiScope?: FaiScope | null
  rows: readonly InspectionReportRow[]
  /** Partial FAI: `changedCharacteristics(...)`. */
  changedIds?: readonly string[]
  /** Lot reports: the organization's default scope. */
  scope?: LotCharacteristicScope
  /** The user's own choice, which replaces the computed set (any type but a full FAI). */
  chosenIds?: readonly string[] | null
}

/** Whether a lot report includes a row by its own settings and the scope. */
function lotIncludes(row: InspectionReportRow, type: InspectionReportType, scope: LotCharacteristicScope): boolean | null {
  const rate = rateOf(row, type)
  if (rate !== null) return rate > 0
  if (scope === 'all') return true
  return isClassified(row) ? true : null
}

/** The characteristics a report of `type` includes, in the version's order. */
export function selectCharacteristics(input: SelectionInput): CharacteristicSelection {
  const { type, rows } = input
  const pick = (ids: readonly string[]): InspectionReportRow[] => {
    const set = new Set(ids)
    return rows.filter((r) => set.has(r.id))
  }
  if (type === 'fai' && (input.faiScope ?? 'full') === 'full') {
    return { rows: [...rows], ids: null, note: null }
  }
  if (input.chosenIds) {
    const chosen = pick(input.chosenIds)
    const note: SelectionNote | null = chosen.length === 0 ? (type === 'fai' ? 'none_changed' : 'none_chosen') : null
    return { rows: chosen, ids: chosen.map((r) => r.id), note }
  }
  if (type === 'fai') {
    const changed = pick(input.changedIds ?? [])
    return { rows: changed, ids: changed.map((r) => r.id), note: changed.length === 0 ? 'none_changed' : null }
  }
  if (type === 'reinspection') return { rows: [], ids: [], note: 'none_chosen' }

  const scope = input.scope ?? 'classified'
  const decided = rows.map((r) => ({ row: r, include: lotIncludes(r, type, scope) }))
  let selected = decided.filter((d) => d.include === true).map((d) => d.row)
  let note: SelectionNote | null = null
  if (scope === 'classified' && selected.length === 0) {
    // Nothing classified and no characteristic says otherwise: measure everything not ruled out.
    selected = decided.filter((d) => d.include !== false).map((d) => d.row)
    note = 'no_classified'
  }
  return { rows: selected, ids: selected.map((r) => r.id), note }
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Most measurement rows a report with one row per sampled part may have (a workbook stays usable). */
export const MAX_MEASUREMENT_ROWS = 2000

/**
 * Parts one characteristic is measured on: its own sample size, else its inspection rate of the
 * lot (rounded up), else the report's plan (every part of the lot, or n). Never more than the lot.
 * Null when the plan is 100% and the lot size is not known.
 */
export function sampleCountFor(
  row: InspectionReportRow,
  type: InspectionReportType,
  plan: SamplingPlan,
  lotSize: number | null,
): number | null {
  const cap = (n: number) => (lotSize !== null ? Math.min(n, lotSize) : n)
  const own = ownSampleSize(row)
  if (own !== null) return cap(own)
  const rate = rateOf(row, type)
  if (rate !== null && rate > 0 && rate <= 100 && lotSize !== null) return Math.max(1, Math.ceil((lotSize * rate) / 100))
  if (plan.plan === '100') return lotSize
  return cap(plan.n)
}

export interface SamplePlanResult {
  /** Parts per characteristic, by row id. */
  counts: Map<string, number>
  /** The largest count (the template's sample columns, or the rows per characteristic). */
  max: number
  /** Measurement rows of a one-row-per-part layout. */
  total: number
}

export type SamplePlanError = 'lot_size_needed' | 'sample_larger_than_lot' | 'too_many_measurements'

/** Sample counts of a lot report's characteristics, or why the plan cannot be laid out. */
export function planSamples(
  rows: readonly InspectionReportRow[],
  type: InspectionReportType,
  plan: SamplingPlan,
  lotSize: number | null,
): SamplePlanResult | { error: SamplePlanError } {
  if (plan.plan === 'fixed' && lotSize !== null && plan.n > lotSize) return { error: 'sample_larger_than_lot' }
  const counts = new Map<string, number>()
  let max = 0
  let total = 0
  for (const row of rows) {
    const n = sampleCountFor(row, type, plan, lotSize)
    if (n === null) return { error: 'lot_size_needed' }
    counts.set(row.id, n)
    max = Math.max(max, n)
    total += n
  }
  if (total > MAX_MEASUREMENT_ROWS && max > 10) return { error: 'too_many_measurements' }
  return { counts, max: Math.max(1, max), total }
}

/** Separator of a per-sample row id: `<characteristic id>#<sample>`. Snapshot ids are UUIDs (no `#`). */
const SAMPLE_SEP = '#'

/**
 * The rows a lot report's workbook holds. Up to `maxColumns` parts: one row per characteristic,
 * `sample_size` set to its part count (the template's Parts column). Above it: one row per
 * characteristic and part, `sample` = `k / n`, id `<id>#<k>`.
 */
/**
 * The values each workbook row must hold before it can pass, by row id: a characteristic laid out
 * with one column per part needs one value per part it is measured on (capped by the template's
 * result columns); a row per part needs one. Rows not listed need one value (5.5.0's rule).
 */
export function expectedValuesPerRow(
  rows: readonly InspectionReportRow[],
  counts: ReadonlyMap<string, number>,
  maxColumns: number,
): Map<string, number> {
  const out = new Map<string, number>()
  const max = Math.max(0, ...counts.values())
  if (max > maxColumns) return out
  for (const row of rows) {
    const n = counts.get(row.id)
    if (n !== undefined && n > 1) out.set(row.id, Math.min(n, maxColumns))
  }
  return out
}

export function expandSampleRows(
  rows: readonly InspectionReportRow[],
  counts: ReadonlyMap<string, number>,
  maxColumns: number,
): InspectionReportRow[] {
  const max = Math.max(0, ...counts.values())
  if (max <= maxColumns) return rows.map((r) => ({ ...r, sample_size: counts.get(r.id) ?? r.sample_size }))
  const out: InspectionReportRow[] = []
  for (const row of rows) {
    const n = counts.get(row.id) ?? 1
    for (let k = 1; k <= n; k++) {
      out.push({ ...row, id: `${row.id}${SAMPLE_SEP}${k}`, sample_size: n, sample: `${k} / ${n}` })
    }
  }
  return out
}

/** The characteristic id of a workbook row id (`<id>#<k>` → `<id>`). */
export function baseRowId(id: string): string {
  const cut = id.indexOf(SAMPLE_SEP)
  return cut < 0 ? id : id.slice(0, cut)
}

function sampleIndex(id: string | null): number {
  if (!id) return 0
  const cut = id.indexOf(SAMPLE_SEP)
  return cut < 0 ? 0 : Number(id.slice(cut + 1)) || 0
}

/** Fail when any verdict failed; pass only when there are `expected` verdicts and all passed; else open. */
function foldVerdicts(verdicts: ReadonlyArray<'pass' | 'fail' | null>, expected: number): 'pass' | 'fail' | null {
  if (verdicts.includes('fail')) return 'fail'
  return verdicts.length >= expected && verdicts.every((v) => v === 'pass') ? 'pass' : null
}

/**
 * Fold a one-row-per-part workbook back to one row per characteristic: measured values in sample
 * order, verdict fail when any part failed, pass only when every expected part is there and
 * passed (`expectedParts`, by characteristic id: a part row deleted from the workbook leaves the
 * characteristic open), else open. Rows of a one-row-per-characteristic workbook pass through.
 */
export function collapseSampleRows(
  returned: ReturnedResults,
  expectedParts?: ReadonlyMap<string, number>,
): ReturnedResults {
  if (!returned.rows.some((r) => r.rowId?.includes(SAMPLE_SEP))) return returned
  const groups = new Map<string, ReturnedRow[]>()
  const order: string[] = []
  for (const row of returned.rows) {
    const key = row.rowId ? baseRowId(row.rowId) : `?${order.length}`
    const list = groups.get(key)
    if (list) list.push(row)
    else {
      groups.set(key, [row])
      order.push(key)
    }
  }
  const rows: ReturnedRow[] = order.map((key) => {
    const parts = [...(groups.get(key) ?? [])].sort((a, b) => sampleIndex(a.rowId) - sampleIndex(b.rowId))
    const first = parts[0]
    const expected = Math.max(parts.length, expectedParts?.get(key) ?? 0)
    const verdict = foldVerdicts(parts.map((p) => p.verdict), expected)
    const enteredVerdict = foldVerdicts(parts.map((p) => p.enteredVerdict), expected)
    const computedVerdict = foldVerdicts(parts.map((p) => p.computedVerdict), expected)
    const inputs: Record<string, string> = {}
    for (const p of parts) {
      for (const [name, value] of Object.entries(p.inputs)) {
        if (value === '') continue
        inputs[name] = inputs[name] ? `${inputs[name]}; ${value}` : value
      }
    }
    return {
      rowId: first.rowId ? baseRowId(first.rowId) : null,
      sourceKey: first.sourceKey,
      balloon: first.balloon,
      measured: parts.map((p) => p.measured[0] ?? ''),
      inputs,
      enteredVerdictText: parts.map((p) => p.enteredVerdictText).filter(Boolean).join(', '),
      enteredVerdict,
      computedVerdict,
      verdict,
      verdictConflict: parts.some((p) => p.verdictConflict),
      tampered: parts.some((p) => p.tampered),
      tamperReasons: [...new Set(parts.flatMap((p) => p.tamperReasons))],
    }
  })
  const warnings = returned.warnings.map((w) => (w.rowId ? { ...w, rowId: baseRowId(w.rowId) } : w))
  const seen = new Set<string>()
  const deduped = warnings.filter((w) => {
    const key = `${w.code}|${w.rowId ?? ''}|${w.detail ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const summary = { total: rows.length, pass: 0, fail: 0, blank: 0 }
  for (const row of rows) {
    if (row.verdict === 'pass') summary.pass++
    else if (row.verdict === 'fail') summary.fail++
    else summary.blank++
  }
  return { ...returned, rows, warnings: deduped, summary }
}

// ---------------------------------------------------------------------------
// Template choice per type
// ---------------------------------------------------------------------------

export interface TypedTemplateRef {
  reportTypes: readonly InspectionReportType[]
  defaultFor: readonly InspectionReportType[]
}

/** Whether a template serves a type (no types = any type). */
export function templateServes(template: TypedTemplateRef, type: InspectionReportType | null): boolean {
  return type === null || template.reportTypes.length === 0 || template.reportTypes.includes(type)
}
