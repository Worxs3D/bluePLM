/**
 * Report types in the reports flow (5.6.0, schema 506): the request Generate makes, the template
 * scalars and entry values a type fills, the type columns recorded on the report, and the rows a
 * report's workbook holds (recomputed at import, so a returned workbook is checked against exactly
 * what was issued). Pure; the selection and sampling rules are `src/lib/inspection/reportTypes.ts`.
 */
import type { BadgeTone } from '@/components/core/ui'
import type { InspectionReportRow, ScalarName } from '@/lib/inspection/excel'
import {
  defaultReportType,
  expandSampleRows,
  expectedValuesPerRow,
  planSamples,
  type CharacteristicSelection,
  type LotCharacteristicScope,
  type SamplePlanError,
} from '@/lib/inspection/reportTypes'
import type {
  FaiReason,
  FaiScope,
  InspectionReport,
  InspectionReportType,
  InspectionReportTypeFields,
  SamplingPlan,
} from '@/types/inspectionReports'

import type { ReportNaming, VersionInfo } from './reportModel'

/** What a report is generated as. */
export interface ReportTypeRequest {
  reportType: InspectionReportType
  faiScope?: FaiScope | null
  faiReason?: FaiReason | null
  /** Partial FAI: the version whose FAI it builds on. */
  baseline?: VersionInfo | null
  lotNumber?: string | null
  lotSize?: number | null
  sampling?: SamplingPlan | null
  poNumber?: string | null
  supplierName?: string | null
  ncrReference?: string | null
  /** The user's own characteristic choice; replaces the computed set (not for a full FAI). */
  chosenIds?: readonly string[] | null
  /** Lot reports: which characteristics when none are chosen. */
  lotScope?: LotCharacteristicScope
}

export function isLotType(type: InspectionReportType | null | undefined): type is 'production' | 'receiving' {
  return type === 'production' || type === 'receiving'
}

/** i18n key of a type's name (`null`: a report from before types). */
export function reportTypeKey(type: InspectionReportType | null): string {
  return `source.inspection.rptType_${type ?? 'none'}`
}

/** i18n key of a type's short chip label (FAIR, PIR, ...). */
export function reportTypeChipKey(type: InspectionReportType | null): string {
  return `source.inspection.rptTypeChip_${type ?? 'none'}`
}

export function faiReasonKey(reason: FaiReason): string {
  return `source.inspection.rptFaiReason_${reason}`
}

/** Chip colour of a type. */
export function reportTypeTone(type: InspectionReportType | null): BadgeTone {
  switch (type) {
    case 'fai':
      return 'info'
    case 'production':
      return 'success'
    case 'receiving':
      return 'warning'
    case 'reinspection':
      return 'error'
    default:
      return 'neutral'
  }
}

/** What Generate makes with no dialog: FAI when this revision has had none, else production. */
export function defaultTypeRequest(
  reports: readonly InspectionReport[],
  versions: readonly VersionInfo[],
  target: VersionInfo,
  naming: Pick<ReportNaming, 'lotScope' | 'defaultSampleSize'>,
): ReportTypeRequest {
  const decided = defaultReportType(reports, versions, target)
  if (decided.type === 'fai') {
    const baseline = decided.baseline ? (versions.find((v) => v.id === decided.baseline?.id) ?? null) : null
    return { reportType: 'fai', faiScope: decided.faiScope, faiReason: decided.faiReason, baseline }
  }
  return {
    reportType: 'production',
    sampling: { plan: 'fixed', n: naming.defaultSampleSize },
    lotScope: naming.lotScope,
  }
}

/** The sampling plan a lot request uses (a fixed sample of the organization's default when none is given). */
export function requestSampling(request: ReportTypeRequest, defaultSampleSize: number): SamplingPlan {
  return request.sampling ?? { plan: 'fixed', n: defaultSampleSize }
}

/** Labels the workbook prints for a type (from `t()`; workbook content follows the app language). */
export interface TypeLabels {
  type: (type: InspectionReportType) => string
  faiScope: (scope: FaiScope) => string
  faiReason: (reason: FaiReason) => string
  baseline: (version: VersionInfo) => string
  sampling: (plan: SamplingPlan) => string
  scope: (selection: { count: number; total: number; type: InspectionReportType; scope: LotCharacteristicScope | 'chosen' | 'changed' }) => string
}

export interface TypeFillContext {
  selection: CharacteristicSelection
  /** Characteristics of the version (for "5 of 25"). */
  totalRows: number
  /** Largest parts-per-characteristic (lot reports). */
  samples: number | null
  labels: TypeLabels
}

/** Template scalars of a type; blank for what the type does not have. */
export function typeScalars(request: ReportTypeRequest, ctx: TypeFillContext): Partial<Record<ScalarName, string>> {
  const { labels } = ctx
  const type = request.reportType
  const scope: LotCharacteristicScope | 'chosen' | 'changed' = request.chosenIds
    ? 'chosen'
    : type === 'fai' && request.faiScope === 'partial'
      ? 'changed'
      : (request.lotScope ?? 'classified')
  return {
    REPORT_TYPE: labels.type(type),
    FAI_TYPE: type === 'fai' && request.faiScope ? labels.faiScope(request.faiScope) : '',
    FAI_REASON: type === 'fai' && request.faiReason ? labels.faiReason(request.faiReason) : '',
    FAI_BASELINE: type === 'fai' && request.faiScope === 'partial' && request.baseline ? labels.baseline(request.baseline) : '',
    LOT_NUMBER: isLotType(type) ? (request.lotNumber ?? '').trim() : '',
    LOT_SIZE: isLotType(type) && request.lotSize ? String(request.lotSize) : '',
    SAMPLING_PLAN: isLotType(type) && request.sampling ? labels.sampling(request.sampling) : '',
    SAMPLE_SIZE: isLotType(type) && ctx.samples !== null ? String(ctx.samples) : '',
    CHARACTERISTIC_SCOPE:
      type === 'fai' && request.faiScope !== 'partial'
        ? labels.scope({ count: ctx.selection.rows.length, total: ctx.totalRows, type, scope: 'all' })
        : labels.scope({ count: ctx.selection.rows.length, total: ctx.totalRows, type, scope }),
    PO_NUMBER: type === 'receiving' ? (request.poNumber ?? '').trim() : '',
    SUPPLIER: type === 'receiving' ? (request.supplierName ?? '').trim() : '',
    NCR_REFERENCE: type === 'reinspection' ? (request.ncrReference ?? '').trim() : '',
  }
}

/**
 * `{{ENTRY:...}}` cells the report already knows: written in, still editable by the recipient.
 * `fai_reason` serves the 5.5.0 first article starter, whose reason is an entry.
 */
export function typeEntryValues(request: ReportTypeRequest, labels: Pick<TypeLabels, 'faiReason'>): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (name: string, value: string | null | undefined) => {
    const v = (value ?? '').trim()
    if (v) out[name] = v
  }
  if (request.reportType === 'fai' && request.faiReason) put('fai_reason', labels.faiReason(request.faiReason))
  if (isLotType(request.reportType)) put('lot_number', request.lotNumber)
  if (request.reportType === 'receiving') {
    put('purchase_order', request.poNumber)
    put('supplier', request.supplierName)
  }
  return out
}

/** The type columns recorded on the report. */
export function typeFieldsForRecord(
  request: ReportTypeRequest,
  selection: CharacteristicSelection,
): Partial<InspectionReportTypeFields> {
  const type = request.reportType
  const lot = isLotType(type)
  const text = (v: string | null | undefined) => (v ?? '').trim() || null
  return {
    reportType: type,
    faiScope: type === 'fai' ? (request.faiScope ?? 'full') : null,
    faiReason: type === 'fai' ? (request.faiReason ?? null) : null,
    faiBaselineVersionId: type === 'fai' && request.faiScope === 'partial' ? (request.baseline?.id ?? null) : null,
    lotNumber: lot ? text(request.lotNumber) : null,
    lotSize: lot ? (request.lotSize ?? null) : null,
    sampling: lot ? (request.sampling ?? null) : null,
    poNumber: type === 'receiving' ? text(request.poNumber) : null,
    supplierName: type === 'receiving' ? text(request.supplierName) : null,
    ncrReference: type === 'reinspection' ? text(request.ncrReference) : null,
    characteristicIds: selection.ids,
  }
}

/** The version rows a report includes (its recorded set, else all). */
export function includedRows(
  report: Pick<InspectionReport, 'characteristicIds'>,
  rows: readonly InspectionReportRow[],
): InspectionReportRow[] {
  if (!report.characteristicIds) return [...rows]
  const set = new Set(report.characteristicIds)
  return rows.filter((r) => set.has(r.id))
}

export interface WorkbookLayout {
  rows: InspectionReportRow[]
  /** Largest parts-per-characteristic (lot reports), else null. */
  samples: number | null
  /** Parts per characteristic, by characteristic id (lot reports). */
  counts: Map<string, number>
  /** Values a workbook row needs before it can pass, by row id (`readReturnedResults`). */
  expectedValues: Map<string, number>
}

/**
 * The rows the workbook of a report holds, from its included rows: a lot report's rows carry their
 * parts per characteristic, or become one row per part above `maxColumns` (the template's result
 * columns, at most 10; recorded on the report as `sampleColumns`). Deterministic, so the import
 * rebuilds exactly what generation wrote.
 */
export function workbookRows(
  report: Pick<InspectionReportTypeFields, 'reportType' | 'sampling' | 'lotSize'>,
  rows: readonly InspectionReportRow[],
  maxColumns: number,
): WorkbookLayout | { error: SamplePlanError } {
  if (!isLotType(report.reportType) || !report.sampling) {
    return { rows: [...rows], samples: null, counts: new Map(), expectedValues: new Map() }
  }
  const plan = planSamples(rows, report.reportType, report.sampling, report.lotSize)
  if ('error' in plan) return plan
  return {
    rows: expandSampleRows(rows, plan.counts, maxColumns),
    samples: plan.max,
    counts: plan.counts,
    expectedValues: expectedValuesPerRow(rows, plan.counts, maxColumns),
  }
}
