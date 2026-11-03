import { describe, expect, it } from 'vitest'

import { formatSpec, formatTolerance, type InspectionReportRow } from './format'
import { parseTokens, resolveScalar } from './tokens'
import { computeVerdict, limitsOf, parseQuantity, parseVerdictText, summarizeResults } from './verdict'

function row(over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return {
    id: 'r',
    sort_order: 0,
    balloon_number: '1',
    char_id: null,
    zone: null,
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '25.40',
    unit: 'mm',
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
    source_key: 'k',
    source_sheet: null,
    source_view: null,
    ...over,
  }
}

describe('parseQuantity', () => {
  it('reads plain, prefixed, unit-suffixed, fractional and DMS values', () => {
    expect(parseQuantity('25.40')).toEqual({ value: 25.4, unit: null })
    expect(parseQuantity('Ø6.35')).toEqual({ value: 6.35, unit: null })
    expect(parseQuantity('4X R2.5')).toEqual({ value: 2.5, unit: null })
    expect(parseQuantity('1.000 in')).toEqual({ value: 1, unit: 'in' })
    expect(parseQuantity('25.4mm')).toEqual({ value: 25.4, unit: 'mm' })
    expect(parseQuantity('1 1/4')).toEqual({ value: 1.25, unit: null })
    expect(parseQuantity('12,5')).toEqual({ value: 12.5, unit: null })
    expect(parseQuantity(`45°30'`)?.value).toBeCloseTo(45.5)
    expect(parseQuantity('30°')).toEqual({ value: 30, unit: 'deg' })
    expect(parseQuantity('12.5 MIN')).toEqual({ value: 12.5, unit: null })
  })

  it('refuses text that is not one number', () => {
    expect(parseQuantity('M6x1.0')).toBeNull()
    expect(parseQuantity('Ø6.6 THRU')).toBeNull()
    expect(parseQuantity('OK')).toBeNull()
    expect(parseQuantity('')).toBeNull()
  })
})

describe('computeVerdict', () => {
  it('symmetric and bilateral tolerances, inclusive at the limits', () => {
    const r = row({ plus_tolerance: '+0.10', minus_tolerance: '-0.10' })
    expect(computeVerdict(r, ['25.50'])).toBe('pass')
    expect(computeVerdict(r, ['25.30'])).toBe('pass')
    expect(computeVerdict(r, ['25.51'])).toBe('fail')
    const b = row({ plus_tolerance: '+0.05', minus_tolerance: '-0.15' })
    expect(computeVerdict(b, ['25.25'])).toBe('pass')
    expect(computeVerdict(b, ['25.46'])).toBe('fail')
  })

  it('± in the plus column and an unsigned single tolerance are symmetric', () => {
    expect(computeVerdict(row({ plus_tolerance: '±0.2' }), ['25.2'])).toBe('pass')
    expect(computeVerdict(row({ plus_tolerance: '0.2' }), ['25.19'])).toBe('fail')
  })

  it('limits, one-sided limits and MIN / MAX nominals', () => {
    expect(computeVerdict(row({ upper_limit: '12.60', lower_limit: '12.40' }), ['12.5'])).toBe('pass')
    expect(computeVerdict(row({ upper_limit: '12.60', lower_limit: '12.40' }), ['12.61'])).toBe('fail')
    expect(computeVerdict(row({ nominal_value: '3.2 MIN' }), ['3.5'])).toBe('pass')
    expect(computeVerdict(row({ nominal_value: '3.2 MIN' }), ['3.1'])).toBe('fail')
    expect(computeVerdict(row({ nominal_value: '0.8 MAX' }), ['0.9'])).toBe('fail')
    expect(computeVerdict(row({ nominal_value: null, lower_limit: '10' }), ['10'])).toBe('pass')
  })

  it('every measured value must pass; blanks are ignored', () => {
    const r = row({ plus_tolerance: '+0.1', minus_tolerance: '-0.1' })
    expect(computeVerdict(r, ['25.4', '', '25.45'])).toBe('pass')
    expect(computeVerdict(r, ['25.4', '25.6'])).toBe('fail')
    expect(computeVerdict(r, ['', ' '])).toBeNull()
  })

  it('converts inch / mm measurements and refuses angle / length mixes', () => {
    const inch = row({ nominal_value: '1.000', unit: 'in', plus_tolerance: '+0.005', minus_tolerance: '-0.005' })
    expect(computeVerdict(inch, ['25.45 mm'])).toBe('pass')
    expect(computeVerdict(inch, ['25.6mm'])).toBe('fail')
    const mm = row({ plus_tolerance: '+0.1', minus_tolerance: '-0.1' })
    expect(computeVerdict(mm, ['1.0 in'])).toBe('pass')
    expect(computeVerdict(mm, ['25.4°'])).toBeNull()
  })

  it('angles in decimal degrees or DMS', () => {
    const angle = row({ nominal_value: '45°', unit: '°', sub_type: 'Angular', plus_tolerance: `+0°30'`, minus_tolerance: `-0°30'` })
    expect(limitsOf(angle)).toEqual({ lower: 44.5, upper: 45.5, unit: 'deg' })
    expect(computeVerdict(angle, [`45°20'`])).toBe('pass')
    expect(computeVerdict(angle, ['45.6'])).toBe('fail')
  })

  it('GTOL and surface finish values are maxima', () => {
    expect(computeVerdict(row({ char_type: 'GTOL', sub_type: 'Position', nominal_value: 'Ø0.10' }), ['0.08'])).toBe('pass')
    expect(computeVerdict(row({ char_type: 'GTOL', nominal_value: '0.05' }), ['0.06'])).toBe('fail')
    expect(computeVerdict(row({ char_type: 'Note', sub_type: 'Surface Finish', nominal_value: '1.6' }), ['1.2'])).toBe('pass')
  })

  it('a GTOL at MMC / LMC has no computed verdict (bonus tolerance), so the entered verdict stands', () => {
    const atMmc = row({ char_type: 'GTOL', sub_type: 'Position', nominal_value: 'Ø0.10 Ⓜ', upper_limit: '0.10' })
    expect(limitsOf(atMmc)).toBeNull()
    expect(computeVerdict(atMmc, ['0.14'])).toBeNull()
    expect(computeVerdict(row({ char_type: 'GTOL', nominal_value: '0.05Ⓛ' }), ['0.06'])).toBeNull()
    expect(computeVerdict(row({ char_type: 'GTOL', nominal_value: 'Ø0.10 M' }), ['0.2'])).toBeNull()
    expect(computeVerdict(row({ char_type: 'GTOL', nominal_value: '0.10 (M)' }), ['0.2'])).toBeNull()
    expect(computeVerdict(row({ char_type: 'GTOL', sub_type: 'Position MMC', nominal_value: '0.10' }), ['0.2'])).toBeNull()
    // RFS stays a maximum.
    expect(computeVerdict(row({ char_type: 'GTOL', sub_type: 'Position', nominal_value: 'Ø0.10' }), ['0.14'])).toBe('fail')
  })

  it('non-numeric requirements or measurements leave the verdict to the recipient', () => {
    expect(computeVerdict(row({ nominal_value: 'M6x1.0', plus_tolerance: '+0.1' }), ['6'])).toBeNull()
    expect(computeVerdict(row(), ['25.4'])).toBeNull() // untoleranced / basic
    expect(computeVerdict(row({ plus_tolerance: '+0.1', minus_tolerance: '-0.1' }), ['OK'])).toBeNull()
  })

  it('uses a filled-in general tolerance like any other', () => {
    const r = row({ plus_tolerance: '+0.2', minus_tolerance: '-0.2', tolerance_source: 'general' })
    expect(computeVerdict(r, ['25.6'])).toBe('pass')
  })
})

describe('verdict text and summary', () => {
  it('parses typed verdicts', () => {
    expect(parseVerdictText(' PASS ')).toBe('pass')
    expect(parseVerdictText('ok')).toBe('pass')
    expect(parseVerdictText('NG')).toBe('fail')
    expect(parseVerdictText('Reject')).toBe('fail')
    expect(parseVerdictText('maybe')).toBeNull()
  })

  it('summarizes', () => {
    expect(summarizeResults([{ verdict: 'pass' }, { verdict: 'fail' }, { verdict: null }, { verdict: 'pass' }])).toEqual({
      total: 4,
      pass: 2,
      fail: 1,
      blank: 1,
    })
  })
})

describe('tolerance and spec text', () => {
  it('formats the combined fields', () => {
    expect(formatTolerance(row({ plus_tolerance: '+0.10', minus_tolerance: '-0.10' }))).toBe('±0.10')
    expect(formatTolerance(row({ plus_tolerance: '0.05', minus_tolerance: '0.15' }))).toBe('+0.05 / -0.15')
    expect(formatTolerance(row({ upper_limit: '12.60', lower_limit: '12.40' }))).toBe('12.40 – 12.60')
    expect(formatTolerance(row({ lower_limit: '3' }))).toBe('3 MIN')
    expect(formatSpec(row({ plus_tolerance: '+0.10', minus_tolerance: '-0.10' }))).toBe('25.40 ±0.10')
    expect(formatSpec(row({ nominal_value: '12.50', upper_limit: '12.60', lower_limit: '12.40' }))).toBe('12.50 (12.40 – 12.60)')
    expect(formatSpec(row())).toBe('25.40')
  })

  it('states a GTOL frame once: its tolerance is already in the frame', () => {
    const gtol = row({ char_type: 'GTOL', sub_type: 'Position', nominal_value: '⌖ Ø0.05 Ⓜ A B C', upper_limit: '0.05' })
    expect(formatSpec(gtol)).toBe('⌖ Ø0.05 Ⓜ A B C')
    expect(formatSpec(row({ char_type: 'GTOL', nominal_value: '⏥ 0.02', plus_tolerance: '0.02' }))).toBe('⏥ 0.02')
    // No frame text: the tolerance is all there is to state.
    expect(formatSpec(row({ char_type: 'GTOL', nominal_value: null, upper_limit: '0.05' }))).toBe('0.05 MAX')
  })
})

describe('tokens', () => {
  it('keeps the Google Sheets tokens working', () => {
    expect(resolveScalar('BR_NUMBER')).toBe('PART_NUMBER')
    expect(parseTokens('{{COL:balloon}} {{RESULT}} {{RESULT:3}} {{PROP:Material}} {{nope}}').map((t) => t.kind)).toEqual([
      'col',
      'result',
      'result',
      'prop',
      'unknown',
    ])
  })
})
