import { describe, expect, it } from 'vitest'

import type { ReturnedResults, ReturnedRow } from './excel'
import type { InspectionReportRow } from './excel/format'
import {
  baseRowId,
  changedCharacteristics,
  collapseSampleRows,
  defaultReportType,
  expandSampleRows,
  expectedValuesPerRow,
  mapCharacteristicIds,
  faiBaseline,
  isClassified,
  planSamples,
  reportTypeCode,
  sampleCountFor,
  selectCharacteristics,
  templateServes,
  type TypedReportRef,
} from './reportTypes'

function row(i: number, over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return {
    id: `id-${i}`,
    sort_order: i,
    balloon_number: String(i),
    char_id: null,
    zone: null,
    char_type: 'Dimension',
    sub_type: null,
    nominal_value: `${i}.00`,
    unit: 'mm',
    plus_tolerance: '0.1',
    minus_tolerance: '0.1',
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

const V1 = { id: 'v1', version: 1, revision: 'A' }
const V2 = { id: 'v2', version: 2, revision: 'A' }
const V3 = { id: 'v3', version: 3, revision: 'B' }
const VERSIONS = [V1, V2, V3]

function report(over: Partial<TypedReportRef>): TypedReportRef {
  return { fileVersionId: 'v1', reportType: 'fai', faiScope: 'full', status: 'issued', createdAt: '2026-01-01', ...over }
}

describe('report type codes', () => {
  it('names each type for {type}, and reports from before types IR', () => {
    expect(['fai', 'production', 'receiving', 'reinspection', null].map((t) => reportTypeCode(t as never))).toEqual([
      'FAIR',
      'PIR',
      'RIR',
      'RIN',
      'IR',
    ])
  })
})

describe('defaultReportType', () => {
  it('is a full FAI for a drawing with no FAI', () => {
    expect(defaultReportType([], VERSIONS, V3)).toEqual({ type: 'fai', faiScope: 'full', faiReason: 'new_part', baseline: null })
    // A report from before types, or a production report, is not an FAI.
    expect(defaultReportType([report({ reportType: null }), report({ reportType: 'production' })], VERSIONS, V3).type).toBe('fai')
  })

  it('is production once the revision has had an FAI that was not rejected', () => {
    expect(defaultReportType([report({ fileVersionId: 'v1' })], VERSIONS, V2).type).toBe('production')
    expect(defaultReportType([report({ fileVersionId: 'v1', status: 'rejected' })], VERSIONS, V2).type).toBe('fai')
  })

  it('is a partial FAI (design change) against the last FAI when the revision moved on', () => {
    expect(defaultReportType([report({ fileVersionId: 'v2' })], VERSIONS, V3)).toEqual({
      type: 'fai',
      faiScope: 'partial',
      faiReason: 'design_change',
      baseline: V2,
    })
  })

  it('counts a report from before types on the revision as history (production)', () => {
    expect(defaultReportType([report({ reportType: null, fileVersionId: 'v3' })], VERSIONS, V3).type).toBe('production')
    expect(defaultReportType([report({ reportType: null, fileVersionId: 'v3', status: 'rejected' })], VERSIONS, V3).type).toBe('fai')
  })

  it('never counts an FAI of a later version', () => {
    expect(defaultReportType([report({ fileVersionId: 'v3' })], VERSIONS, V1).type).toBe('fai')
  })
})

describe('faiBaseline', () => {
  it('prefers the newest accepted FAI over a newer one not accepted yet', () => {
    const reports = [report({ fileVersionId: 'v1', status: 'accepted' }), report({ fileVersionId: 'v2', status: 'sent' })]
    expect(faiBaseline(reports, VERSIONS, V3)).toEqual({ version: V1, accepted: true })
    expect(faiBaseline([report({ fileVersionId: 'v2', status: 'sent' })], VERSIONS, V3)).toEqual({ version: V2, accepted: false })
    expect(faiBaseline([report({ fileVersionId: 'v2', status: 'rejected' })], VERSIONS, V3)).toBeNull()
  })
})

describe('changedCharacteristics', () => {
  it('finds new and changed requirements, matched by annotation, else by balloon', () => {
    const before = [row(1), row(2), row(3, { source_key: null }), row(4)]
    const after = [
      row(1), // same
      row(2, { plus_tolerance: '0.05' }), // tolerance changed
      row(3, { source_key: null }), // manual row, same balloon and requirement
      row(4, { balloon_number: '40' }), // renumbered only: not a change to the part
      row(5), // new
      row(6, { source_key: null, balloon_number: null }), // no key at all: counted as changed
    ]
    expect(changedCharacteristics(before, after)).toEqual(['id-2', 'id-5', 'id-6'])
  })

  it('counts every characteristic as changed against no baseline', () => {
    expect(changedCharacteristics([], [row(1), row(2)])).toEqual(['id-1', 'id-2'])
  })
})

describe('mapCharacteristicIds', () => {
  it('finds chosen rows again on a new version by annotation, else balloon, and names the rest', () => {
    const before = [row(1), row(2, { source_key: null }), row(3), row(4)]
    const after = [
      row(1, { id: 'n1' }),
      row(2, { id: 'n2', source_key: null }),
      row(3, { id: 'n3', source_key: 'k3-moved', balloon_number: '30' }), // annotation replaced
    ]
    expect(mapCharacteristicIds(before, ['id-1', 'id-2', 'id-3', 'gone'], after)).toEqual({
      ids: ['n1', 'n2'],
      unmapped: ['3', 'gone'],
    })
  })
})

describe('selectCharacteristics', () => {
  const rows = [
    row(1, { classification: 'Critical' }),
    row(2, { classification: 'minor' }),
    row(3, { classification: 'Major', supplier_inspection_rate: 0 }), // rate 0: out of production
    row(4, { internal_inspection_rate: 25 }), // receiving only
    row(5, { classification: 'Key' }),
    row(6, { sample_size: 2 }), // a sample size says how many parts, not whether
  ]

  it('takes every row for a full FAI and records no set', () => {
    expect(selectCharacteristics({ type: 'fai', faiScope: 'full', rows })).toMatchObject({ ids: null, note: null })
    expect(selectCharacteristics({ type: 'fai', faiScope: 'full', rows }).rows).toHaveLength(6)
  })

  it('takes the changed rows for a partial FAI, or what the user chose', () => {
    expect(selectCharacteristics({ type: 'fai', faiScope: 'partial', rows, changedIds: ['id-2', 'id-9'] }).ids).toEqual(['id-2'])
    expect(selectCharacteristics({ type: 'fai', faiScope: 'partial', rows, changedIds: [] }).note).toBe('none_changed')
    expect(
      selectCharacteristics({ type: 'fai', faiScope: 'partial', rows, changedIds: ['id-2'], chosenIds: ['id-5', 'id-1'] }).ids,
    ).toEqual(['id-1', 'id-5'])
  })

  it('takes classified rows for a lot report; a characteristic rate decides over its class', () => {
    expect(selectCharacteristics({ type: 'production', rows, scope: 'classified' }).ids).toEqual(['id-1', 'id-5'])
    expect(selectCharacteristics({ type: 'receiving', rows, scope: 'classified' }).ids).toEqual([
      'id-1',
      'id-3',
      'id-4',
      'id-5',
    ])
    expect(selectCharacteristics({ type: 'production', rows, scope: 'all' }).ids).toEqual(['id-1', 'id-2', 'id-4', 'id-5', 'id-6'])
  })

  it('takes every row not ruled out when nothing is classified, and says so', () => {
    const plain = [row(1), row(2, { supplier_inspection_rate: 0 }), row(3)]
    expect(selectCharacteristics({ type: 'production', rows: plain, scope: 'classified' })).toMatchObject({
      ids: ['id-1', 'id-3'],
      note: 'no_classified',
    })
  })

  it('takes only the chosen rows for a re-inspection, and none when none are chosen', () => {
    expect(selectCharacteristics({ type: 'reinspection', rows, chosenIds: ['id-4'] }).ids).toEqual(['id-4'])
    expect(selectCharacteristics({ type: 'reinspection', rows })).toMatchObject({ ids: [], note: 'none_chosen' })
  })

  it('reads Critical / Major / Key as classified, case-insensitively', () => {
    expect(['Critical', 'MAJOR', ' key ', 'Minor', 'Incidental', null].map((c) => isClassified({ classification: c }))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })
})

describe('sampling', () => {
  it('uses the characteristic sample size, then its rate of the lot, then the plan, capped by the lot', () => {
    const fixed = { plan: 'fixed' as const, n: 5 }
    expect(sampleCountFor(row(1, { sample_size: 3 }), 'production', fixed, 40)).toBe(3)
    expect(sampleCountFor(row(1, { sample_size: 80 }), 'production', fixed, 40)).toBe(40)
    expect(sampleCountFor(row(1, { supplier_inspection_rate: 10 }), 'production', fixed, 45)).toBe(5) // ceil(4.5)
    expect(sampleCountFor(row(1, { supplier_inspection_rate: 10 }), 'production', fixed, null)).toBe(5) // no lot: the plan
    expect(sampleCountFor(row(1), 'production', fixed, 3)).toBe(3)
    expect(sampleCountFor(row(1), 'production', { plan: '100' }, 12)).toBe(12)
    expect(sampleCountFor(row(1), 'production', { plan: '100' }, null)).toBeNull()
  })

  it('refuses a plan it cannot lay out', () => {
    expect(planSamples([row(1)], 'production', { plan: '100' }, null)).toEqual({ error: 'lot_size_needed' })
    expect(planSamples([row(1)], 'production', { plan: 'fixed', n: 6 }, 5)).toEqual({ error: 'sample_larger_than_lot' })
    const many = Array.from({ length: 30 }, (_, i) => row(i))
    expect(planSamples(many, 'production', { plan: '100' }, 100)).toEqual({ error: 'too_many_measurements' })
    const plan = planSamples([row(1), row(2, { sample_size: 2 })], 'production', { plan: 'fixed', n: 4 }, 50)
    expect(plan).toMatchObject({ max: 4, total: 6 })
  })

  it('lays out one row per characteristic up to the column limit, else one row per part', () => {
    const rows = [row(1), row(2)]
    const narrow = expandSampleRows(rows, new Map([['id-1', 3], ['id-2', 2]]), 10)
    expect(narrow.map((r) => [r.id, r.sample_size, r.sample ?? null])).toEqual([
      ['id-1', 3, null],
      ['id-2', 2, null],
    ])
    const wide = expandSampleRows(rows, new Map([['id-1', 12], ['id-2', 1]]), 10)
    expect(wide).toHaveLength(13)
    expect(wide[0]).toMatchObject({ id: 'id-1#1', sample: '1 / 12', balloon_number: '1' })
    expect(wide[12]).toMatchObject({ id: 'id-2#1', sample: '1 / 1' })
    expect(baseRowId('id-1#12')).toBe('id-1')
    expect(baseRowId('id-1')).toBe('id-1')
  })

  it('needs one value per part laid out as columns (capped by the template), one per row otherwise', () => {
    const rows = [row(1), row(2), row(3)]
    const counts = new Map([['id-1', 5], ['id-2', 1], ['id-3', 8]])
    expect([...expectedValuesPerRow(rows, counts, 10)]).toEqual([['id-1', 5], ['id-3', 8]])
    // A part count above the template's columns lays out one row per part: one value each.
    expect([...expectedValuesPerRow(rows, counts, 6)]).toEqual([])
  })
})

function returnedRow(rowId: string, measured: string, verdict: 'pass' | 'fail' | null): ReturnedRow {
  return {
    rowId,
    sourceKey: 'k',
    balloon: '1',
    measured: [measured],
    inputs: { remarks: measured === '' ? '' : `r${rowId.slice(-1)}` },
    enteredVerdictText: '',
    enteredVerdict: null,
    computedVerdict: verdict,
    verdict,
    verdictConflict: false,
    tampered: false,
    tamperReasons: [],
  }
}

describe('collapseSampleRows', () => {
  const base: ReturnedResults = {
    reportId: 'r',
    fileId: 'f',
    fileVersionId: 'v',
    templateHash: null,
    entries: {},
    rows: [],
    summary: { total: 0, pass: 0, fail: 0, blank: 0 },
    warnings: [],
  }

  it('folds rows per part back to one per characteristic', () => {
    const out = collapseSampleRows({
      ...base,
      rows: [
        returnedRow('a#2', '1.01', 'pass'),
        returnedRow('a#1', '1.00', 'pass'),
        returnedRow('b#1', '2.30', 'fail'),
        returnedRow('b#2', '2.00', 'pass'),
        returnedRow('c#1', '3.00', 'pass'),
        returnedRow('c#2', '', null),
      ],
      warnings: [
        { code: 'MISSING_ROW', rowId: 'c#2' },
        { code: 'MISSING_ROW', rowId: 'c#3' },
      ],
    })
    expect(out.rows.map((r) => [r.rowId, r.measured, r.verdict])).toEqual([
      ['a', ['1.00', '1.01'], 'pass'],
      ['b', ['2.30', '2.00'], 'fail'],
      ['c', ['3.00', ''], null],
    ])
    expect(out.rows[0].inputs.remarks).toBe('r1; r2')
    expect(out.summary).toEqual({ total: 3, pass: 1, fail: 1, blank: 1 })
    expect(out.warnings).toEqual([{ code: 'MISSING_ROW', rowId: 'c' }])
  })

  it('leaves a characteristic open when a part row is missing, but a failed part still fails it', () => {
    const out = collapseSampleRows(
      { ...base, rows: [returnedRow('a#1', '1.00', 'pass'), returnedRow('a#2', '1.00', 'pass'), returnedRow('b#1', '9', 'fail')] },
      new Map([
        ['a', 3],
        ['b', 3],
      ]),
    )
    expect(out.rows.map((r) => [r.rowId, r.verdict])).toEqual([
      ['a', null],
      ['b', 'fail'],
    ])
  })

  it('leaves a one-row-per-characteristic workbook unchanged', () => {
    const results = { ...base, rows: [returnedRow('a', '1', 'pass')] }
    expect(collapseSampleRows(results)).toBe(results)
  })
})

describe('templateServes', () => {
  it('serves any type with no types, else only its own', () => {
    expect(templateServes({ reportTypes: [], defaultFor: [] }, 'fai')).toBe(true)
    expect(templateServes({ reportTypes: ['production'], defaultFor: [] }, 'fai')).toBe(false)
    expect(templateServes({ reportTypes: ['production'], defaultFor: [] }, null)).toBe(true)
  })
})
