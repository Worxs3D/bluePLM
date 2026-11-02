import { describe, expect, it } from 'vitest'

import {
  generalToleranceFor,
  generalTolerancesBySheet,
  iso2768Deviation,
  parseGeneralTolerances,
  parseNominal,
  type GeneralToleranceRules,
} from './generalTolerance'
import type { ExtractedCharacteristic, ExtractedSheetNote } from './types'

function note(text: string, x = 0.3, y = 0.05, height: number | null = 0.0025): ExtractedSheetNote {
  return { text, x, y, height, source: 'format' }
}

function char(over: Partial<ExtractedCharacteristic> = {}): ExtractedCharacteristic {
  return {
    sourceKey: 'k',
    baseKey: 'k',
    persistRef: 'AAAA',
    annotationName: 'Drawing View1/D1',
    sheet: 'Sheet1',
    view: 'Drawing View1',
    kind: 'dimension',
    subType: 'Linear',
    nominal: '10.00',
    unit: 'mm',
    plusTolerance: null,
    minusTolerance: null,
    upperLimit: null,
    lowerLimit: null,
    toleranceType: 'None',
    isReference: false,
    zone: null,
    x: 0.1,
    y: 0.1,
    ...over,
  }
}

function rules(over: Partial<GeneralToleranceRules> = {}): GeneralToleranceRules {
  return {
    unit: null,
    decimal: [],
    linear: null,
    fractional: null,
    angular: null,
    iso2768: null,
    ...over,
  }
}

/** The stock SOLIDWORKS ANSI sheet format block, values left blank as it ships. */
const STOCK_ANSI_BLOCK = [
  'UNLESS OTHERWISE SPECIFIED:',
  'DIMENSIONS ARE IN INCHES',
  'TOLERANCES:',
  'FRACTIONAL±',
  'ANGULAR: MACH±    BEND ±',
  'TWO PLACE DECIMAL    ±',
  'THREE PLACE DECIMAL  ±',
].join('\n')

describe('parseGeneralTolerances: nothing to read', () => {
  it('returns null for no notes', () => {
    expect(parseGeneralTolerances(undefined)).toBeNull()
    expect(parseGeneralTolerances([])).toBeNull()
  })

  it('reads no rule from the stock SOLIDWORKS ANSI block with its values blank', () => {
    expect(parseGeneralTolerances([note(STOCK_ANSI_BLOCK)])).toBeNull()
  })

  it('reads no rule from the stock block laid out as separate notes beside title block cells', () => {
    const notes = STOCK_ANSI_BLOCK.split('\n').map((line, i) => note(line, 0.12, 0.06 - i * 0.004))
    notes.push(
      note('NAME', 0.2, 0.06),
      note('DATE', 0.23, 0.06),
      note('DRAWN', 0.2, 0.056),
      note('SCALE: 1:2', 0.2, 0.036),
      note('SHEET 1 OF 2', 0.25, 0.036),
      note('11/2/26', 0.23, 0.036),
    )
    expect(parseGeneralTolerances(notes)).toBeNull()
  })

  it('does not take an unrelated number on the same line for a blank value (stock block + REV cell)', () => {
    const notes = STOCK_ANSI_BLOCK.split(/\n/).map((line, i) => note(line, 0.12, 0.06 - i * 0.004))
    // Same y as `TWO PLACE DECIMAL ±` (line 5) and `THREE PLACE DECIMAL ±` (line 6).
    notes.push(note('REV', 0.25, 0.04), note('1', 0.27, 0.04), note('2', 0.2, 0.036))
    expect(parseGeneralTolerances(notes)).toBeNull()
  })

  it('reads a value in the fragment right next to its label, and not across a blank one', () => {
    // `X.XX ±` ends near x 0.309; the value starts right after it.
    expect(parseGeneralTolerances([note('X.XX ±', 0.3, 0.05), note('0.1', 0.31, 0.05)])?.decimal).toHaveLength(1)
    expect(parseGeneralTolerances([note('X.XX ±', 0.3, 0.05), note('0.1', 0.36, 0.05)])).toBeNull()
    expect(
      parseGeneralTolerances([note('X.XX', 0.3, 0.05), note('±', 0.34, 0.05), note('0.1', 0.38, 0.05)]),
    ).toBeNull()
  })

  it('does not take a date in the next cell for a blank value', () => {
    const notes = [note('THREE PLACE DECIMAL ±', 0.1, 0.03), note('11/2/26', 0.16, 0.03)]
    expect(parseGeneralTolerances(notes)).toBeNull()
  })
})

describe('parseGeneralTolerances: one note holding the block', () => {
  it('reads the filled-in ANSI block (inch, fractional, angular, two and three places)', () => {
    const text = [
      'UNLESS OTHERWISE SPECIFIED:',
      'DIMENSIONS ARE IN INCHES',
      'TOLERANCES:',
      'FRACTIONAL ± 1/16',
      'ANGULAR: MACH ± 0.5°  BEND ± 1°',
      'TWO PLACE DECIMAL ± .01',
      'THREE PLACE DECIMAL ± .005',
    ].join('\n')
    const r = parseGeneralTolerances([note(text)])
    expect(r?.unit).toBe('in')
    expect(r?.fractional).toMatchObject({ value: 1 / 16, text: '1/16' })
    expect(r?.angular).toMatchObject({ value: 0.5 })
    expect(r?.decimal).toEqual([
      { places: 2, tolerance: { value: 0.01, places: 2, text: '.01' } },
      { places: 3, tolerance: { value: 0.005, places: 3, text: '.005' } },
    ])
    expect(r?.iso2768).toBeNull()
  })

  it('reads several notation rules on one line, separated by commas', () => {
    const r = parseGeneralTolerances([note('TOLERANCES: .X ±.1, .XX ±.01, .XXX ±.005')])
    expect(r?.decimal.map((d) => [d.places, d.tolerance.value])).toEqual([
      [1, 0.1],
      [2, 0.01],
      [3, 0.005],
    ])
  })

  it('reads metric X / X.X / X.XX rules, +/- spellings and SOLIDWORKS <MOD-PM> codes', () => {
    const text = ['ALL DIMENSIONS IN MM', 'X ±0.5', 'X.X +/- 0.2', 'X.XX <MOD-PM>0.1', '0.000 +-0.05'].join('\n')
    const r = parseGeneralTolerances([note(text)])
    expect(r?.unit).toBe('mm')
    expect(r?.decimal.map((d) => [d.places, d.tolerance.value])).toEqual([
      [0, 0.5],
      [1, 0.2],
      [2, 0.1],
      [3, 0.05],
    ])
  })

  it('reads decimal commas', () => {
    const r = parseGeneralTolerances([note('X,X ±0,2\nX,XX ±0,05')])
    expect(r?.decimal.map((d) => [d.places, d.tolerance.value])).toEqual([
      [1, 0.2],
      [2, 0.05],
    ])
  })

  it('reads ISO 2768-mK in its usual spellings', () => {
    for (const text of ['GENERAL TOLERANCES ISO 2768-mK', 'ISO 2768-MK', 'DIN ISO 2768-1 m', 'ISO 2768 - f H']) {
      const r = parseGeneralTolerances([note(text)])
      expect(r?.iso2768?.linear, text).toBe(text.includes('f H') ? 'f' : 'm')
    }
    expect(parseGeneralTolerances([note('ISO 2768-mK')])?.iso2768).toEqual({ linear: 'm', geometric: 'K' })
    expect(parseGeneralTolerances([note('ISO 2768-c')])?.iso2768).toEqual({ linear: 'c', geometric: null })
    expect(parseGeneralTolerances([note('ISO 2768-1')])).toBeNull()
  })

  it('reads one tolerance for every value, and angles in degrees and minutes', () => {
    const r = parseGeneralTolerances([note('TOLERANCES ±0.1 MM\nANGLES ±0°30\'')])
    expect(r?.linear).toMatchObject({ value: 0.1, places: 1 })
    expect(r?.angular?.value).toBeCloseTo(0.5)
    expect(parseGeneralTolerances([note("ANGULAR ±30'")])?.angular?.value).toBeCloseTo(0.5)
    expect(parseGeneralTolerances([note('ANGULAR ±1/2°')])?.angular?.value).toBeCloseTo(0.5)
  })

  it('reads worded place counts in their short forms', () => {
    const r = parseGeneralTolerances([note('2 PL DEC ±.01\n3 PLACES ±.005\nONE PLACE DECIMALS ±.1')])
    expect(r?.decimal.map((d) => d.places)).toEqual([1, 2, 3])
  })

  it('rejects implausible values', () => {
    expect(parseGeneralTolerances([note('DIMENSIONS ARE IN INCHES\nTWO PLACE DECIMAL ± 2')])).toBeNull()
  })
})

describe('parseGeneralTolerances: separate label and value notes', () => {
  it('joins label and value notes on one line, read left to right', () => {
    const rows: [string, string][] = [
      ['.X', '±.1'],
      ['.XX', '±.01'],
      ['.XXX', '±.005'],
      ['ANGLES', '±1°'],
    ]
    const notes = rows.flatMap(([label, value], i) => [
      note(value, 0.36, 0.06 - i * 0.005),
      note(label, 0.3, 0.06 - i * 0.005),
    ])
    notes.push(note('DRAWN', 0.4, 0.06), note('DIMENSIONS ARE IN INCHES', 0.3, 0.07))
    const r = parseGeneralTolerances(notes)
    expect(r?.unit).toBe('in')
    expect(r?.decimal.map((d) => [d.places, d.tolerance.text])).toEqual([
      [1, '.1'],
      [2, '.01'],
      [3, '.005'],
    ])
    expect(r?.angular?.value).toBe(1)
  })

  it('aligns a multi-line label note with a multi-line value note line by line', () => {
    const notes = [
      note('TWO PLACE DECIMAL\nTHREE PLACE DECIMAL', 0.3, 0.05, 0.0025),
      note('±0.01\n±0.005', 0.38, 0.05, 0.0025),
    ]
    const r = parseGeneralTolerances(notes)
    expect(r?.decimal.map((d) => [d.places, d.tolerance.value])).toEqual([
      [2, 0.01],
      [3, 0.005],
    ])
  })

  it('tolerates a slight vertical misalignment within half a character height', () => {
    const r = parseGeneralTolerances([note('X.XX', 0.3, 0.05), note('±0.1', 0.34, 0.0495)])
    expect(r?.decimal).toHaveLength(1)
  })

  it('does not join notes a line apart', () => {
    expect(parseGeneralTolerances([note('X.XX', 0.3, 0.05), note('±0.1', 0.34, 0.045)])).toBeNull()
  })
})

describe('generalTolerancesBySheet', () => {
  it('gives a sheet without a block the drawing-level rules of the first sheet that has one', () => {
    const data = {
      sheets: [
        { name: 'Sheet1', widthM: 0.42, heightM: 0.297, notes: [note('ISO 2768-m')] },
        { name: 'Sheet2', widthM: 0.42, heightM: 0.297 },
        { name: 'Sheet3', widthM: 0.42, heightM: 0.297, notes: [note('ISO 2768-f')] },
      ],
    }
    const bySheet = generalTolerancesBySheet(data)
    expect(bySheet.get('Sheet2')?.iso2768?.linear).toBe('m')
    expect(bySheet.get('Sheet3')?.iso2768?.linear).toBe('f')
  })

  it('is null for every sheet when no sheet has notes (older services)', () => {
    const bySheet = generalTolerancesBySheet({ sheets: [{ name: 'Sheet1', widthM: 0.42, heightM: 0.297 }] })
    expect(bySheet.get('Sheet1')).toBeNull()
  })
})

describe('iso2768Deviation (ISO 2768-1 Tables 1 and 2)', () => {
  it('follows Table 1 range by range, upper bounds inclusive', () => {
    const m = [2, 3, 3.01, 6, 30, 120, 400, 1000, 2000, 4000].map(
      (n) => iso2768Deviation('m', n, 1)?.toleranceMm,
    )
    expect(m).toEqual([0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2])
    expect([1, 5, 10, 50, 200, 500, 1500, 3000].map((n) => iso2768Deviation('f', n, 1)?.toleranceMm ?? null)).toEqual([
      0.05, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, null,
    ])
    expect([1, 5, 10, 50, 200, 500, 1500, 3000].map((n) => iso2768Deviation('c', n, 1)?.toleranceMm)).toEqual([
      0.2, 0.3, 0.5, 0.8, 1.2, 2, 3, 4,
    ])
    expect([1, 5, 10, 50, 200, 500, 1500, 3000].map((n) => iso2768Deviation('v', n, 1)?.toleranceMm ?? null)).toEqual([
      null, 0.5, 1, 1.5, 2.5, 4, 6, 8,
    ])
  })

  it('gives nothing below 0.5 mm or above 4000 mm', () => {
    expect(iso2768Deviation('m', 0.4, 1)).toBeNull()
    expect(iso2768Deviation('m', 4001, 1)).toBeNull()
  })

  it('follows Table 2 for broken edges', () => {
    expect([1, 4, 10].map((n) => iso2768Deviation('m', n, 2)?.toleranceMm)).toEqual([0.2, 0.5, 1])
    expect([1, 4, 10].map((n) => iso2768Deviation('v', n, 2)?.toleranceMm)).toEqual([0.4, 1, 2])
    expect(iso2768Deviation('m', 10, 2)?.rangeMm).toEqual({ over: 6, upTo: null })
  })
})

describe('parseNominal', () => {
  it('reads plain values with counts, diameter and radius prefixes, fractions and units', () => {
    expect(parseNominal('10.00')).toMatchObject({ value: 10, places: 2, bareDecimal: false })
    expect(parseNominal('Ø10.5')).toMatchObject({ value: 10.5, places: 1 })
    expect(parseNominal('4X ⌀6.50')).toMatchObject({ value: 6.5, places: 2 })
    expect(parseNominal('R2')).toMatchObject({ value: 2, places: 0 })
    expect(parseNominal('.500')).toMatchObject({ value: 0.5, places: 3, bareDecimal: true })
    expect(parseNominal('1 1/4')).toMatchObject({ value: 1.25, places: null })
    expect(parseNominal('45°')).toMatchObject({ value: 45, angle: true })
  })

  it('refuses anything that is not a plain value', () => {
    for (const text of ['M6x1.0', 'Ø6 THRU', '30°15\'', '', 'A']) expect(parseNominal(text), text).toBeNull()
  })
})

describe('generalToleranceFor', () => {
  const iso = rules({ iso2768: { linear: 'm', geometric: 'K' } })

  it('applies ISO 2768-m Table 1 to a linear mm value, formatted to the nominal precision', () => {
    expect(generalToleranceFor(char({ nominal: '10.00' }), iso, 'mm')).toMatchObject({
      plus: '+0.20',
      minus: '-0.20',
      upper: '10.20',
      lower: '9.80',
      basis: { kind: 'iso2768', cls: 'm', table: 1, toleranceMm: 0.2, rangeMm: { over: 6, upTo: 30 } },
    })
    expect(generalToleranceFor(char({ nominal: 'Ø150' }), iso, 'mm')?.plus).toBe('+0.5')
  })

  it('applies Table 2 to radii and chamfers', () => {
    const g = generalToleranceFor(char({ nominal: 'R2', subType: 'Radius' }), iso, 'mm')
    expect(g).toMatchObject({ plus: '+0.2', upper: '2.2', lower: '1.8', basis: { table: 2 } })
  })

  it('converts an inch value for the ISO table and back', () => {
    const g = generalToleranceFor(char({ nominal: '1.000', unit: 'in' }), iso, 'in')
    expect(g?.plus).toBe('+0.0079')
    expect(g?.upper).toBe('1.0079')
  })

  it('leaves values ISO 2768 does not cover untoleranced: below 0.5 mm, a "-" cell, angles', () => {
    expect(generalToleranceFor(char({ nominal: '0.30' }), iso, 'mm')).toBeNull()
    const v = rules({ iso2768: { linear: 'v', geometric: null } })
    expect(generalToleranceFor(char({ nominal: '2.0' }), v, 'mm')).toBeNull()
    expect(generalToleranceFor(char({ nominal: '45°', unit: '°', subType: 'Angular' }), iso, 'mm')).toBeNull()
  })

  it('takes the rule for the number of decimal places (metric)', () => {
    const metric = parseGeneralTolerances([note('X ±0.5\nX.X ±0.2\nX.XX ±0.1')])
    expect(generalToleranceFor(char({ nominal: '12' }), metric, 'mm')).toMatchObject({
      plus: '+0.5',
      upper: '12.5',
      lower: '11.5',
      basis: { kind: 'decimal', places: 0 },
    })
    expect(generalToleranceFor(char({ nominal: '12.5' }), metric, 'mm')?.plus).toBe('+0.2')
    expect(generalToleranceFor(char({ nominal: '12.50' }), metric, 'mm')).toMatchObject({
      plus: '+0.10',
      upper: '12.60',
      lower: '12.40',
    })
    // No three-place rule, no all-values rule, no ISO: nothing is guessed.
    expect(generalToleranceFor(char({ nominal: '12.500' }), metric, 'mm')).toBeNull()
  })

  it('takes inch .XX / .XXX rules and keeps the drawing\'s leading-zero style', () => {
    const inch = parseGeneralTolerances([
      note('DIMENSIONS ARE IN INCHES\nTWO PLACE DECIMAL ±.01\nTHREE PLACE DECIMAL ±.005'),
    ])
    expect(generalToleranceFor(char({ nominal: '.500', unit: 'in' }), inch, 'in')).toMatchObject({
      plus: '+.005',
      minus: '-.005',
      upper: '.505',
      lower: '.495',
      basis: { kind: 'decimal', places: 3, tolerance: '.005' },
    })
    expect(generalToleranceFor(char({ nominal: '1.25', unit: 'in' }), inch, 'in')).toMatchObject({
      plus: '+0.01',
      upper: '1.26',
    })
  })

  it('takes the fractional rule for fractions only', () => {
    const r = parseGeneralTolerances([note('FRACTIONAL ±1/64\nTWO PLACE DECIMAL ±.01')])
    expect(generalToleranceFor(char({ nominal: '1/2', unit: 'in' }), r, 'in')).toMatchObject({
      plus: '+0.0156',
      upper: '0.5156',
      lower: '0.4844',
      basis: { kind: 'fractional', tolerance: '1/64' },
    })
    expect(generalToleranceFor(char({ nominal: '0.50', unit: 'in' }), r, 'in')?.basis.kind).toBe('decimal')
  })

  it('takes the angular rule for angles', () => {
    const r = parseGeneralTolerances([note('ANGULAR: MACH ±0.5°')])
    expect(generalToleranceFor(char({ nominal: '45°', unit: '°', subType: 'Angular' }), r, 'mm')).toMatchObject({
      plus: '+0.5°',
      upper: '45.5°',
      lower: '44.5°',
      basis: { kind: 'angular' },
    })
  })

  it('does not apply rules stated for another unit', () => {
    const inch = parseGeneralTolerances([note('DIMENSIONS ARE IN INCHES\nTWO PLACE DECIMAL ±.01')])
    expect(generalToleranceFor(char({ nominal: '10.00', unit: 'mm' }), inch, 'mm')).toBeNull()
  })

  it('uses the drawing units for a value without its own unit', () => {
    const r = rules({ unit: 'in', decimal: [{ places: 2, tolerance: { value: 0.01, places: 2, text: '.01' } }] })
    expect(generalToleranceFor(char({ nominal: '1.00', unit: null }), r, 'in')?.plus).toBe('+0.01')
    expect(generalToleranceFor(char({ nominal: '1.00', unit: null }), r, 'mm')).toBeNull()
  })

  it('treats Block, General and Unknown tolerance types as untoleranced, even with service values', () => {
    const r = rules({ linear: { value: 0.1, places: 1, text: '0.1' } })
    for (const toleranceType of ['Block', 'General', 'Unknown']) {
      const c = char({ toleranceType, plusTolerance: '+0.3', minusTolerance: '-0.3' })
      expect(generalToleranceFor(c, r, 'mm')?.plus, toleranceType).toBe('+0.10')
    }
  })

  it('applies only to untoleranced, non-reference dimension values', () => {
    const r = rules({ linear: { value: 0.1, places: 1, text: '0.1' } })
    expect(generalToleranceFor(char(), r, 'mm')?.basis.kind).toBe('linear')
    expect(generalToleranceFor(char({ toleranceType: null }), r, 'mm')).not.toBeNull()
    expect(generalToleranceFor(char({ toleranceType: 'Bilateral', plusTolerance: '+0.1' }), r, 'mm')).toBeNull()
    expect(generalToleranceFor(char({ toleranceType: 'Basic' }), r, 'mm')).toBeNull()
    expect(generalToleranceFor(char({ isReference: true }), r, 'mm')).toBeNull()
    expect(generalToleranceFor(char({ kind: 'gtol', nominal: '0.05' }), r, 'mm')).toBeNull()
    expect(generalToleranceFor(char({ kind: 'surfaceFinish', nominal: '1.6' }), r, 'mm')).toBeNull()
    expect(generalToleranceFor(char({ kind: 'holeCallout' }), r, 'mm')).not.toBeNull()
    expect(generalToleranceFor(char({ nominal: 'M6x1.0' }), r, 'mm')).toBeNull()
    expect(generalToleranceFor(char(), null, 'mm')).toBeNull()
  })
})
