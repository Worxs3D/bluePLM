/**
 * State of "Generate with options..." (5.6.0): the report type and its fields, turned into a
 * `ReportTypeRequest` with field errors. Pure, unit-tested in `generateDialogModel.test.ts`; the
 * dialog (`GenerateReportDialog.tsx`) only renders it.
 */
import type { InspectionReportRow } from '@/lib/inspection/excel'
import { faiBaseline, selectCharacteristics, type LotCharacteristicScope } from '@/lib/inspection/reportTypes'
import type { FaiReason, FaiScope, InspectionReport, InspectionReportType, SamplingPlan } from '@/types/inspectionReports'

import { MAX_DEFAULT_SAMPLE_SIZE, type ReportNaming, type VersionInfo } from './reportModel'
import { isLotType, type ReportTypeRequest } from './reportTypeModel'

/** How a lot report's characteristics are picked: by the organization rule, all, or by hand. */
export type CharacteristicMode = LotCharacteristicScope | 'chosen'

export interface GenerateDialogState {
  type: InspectionReportType
  faiScope: FaiScope
  faiReason: FaiReason
  baselineId: string | null
  lotNumber: string
  lotSize: string
  samplingPlan: SamplingPlan['plan']
  sampleCount: string
  poNumber: string
  supplierName: string
  ncrReference: string
  /** Lot reports. */
  characteristicMode: CharacteristicMode
  /** Ids the user ticked; null = the computed set (partial FAI: the changed ones). */
  chosen: ReadonlySet<string> | null
}

/** The dialog's starting point: the type Generate would make, with the organization's defaults. */
export function initialDialogState(request: ReportTypeRequest, naming: Pick<ReportNaming, 'lotScope' | 'defaultSampleSize'>): GenerateDialogState {
  const sampling = request.sampling ?? { plan: 'fixed', n: naming.defaultSampleSize }
  return {
    type: request.reportType,
    faiScope: request.faiScope ?? 'full',
    faiReason: request.faiReason ?? (request.faiScope === 'partial' ? 'design_change' : 'new_part'),
    baselineId: request.baseline?.id ?? null,
    lotNumber: request.lotNumber ?? '',
    lotSize: request.lotSize ? String(request.lotSize) : '',
    samplingPlan: sampling.plan,
    sampleCount: String(sampling.plan === 'fixed' ? sampling.n : naming.defaultSampleSize),
    poNumber: request.poNumber ?? '',
    supplierName: request.supplierName ?? '',
    ncrReference: request.ncrReference ?? '',
    characteristicMode: request.lotScope ?? naming.lotScope,
    chosen: null,
  }
}

/**
 * Switching type keeps what the user typed; a re-inspection starts with nothing ticked, and an FAI
 * of a drawing that has had one starts as a partial FAI against it (`baselineId`).
 */
export function withType(
  state: GenerateDialogState,
  type: InspectionReportType,
  baselineId: string | null = null,
): GenerateDialogState {
  const next: GenerateDialogState = { ...state, type, chosen: type === 'reinspection' ? new Set() : null }
  if (type === 'fai' && state.type !== 'fai') {
    next.faiScope = baselineId ? 'partial' : 'full'
    next.faiReason = baselineId ? 'design_change' : 'new_part'
    next.baselineId = baselineId
  }
  return next
}

/** Versions a partial FAI can build on: those at or before the target with an FAI that was not rejected. */
export function baselineOptions(
  reports: readonly InspectionReport[],
  versions: readonly VersionInfo[],
  target: VersionInfo,
): Array<{ version: VersionInfo; accepted: boolean }> {
  const out = new Map<string, { version: VersionInfo; accepted: boolean }>()
  for (const r of reports) {
    if (r.reportType !== 'fai' || r.status === 'rejected') continue
    const v = versions.find((x) => x.id === r.fileVersionId)
    if (!v || v.version > target.version) continue
    const prev = out.get(v.id)
    out.set(v.id, { version: v, accepted: (prev?.accepted ?? false) || r.status === 'accepted' })
  }
  return [...out.values()].sort((a, b) => b.version.version - a.version.version)
}

/** The baseline a partial FAI of `target` uses when the user has not picked one. */
export function defaultBaselineId(
  reports: readonly InspectionReport[],
  versions: readonly VersionInfo[],
  target: VersionInfo,
): string | null {
  return faiBaseline(reports, versions, target)?.version.id ?? null
}

export interface DialogRows {
  rows: readonly InspectionReportRow[]
  /** Partial FAI: target row ids changed since the baseline. */
  changedIds: readonly string[]
}

/** Ids the characteristic list shows ticked. */
export function includedIds(state: GenerateDialogState, data: DialogRows): string[] {
  if (state.chosen) return data.rows.filter((r) => state.chosen?.has(r.id)).map((r) => r.id)
  const lot = isLotType(state.type)
  const selection = selectCharacteristics({
    type: state.type,
    faiScope: state.faiScope,
    rows: data.rows,
    changedIds: data.changedIds,
    scope: lot && state.characteristicMode !== 'chosen' ? state.characteristicMode : 'classified',
  })
  return selection.rows.map((r) => r.id)
}

/** Whether the user may tick characteristics in the current state (a full FAI includes all). */
export function canChooseCharacteristics(state: GenerateDialogState): boolean {
  if (state.type === 'fai') return state.faiScope === 'partial'
  if (state.type === 'reinspection') return true
  return state.characteristicMode === 'chosen'
}

/** Another version has other snapshot rows (new ids): a choice starts over (empty for a re-inspection). */
export function withVersionChanged(state: GenerateDialogState): GenerateDialogState {
  return { ...state, chosen: state.type === 'reinspection' ? new Set() : null }
}

/** Tick or untick; the first change starts from what the list showed. */
export function toggleCharacteristic(state: GenerateDialogState, data: DialogRows, id: string): GenerateDialogState {
  const next = new Set(state.chosen ?? includedIds(state, data))
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return { ...state, chosen: next }
}

export type DialogField = 'lotSize' | 'sampleCount' | 'ncrReference' | 'characteristics' | 'baseline'

/** i18n key of each field error. */
export type DialogErrors = Partial<Record<DialogField, string>>

function positiveInt(text: string): number | null {
  const v = text.trim()
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return n >= 1 ? n : null
}

/**
 * The request the state describes, or the field errors that stop it. `data` is the version's rows
 * (null while loading: the characteristic checks wait for them).
 */
export function dialogRequest(
  state: GenerateDialogState,
  versions: readonly VersionInfo[],
  data: DialogRows | null,
): { request: ReportTypeRequest | null; errors: DialogErrors } {
  const errors: DialogErrors = {}
  const base: ReportTypeRequest = { reportType: state.type }
  if (state.type === 'fai') {
    base.faiScope = state.faiScope
    base.faiReason = state.faiReason
    if (state.faiScope === 'partial') {
      base.baseline = versions.find((v) => v.id === state.baselineId) ?? null
      // A partial FAI without a baseline would compare against nothing.
      if (!base.baseline) errors.baseline = 'source.inspection.rptFaiBaselineRequired'
      base.chosenIds = data ? includedIds(state, data) : null
    }
  } else if (isLotType(state.type)) {
    const lotSize = state.lotSize.trim() === '' ? null : positiveInt(state.lotSize)
    if (state.lotSize.trim() !== '' && lotSize === null) errors.lotSize = 'source.inspection.rptRequiredField'
    let sampling: SamplingPlan
    if (state.samplingPlan === '100') {
      if (lotSize === null) errors.lotSize = 'source.inspection.rptSamplingError_lot_size_needed'
      sampling = { plan: '100' }
    } else {
      const n = positiveInt(state.sampleCount)
      if (n === null || n > MAX_DEFAULT_SAMPLE_SIZE) errors.sampleCount = 'source.inspection.rptRequiredField'
      else if (lotSize !== null && n > lotSize) errors.sampleCount = 'source.inspection.rptSamplingError_sample_larger_than_lot'
      sampling = { plan: 'fixed', n: n ?? 1 }
    }
    base.lotNumber = state.lotNumber
    base.lotSize = lotSize
    base.sampling = sampling
    if (state.characteristicMode === 'chosen') base.chosenIds = data ? includedIds(state, data) : null
    else base.lotScope = state.characteristicMode
    if (state.type === 'receiving') {
      base.poNumber = state.poNumber
      base.supplierName = state.supplierName
    }
  } else {
    if (state.ncrReference.trim() === '') errors.ncrReference = 'source.inspection.rptNcrRequired'
    base.ncrReference = state.ncrReference
    base.chosenIds = data ? includedIds(state, data) : null
  }
  if (data && canChooseCharacteristics(state) && (base.chosenIds?.length ?? 0) === 0) {
    errors.characteristics =
      state.type === 'fai' && !state.chosen
        ? 'source.inspection.rptSelectionEmpty_none_changed'
        : 'source.inspection.rptSelectionEmpty_none_chosen'
  }
  if (!data) return { request: null, errors }
  return { request: Object.keys(errors).length === 0 ? base : null, errors }
}
