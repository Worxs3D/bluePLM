import { describe, expect, it } from 'vitest'

import { emptyRowValues } from '@/lib/supabase/files/inspectionRows'
import type { InspectionRowInput } from '@/lib/supabase/files/inspection'
import {
  applyCharacteristicMerge,
  planCharacteristicMerge,
} from '@/lib/inspection/characteristicMerge'
import {
  INSPECTION_BALLOON_ERROR_CODES,
  type ExtractedCharacteristic,
} from '@/lib/inspection/types'

import {
  buildExtractPreview,
  defaultRemoveIds,
  inspectionErrorKey,
  planBalloonRequests,
  rowSummary,
} from './drawingCharacteristicsFlow'

function char(sourceKey: string, over: Partial<ExtractedCharacteristic> = {}): ExtractedCharacteristic {
  return {
    sourceKey,
    baseKey: sourceKey.split('#')[0],
    persistRef: `ref-${sourceKey}`,
    annotationName: `Drawing View1/${sourceKey}`,
    sheet: 'Sheet1',
    view: 'Drawing View1',
    kind: 'dimension',
    subType: 'Linear',
    nominal: '10.00',
    unit: 'mm',
    plusTolerance: '+0.10',
    minusTolerance: '-0.10',
    upperLimit: null,
    lowerLimit: null,
    toleranceType: 'Bilateral',
    isReference: false,
    zone: null,
    x: 0.1,
    y: 0.2,
    ...over,
  }
}

function row(id: string, over: Partial<InspectionRowInput> = {}): InspectionRowInput {
  return { ...emptyRowValues(0), id, ...over }
}

function plan(rows: InspectionRowInput[], extracted: ExtractedCharacteristic[], highest = 0) {
  let n = 0
  return planCharacteristicMerge({
    rows,
    extracted,
    sheets: [{ name: 'Sheet1', widthM: 0.42, heightM: 0.297 }],
    highestUsedNumber: highest,
    newId: () => `new-${++n}`,
  })
}

describe('buildExtractPreview', () => {
  const rows = [
    // keyed, geometry changed
    row('r1', { balloon_number: '1', source_key: 'k1', char_type: 'Dimension', nominal_value: '9.00' }),
    // keyed, annotation gone
    row('r2', { balloon_number: '2', source_key: 'gone', char_type: 'Dimension', nominal_value: '5' }),
    // keyless, unique signature: adopted
    row('r3', {
      balloon_number: '3',
      char_type: 'Dimension',
      nominal_value: '20',
      plus_tolerance: '+0.1',
      minus_tolerance: '-0.1',
    }),
    // keyless, nothing matches: manual
    row('r4', { balloon_number: '4', char_type: 'Note', nominal_value: 'deburr' }),
  ]
  const extracted = [char('k1'), char('k3', { nominal: '20.00' }), char('k5', { nominal: '30.00' })]

  it('counts and lists every bucket, separating adopted from updated', () => {
    const preview = buildExtractPreview(plan(rows, extracted, 7))
    expect(preview.counts).toEqual({
      added: 1,
      updated: 1,
      adopted: 1,
      unchanged: 0,
      missing: 1,
      unreadable: 0,
      manual: 1,
    })
    expect(preview.isNoOp).toBe(false)
    expect(preview.added).toEqual([
      { rowId: 'new-1', balloon: '8', summary: 'Dimension · Linear · 30.00 +0.10/-0.10', sheet: 'Sheet1' },
    ])
    expect(preview.missing.map((m) => m.rowId)).toEqual(['r2'])
    const updated = Object.fromEntries(preview.updated.map((u) => [u.rowId, u]))
    expect(updated.r1.adopted).toBe(false)
    expect(updated.r1.changedFields).toContain('nominal_value')
    expect(updated.r3.adopted).toBe(true)
    expect(updated.r3.changedFields).toContain('source_key')
    expect(updated.r3.balloon).toBe('3')
  })

  it('is a no-op when the table already matches the drawing', () => {
    const merged = applyCharacteristicMerge([], plan([], [char('k1')]), new Set())
    const preview = buildExtractPreview(plan(merged, [char('k1')], 1))
    expect(preview.isNoOp).toBe(true)
    expect(preview.counts.unchanged).toBe(1)
  })

  it('ticks every missing row for removal by default, and only ticked rows are removed', () => {
    const p = plan(rows, extracted, 7)
    const ticks = defaultRemoveIds(p)
    expect([...ticks]).toEqual(['r2'])
    expect(applyCharacteristicMerge(rows, p, ticks).some((r) => r.id === 'r2')).toBe(false)
    ticks.delete('r2')
    expect(applyCharacteristicMerge(rows, p, ticks).some((r) => r.id === 'r2')).toBe(true)
  })
})

describe('incomplete sheets and unreadable rows', () => {
  const rows = [
    row('s1', { balloon_number: '1', source_key: 'gone1', source_sheet: 'Sheet1' }),
    row('s2', { balloon_number: '2', source_key: 'gone2', source_sheet: 'Sheet2' }),
    row('u', { balloon_number: '3', source_key: 'gtol#0', source_sheet: 'Sheet1' }),
  ]
  const p = planCharacteristicMerge({
    rows,
    extracted: [char('k1')],
    sheets: [{ name: 'Sheet1', widthM: 0.42, heightM: 0.297 }],
    highestUsedNumber: 3,
    skipped: [{ sourceKey: 'gtol#0', baseKey: 'gtol', sheet: 'Sheet1', reason: 'frame' }],
    newId: () => 'n',
  })

  it('does not tick a missing row with no recorded sheet while any sheet is incomplete', () => {
    const q = planCharacteristicMerge({
      rows: [row('x', { balloon_number: '4', source_key: 'gone3', source_sheet: null })],
      extracted: [],
      sheets: [],
      highestUsedNumber: 4,
      newId: () => 'n',
    })
    expect(defaultRemoveIds(q).has('x')).toBe(true)
    expect(defaultRemoveIds(q, ['Sheet2']).has('x')).toBe(false)
  })

  it('does not tick missing rows on a sheet that was not fully read', () => {
    expect([...defaultRemoveIds(p, ['Sheet2'])]).toEqual(['s1'])
    const preview = buildExtractPreview(p, ['Sheet2'])
    expect(preview.incompleteSheets).toEqual(['Sheet2'])
    expect(preview.missing.map((m) => [m.rowId, m.onIncompleteSheet])).toEqual([
      ['s1', false],
      ['s2', true],
    ])
  })

  it('lists unreadable rows separately and never as missing', () => {
    const preview = buildExtractPreview(p)
    expect(preview.unreadable.map((u) => u.rowId)).toEqual(['u'])
    expect(preview.counts.unreadable).toBe(1)
    expect(preview.missing.some((m) => m.rowId === 'u')).toBe(false)
    expect(defaultRemoveIds(p).has('u')).toBe(false)
  })
})

describe('rowSummary', () => {
  it('joins type, sub-type and value with tolerances, skipping blanks', () => {
    expect(rowSummary(row('a', { char_type: 'GTOL', nominal_value: '⌖ 0.05' }))).toBe('GTOL · ⌖ 0.05')
    expect(rowSummary(row('b', { nominal_value: '5', minus_tolerance: '-0.2' }))).toBe('5 /-0.2')
    expect(rowSummary(row('c'))).toBe('')
  })
})

describe('planBalloonRequests', () => {
  it('maps keys to the fresh persist reference, and splits stale and unkeyed rows', () => {
    const rows = [
      row('a', { balloon_number: '1', source_key: 'k1' }),
      row('b', { balloon_number: '2', source_key: 'gone' }),
      row('c', { balloon_number: '3' }),
      row('d', { source_key: 'k4' }),
      row('e', { balloon_number: ' 5 ', source_key: 'k5#1' }),
    ]
    const result = planBalloonRequests(rows, [char('k1'), char('k4'), char('k5#1')])
    expect(result.balloons).toEqual([
      { sourceKey: 'k1', label: '1', persistRef: 'ref-k1' },
      { sourceKey: 'k5#1', label: '5', persistRef: 'ref-k5#1' },
    ])
    expect(result.stale.map((r) => r.id)).toEqual(['b'])
    expect(result.unkeyed).toBe(2)
  })
})

describe('inspectionErrorKey', () => {
  it('maps every inspection balloon error code to its own message and nothing else', () => {
    const keys = Object.values(INSPECTION_BALLOON_ERROR_CODES).map(inspectionErrorKey)
    expect(keys.every((k) => k !== null)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(inspectionErrorKey('SW_TIMEOUT')).toBeNull()
    expect(inspectionErrorKey(undefined)).toBeNull()
  })
})
