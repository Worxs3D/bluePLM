import { describe, expect, it } from 'vitest'

import { emptyRowValues } from '../supabase/files/inspectionRows'
import type { InspectionRowInput } from '../supabase/files/inspection'
import {
  applyCharacteristicMerge,
  inReadingOrder,
  normalizeValue,
  planCharacteristicMerge,
} from './characteristicMerge'
import type { ExtractedCharacteristic, ExtractedDrawingSheet } from './types'

const SHEETS: ExtractedDrawingSheet[] = [
  { name: 'Sheet1', widthM: 0.42, heightM: 0.297 },
  { name: 'Sheet2', widthM: 0.42, heightM: 0.297 },
]

function char(sourceKey: string, over: Partial<ExtractedCharacteristic> = {}): ExtractedCharacteristic {
  return {
    sourceKey,
    baseKey: sourceKey.split('#')[0],
    persistRef: 'AAAA',
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

function ids() {
  let n = 0
  return () => `new-${++n}`
}

const plan = (
  rows: InspectionRowInput[],
  extracted: ExtractedCharacteristic[],
  highestUsedNumber = 0,
  includeReference?: boolean,
) =>
  planCharacteristicMerge({ rows, extracted, sheets: SHEETS, highestUsedNumber, includeReference, newId: ids() })

describe('planCharacteristicMerge: unreadable annotations', () => {
  it('keeps a row whose annotation was skipped, by base key or exact key, out of missing', () => {
    const rows = [
      row('a', { balloon_number: '1', source_key: 'hole#1' }),
      row('b', { balloon_number: '2', source_key: 'dim' }),
      row('c', { balloon_number: '3', source_key: 'gone' }),
    ]
    const p = planCharacteristicMerge({
      rows,
      extracted: [],
      sheets: SHEETS,
      highestUsedNumber: 3,
      skipped: [
        { sourceKey: 'hole#0', baseKey: 'hole', sheet: 'Sheet1', reason: 'unreadable callout' },
        { sourceKey: 'dim', baseKey: null, sheet: 'Sheet1', reason: 'no persistent reference' },
      ],
      newId: ids(),
    })
    expect(p.unreadable.map((r) => r.id)).toEqual(['a', 'b'])
    expect(p.missing.map((r) => r.id)).toEqual(['c'])
    // Removing every missing row still keeps the unreadable ones, untouched.
    const merged = applyCharacteristicMerge(rows, p, new Set(['a', 'b', 'c']))
    expect(merged.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('planCharacteristicMerge', () => {
  it('a key match keeps the balloon number and every user field', () => {
    const existing = row('r1', {
      balloon_number: '7',
      source_key: 'k1',
      char_type: 'Dimension',
      sub_type: 'Linear',
      nominal_value: '10.00',
      unit: 'mm',
      plus_tolerance: '+0.10',
      minus_tolerance: '-0.10',
      source_sheet: 'Sheet1',
      source_view: 'Drawing View1',
      classification: 'Critical',
      inspection_method: 'CMM',
      operation: 'OP20',
      aql: '1.0',
      sample_size: 5,
      supplier_inspection_rate: 100,
      internal_inspection_rate: 10,
      reference: 'REF',
      comments: 'keep me',
    })
    const result = plan([existing], [char('k1')], 9)
    expect(result.unchanged).toEqual(['r1'])
    expect(result.updated).toEqual([])
    expect(result.added).toEqual([])

    const moved = plan([existing], [char('k1', { nominal: '12.00', sheet: 'Sheet2' })], 9)
    expect(moved.updated).toHaveLength(1)
    const { after, changedFields } = moved.updated[0]
    expect(changedFields).toEqual(['nominal_value', 'source_sheet'])
    expect(after.nominal_value).toBe('12.00')
    for (const field of [
      'balloon_number',
      'classification',
      'inspection_method',
      'operation',
      'aql',
      'sample_size',
      'supplier_inspection_rate',
      'internal_inspection_rate',
      'reference',
      'comments',
    ] as const) {
      expect(after[field], field).toEqual(existing[field])
    }
  })

  it('reports geometry changes field by field and never blanks a zone the API did not give', () => {
    const existing = row('r1', { balloon_number: '1', source_key: 'k1', zone: 'B3', char_type: 'Dimension' })
    const result = plan([existing], [char('k1', { plusTolerance: '+0.20', zone: null })])
    const { after, changedFields } = result.updated[0]
    expect(changedFields).toContain('plus_tolerance')
    expect(changedFields).not.toContain('zone')
    expect(after.zone).toBe('B3')
    expect(after.plus_tolerance).toBe('+0.20')
  })

  it('numbers new items above every used number, in reading order', () => {
    const extracted = [
      char('low-left', { x: 0.05, y: 0.05 }),
      char('top-right', { x: 0.3, y: 0.25 }),
      char('sheet2', { sheet: 'Sheet2', x: 0.01, y: 0.29 }),
      // Within 2% of 0.297 m (5.94 mm) of top-right: same line, and further left.
      char('top-left', { x: 0.1, y: 0.245 }),
      char('middle', { x: 0.01, y: 0.15 }),
    ]
    const result = plan([row('m', { balloon_number: '3' })], extracted, 12)
    expect(result.added.map((r) => [r.source_key, r.balloon_number])).toEqual([
      ['top-left', '13'],
      ['top-right', '14'],
      ['middle', '15'],
      ['low-left', '16'],
      ['sheet2', '17'],
    ])
    expect(result.added.map((r) => r.id)).toEqual(['new-1', 'new-2', 'new-3', 'new-4', 'new-5'])
    expect(result.added[0]).toMatchObject({
      char_type: 'Dimension',
      sub_type: 'Linear',
      nominal_value: '10.00',
      source_sheet: 'Sheet1',
      source_view: 'Drawing View1',
      classification: null,
    })
  })

  it('never reuses a number at or below highestUsedNumber, nor one in the table', () => {
    expect(plan([], [char('a')], 40).added[0].balloon_number).toBe('41')
    const table = [row('r', { balloon_number: '55', source_key: 'gone' })]
    expect(plan(table, [char('a')], 40).added[0].balloon_number).toBe('56')
    expect(plan([], [char('a')], 0).added[0].balloon_number).toBe('1')
  })

  it('lists missing rows and removes only the selected ones', () => {
    const rows = [
      row('a', { balloon_number: '1', source_key: 'gone-1' }),
      row('b', { balloon_number: '2', source_key: 'gone-2' }),
      row('c', { balloon_number: '3', source_key: 'k3', char_type: 'Dimension', sub_type: 'Linear' }),
    ]
    const result = plan(rows, [char('k3')])
    expect(result.missing.map((r) => r.id)).toEqual(['a', 'b'])
    expect(applyCharacteristicMerge(rows, result, new Set()).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(applyCharacteristicMerge(rows, result, new Set(['a'])).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('leaves manual rows untouched', () => {
    const manual = row('m', { balloon_number: '4', nominal_value: 'Visual check', comments: 'by hand' })
    const result = plan([manual], [char('k1')], 4)
    expect(result.manual).toEqual(['m'])
    expect(result.adopted).toEqual([])
    const merged = applyCharacteristicMerge([manual], result, new Set(['m']))
    expect(merged.find((r) => r.id === 'm')).toEqual({ ...manual, sort_order: 0 })
    expect(merged.map((r) => r.balloon_number)).toEqual(['4', '5'])
  })

  it('adopts a keyless row when its signature is unique on both sides', () => {
    const imported = row('i', {
      balloon_number: '2',
      char_type: 'Dimension',
      nominal_value: '10',
      plus_tolerance: '0.1',
      minus_tolerance: '-0.1',
      classification: 'Major',
    })
    const result = plan([imported], [char('k1'), char('k2', { nominal: '20.00' })], 2)
    expect(result.adopted).toEqual([{ rowId: 'i', sourceKey: 'k1' }])
    const update = result.updated.find((u) => u.rowId === 'i')
    expect(update?.after).toMatchObject({ balloon_number: '2', source_key: 'k1', classification: 'Major' })
    expect(update?.changedFields).toContain('source_key')
    expect(result.added.map((r) => [r.source_key, r.balloon_number])).toEqual([['k2', '3']])
  })

  it('does not adopt when either side is ambiguous', () => {
    const imported = (id: string, n: string) =>
      row(id, {
        balloon_number: n,
        char_type: 'Dimension',
        nominal_value: '10.00',
        plus_tolerance: '+0.10',
        minus_tolerance: '-0.10',
      })
    const twoChars = plan([imported('i', '1')], [char('k1'), char('k2', { x: 0.3 })], 1)
    expect(twoChars.adopted).toEqual([])
    expect(twoChars.manual).toEqual(['i'])
    expect(twoChars.added).toHaveLength(2)

    const twoRows = plan([imported('i', '1'), imported('j', '2')], [char('k1')], 2)
    expect(twoRows.adopted).toEqual([])
    expect(twoRows.manual).toEqual(['i', 'j'])
  })

  it('skips reference dimensions unless asked, but keeps updating a row already keyed to one', () => {
    const ref = char('ref', { isReference: true })
    expect(plan([], [ref]).added).toEqual([])
    expect(plan([], [ref], 0, true).added.map((r) => r.source_key)).toEqual(['ref'])
    const keyed = row('r', { balloon_number: '1', source_key: 'ref' })
    const result = plan([keyed], [ref])
    expect(result.missing).toEqual([])
    expect(result.updated.map((u) => u.rowId)).toEqual(['r'])
  })

  it('maps kinds to the table types', () => {
    const result = plan(
      [],
      [
        char('h#0', { kind: 'holeCallout', subType: 'Diameter', x: 0.01 }),
        char('h#1', { kind: 'holeCallout', subType: 'Depth', x: 0.01 }),
        char('g', { kind: 'gtol', subType: 'Position', x: 0.2 }),
        char('s', { kind: 'surfaceFinish', subType: null, x: 0.3 }),
      ],
    )
    expect(result.added.map((r) => [r.source_key, r.char_type, r.sub_type, r.balloon_number])).toEqual([
      ['h#0', 'Dimension', 'Hole Callout', '1'],
      ['h#1', 'Dimension', 'Hole Callout', '2'],
      ['g', 'GTOL', 'Position', '3'],
      ['s', 'Note', 'Surface Finish', '4'],
    ])
  })
})

describe('applyCharacteristicMerge', () => {
  it('sorts by balloon number and renumbers sort_order', () => {
    const rows = [
      row('b', { balloon_number: '10', source_key: 'k10', sort_order: 0 }),
      row('a', { balloon_number: '2', source_key: 'k2', sort_order: 1 }),
      row('blank', { balloon_number: null, sort_order: 2 }),
    ]
    const result = plan(rows, [char('k10'), char('k2'), char('new', { y: 0.01 })], 10)
    const merged = applyCharacteristicMerge(rows, result, new Set())
    expect(merged.map((r) => [r.id, r.balloon_number, r.sort_order])).toEqual([
      ['a', '2', 0],
      ['b', '10', 1],
      ['new-1', '11', 2],
      ['blank', null, 3],
    ])
  })
})

describe('helpers', () => {
  it('normalizeValue makes equivalent spellings equal', () => {
    expect(normalizeValue('10.00')).toBe(normalizeValue('10'))
    expect(normalizeValue('+0.10')).toBe(normalizeValue('0.1'))
    expect(normalizeValue('0,5')).toBe(normalizeValue('0.5'))
    expect(normalizeValue('⌀ 6')).toBe(normalizeValue('Ø6'))
    expect(normalizeValue(null)).toBe('')
    expect(normalizeValue('-0.1')).not.toBe(normalizeValue('0.1'))
  })

  it('inReadingOrder falls back to the tallest item when the sheet size is unknown', () => {
    const items = [char('b', { sheet: 'X', x: 0.2, y: 0.995 }), char('a', { sheet: 'X', x: 0.1, y: 1 })]
    // Band = 2% of 1 m: both on one line, left to right.
    expect(inReadingOrder(items, []).map((c) => c.sourceKey)).toEqual(['a', 'b'])
  })
})
