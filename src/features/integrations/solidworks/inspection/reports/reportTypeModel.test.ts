import { describe, expect, it } from 'vitest'

import type { InspectionReportRow } from '@/lib/inspection/excel'
import { NO_REPORT_TYPE_FIELDS, type InspectionReport } from '@/types/inspectionReports'

import {
  baselineOptions,
  canChooseCharacteristics,
  dialogRequest,
  includedIds,
  initialDialogState,
  toggleCharacteristic,
  withType,
  withVersionChanged,
} from './generateDialogModel'
import { DEFAULT_REPORT_NAMING, type VersionInfo } from './reportModel'
import {
  defaultTypeRequest,
  includedRows,
  typeEntryValues,
  typeFieldsForRecord,
  typeScalars,
  workbookRows,
  type TypeLabels,
} from './reportTypeModel'

const v = (id: string, version: number, revision: string | null): VersionInfo => ({
  id,
  version,
  revision,
  partNumber: null,
  description: null,
  createdAt: null,
})
const V1 = v('v1', 1, 'A')
const V2 = v('v2', 2, 'B')
const VERSIONS = [V2, V1]

function report(over: Partial<InspectionReport>): InspectionReport {
  return {
    id: 'r',
    orgId: 'o',
    fileId: 'f',
    fileVersionId: 'v1',
    templateId: null,
    templateName: null,
    templateHash: null,
    reportNumber: null,
    sequence: null,
    title: null,
    status: 'accepted',
    storageHash: 'a'.repeat(64),
    fileSize: 1,
    characteristicCount: 0,
    drawingPdfHash: null,
    returnedHash: null,
    returnedAt: null,
    returnedBy: null,
    results: null,
    resultsSummary: null,
    notes: null,
    createdBy: null,
    createdAt: '2026-11-01',
    updatedBy: null,
    updatedAt: '2026-11-01',
    supersedesReportId: null,
    ...NO_REPORT_TYPE_FIELDS,
    ...over,
  }
}

function row(i: number, over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return {
    id: `c${i}`,
    sort_order: i,
    balloon_number: String(i),
    char_id: null,
    zone: null,
    char_type: null,
    sub_type: null,
    nominal_value: '1',
    unit: null,
    plus_tolerance: null,
    minus_tolerance: null,
    upper_limit: null,
    lower_limit: null,
    classification: null,
    inspection_method: null,
    operation: null,
    aql: null,
    sample_size: null,
    supplier_inspection_rate: null,
    internal_inspection_rate: null,
    reference: null,
    comments: null,
    source_key: `k${i}`,
    source_sheet: null,
    source_view: null,
    ...over,
  }
}

const LABELS: TypeLabels = {
  type: (t) => `T:${t}`,
  faiScope: (s) => `S:${s}`,
  faiReason: (r) => `R:${r}`,
  baseline: (x) => `v${x.version}`,
  sampling: (p) => (p.plan === '100' ? 'all' : `n=${p.n}`),
  scope: ({ count, total, scope }) => `${scope} ${count}/${total}`,
}

describe('defaultTypeRequest', () => {
  it('asks for a full FAI first, a partial one on a new revision, then production', () => {
    expect(defaultTypeRequest([], VERSIONS, V1, DEFAULT_REPORT_NAMING)).toEqual({
      reportType: 'fai',
      faiScope: 'full',
      faiReason: 'new_part',
      baseline: null,
    })
    const fai = report({ reportType: 'fai', faiScope: 'full', fileVersionId: 'v1' })
    expect(defaultTypeRequest([fai], VERSIONS, V2, DEFAULT_REPORT_NAMING)).toMatchObject({ faiScope: 'partial', baseline: V1 })
    expect(defaultTypeRequest([fai], VERSIONS, V1, { lotScope: 'all', defaultSampleSize: 7 })).toEqual({
      reportType: 'production',
      sampling: { plan: 'fixed', n: 7 },
      lotScope: 'all',
    })
  })
})

describe('type scalars, entries and recorded fields', () => {
  const selection = { rows: [row(1), row(2)], ids: ['c1', 'c2'], note: null }

  it('fills only what the type has', () => {
    const receiving = {
      reportType: 'receiving' as const,
      lotNumber: 'L1',
      lotSize: 20,
      sampling: { plan: 'fixed' as const, n: 4 },
      poNumber: 'PO-9',
      supplierName: 'Acme',
      ncrReference: 'ignored',
    }
    expect(typeScalars(receiving, { selection, totalRows: 5, samples: 4, labels: LABELS })).toMatchObject({
      REPORT_TYPE: 'T:receiving',
      FAI_TYPE: '',
      LOT_SIZE: '20',
      SAMPLING_PLAN: 'n=4',
      SAMPLE_SIZE: '4',
      CHARACTERISTIC_SCOPE: 'classified 2/5',
      PO_NUMBER: 'PO-9',
      NCR_REFERENCE: '',
    })
    expect(typeEntryValues(receiving, LABELS)).toEqual({ lot_number: 'L1', purchase_order: 'PO-9', supplier: 'Acme' })
    expect(typeFieldsForRecord(receiving, selection)).toMatchObject({ ncrReference: null, poNumber: 'PO-9', faiScope: null })

    const partial = { reportType: 'fai' as const, faiScope: 'partial' as const, faiReason: 'tooling_change' as const, baseline: V1 }
    expect(typeScalars(partial, { selection, totalRows: 5, samples: null, labels: LABELS })).toMatchObject({
      FAI_TYPE: 'S:partial',
      FAI_REASON: 'R:tooling_change',
      FAI_BASELINE: 'v1',
      CHARACTERISTIC_SCOPE: 'changed 2/5',
      LOT_SIZE: '',
    })
    expect(typeEntryValues(partial, LABELS)).toEqual({ fai_reason: 'R:tooling_change' })
    expect(typeFieldsForRecord(partial, selection)).toMatchObject({ faiBaselineVersionId: 'v1', characteristicIds: ['c1', 'c2'] })
  })
})

describe('workbook rows at import', () => {
  it('rebuilds the rows the workbook was generated with', () => {
    const rows = [row(1), row(2), row(3)]
    const r = report({ reportType: 'production', characteristicIds: ['c3', 'c1'], sampling: { plan: 'fixed', n: 11 }, lotSize: 50 })
    const included = includedRows(r, rows)
    expect(included.map((x) => x.id)).toEqual(['c1', 'c3'])
    const laid = workbookRows(r, included, 10)
    expect('rows' in laid && laid.rows.map((x) => x.id).slice(0, 2)).toEqual(['c1#1', 'c1#2'])
    expect('rows' in laid && laid.rows).toHaveLength(22)
    // A report from before types: every row, unchanged.
    expect(workbookRows(report({}), rows, 10)).toMatchObject({ rows, samples: null })
    // An organization template with 3 result columns: 4 parts become rows per part.
    const narrow = workbookRows({ ...r, sampling: { plan: 'fixed', n: 4 } }, included, 3)
    expect('rows' in narrow && narrow.rows).toHaveLength(8)
    const fits = workbookRows({ ...r, sampling: { plan: 'fixed', n: 3 } }, included, 3)
    expect('rows' in fits && [...fits.expectedValues]).toEqual([
      ['c1', 3],
      ['c3', 3],
    ])
  })
})

describe('generate dialog', () => {
  const rows = [row(1, { classification: 'Critical' }), row(2), row(3, { classification: 'Major' })]
  const data = { rows, changedIds: ['c2'] }

  it('starts from the default request and validates lot fields', () => {
    let state = initialDialogState({ reportType: 'production', lotScope: 'classified' }, DEFAULT_REPORT_NAMING)
    expect(state).toMatchObject({ samplingPlan: 'fixed', sampleCount: '5', characteristicMode: 'classified' })
    expect(includedIds(state, data)).toEqual(['c1', 'c3'])
    expect(dialogRequest(state, VERSIONS, data).request).toMatchObject({
      reportType: 'production',
      sampling: { plan: 'fixed', n: 5 },
      lotScope: 'classified',
      lotSize: null,
    })
    state = { ...state, samplingPlan: '100' }
    expect(dialogRequest(state, VERSIONS, data).errors.lotSize).toBe('source.inspection.rptSamplingError_lot_size_needed')
    state = { ...state, samplingPlan: 'fixed', lotSize: '3', sampleCount: '4' }
    expect(dialogRequest(state, VERSIONS, data).errors.sampleCount).toBe(
      'source.inspection.rptSamplingError_sample_larger_than_lot',
    )
    // Waiting for the rows: no request yet.
    expect(dialogRequest({ ...state, lotSize: '' }, VERSIONS, null).request).toBeNull()
  })

  it('needs a baseline for a partial FAI, and starts the choice over on another version', () => {
    const fai = initialDialogState({ reportType: 'fai', faiScope: 'partial', baseline: null }, DEFAULT_REPORT_NAMING)
    expect(dialogRequest(fai, VERSIONS, data).errors.baseline).toBe('source.inspection.rptFaiBaselineRequired')
    const re = toggleCharacteristic({ ...withType(fai, 'reinspection'), ncrReference: 'N' }, data, 'c1')
    expect(withVersionChanged(re).chosen?.size).toBe(0)
    expect(withVersionChanged({ ...re, type: 'production' }).chosen).toBeNull()
  })

  it('lets the user choose for a partial FAI and a re-inspection, not for a full FAI', () => {
    const fai = initialDialogState({ reportType: 'fai', faiScope: 'partial', baseline: V1 }, DEFAULT_REPORT_NAMING)
    expect(canChooseCharacteristics(fai)).toBe(true)
    expect(includedIds(fai, data)).toEqual(['c2'])
    const more = toggleCharacteristic(fai, data, 'c3')
    expect(dialogRequest(more, VERSIONS, data).request).toMatchObject({ faiScope: 'partial', baseline: V1, chosenIds: ['c2', 'c3'] })
    expect(canChooseCharacteristics({ ...fai, faiScope: 'full' })).toBe(false)

    const re = withType(fai, 'reinspection')
    expect(dialogRequest(re, VERSIONS, data).errors).toEqual({
      ncrReference: 'source.inspection.rptNcrRequired',
      characteristics: 'source.inspection.rptSelectionEmpty_none_chosen',
    })
    const ready = toggleCharacteristic({ ...re, ncrReference: 'NCR-1' }, data, 'c1')
    expect(dialogRequest(ready, VERSIONS, data).request).toEqual({ reportType: 'reinspection', ncrReference: 'NCR-1', chosenIds: ['c1'] })
  })

  it('offers the versions with an FAI as baselines, newest first', () => {
    const reports = [
      report({ reportType: 'fai', fileVersionId: 'v1', status: 'accepted' }),
      report({ reportType: 'fai', fileVersionId: 'v2', status: 'rejected' }),
    ]
    expect(baselineOptions(reports, VERSIONS, V2)).toEqual([{ version: V1, accepted: true }])
  })
})
