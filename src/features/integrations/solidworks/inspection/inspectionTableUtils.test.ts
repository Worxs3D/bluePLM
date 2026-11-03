import { describe, expect, it } from 'vitest'

import type { InspectionRowValues } from '@/lib/supabase'

import { generalToleranceMarkerColumn } from './inspectionTableUtils'

type Tol = Pick<
  InspectionRowValues,
  'tolerance_source' | 'plus_tolerance' | 'minus_tolerance' | 'upper_limit' | 'lower_limit'
>

const row = (over: Partial<Tol>): Tol => ({
  tolerance_source: 'general',
  plus_tolerance: '0.2',
  minus_tolerance: '0.2',
  upper_limit: null,
  lower_limit: null,
  ...over,
})
const shown = (...keys: (keyof InspectionRowValues)[]) => new Set(keys)

describe('generalToleranceMarkerColumn', () => {
  it('marks one column only: the first shown tolerance with a value', () => {
    expect(generalToleranceMarkerColumn(row({}), shown('plus_tolerance', 'minus_tolerance'))).toBe(
      'plus_tolerance',
    )
    expect(generalToleranceMarkerColumn(row({}), shown('minus_tolerance'))).toBe('minus_tolerance')
    expect(
      generalToleranceMarkerColumn(
        row({ plus_tolerance: null, minus_tolerance: null, upper_limit: '8.2' }),
        shown('plus_tolerance', 'upper_limit'),
      ),
    ).toBe('upper_limit')
  })

  it('falls back to the first shown tolerance column when none holds a value', () => {
    expect(
      generalToleranceMarkerColumn(
        row({ plus_tolerance: null, minus_tolerance: '' }),
        shown('minus_tolerance', 'lower_limit'),
      ),
    ).toBe('minus_tolerance')
  })

  it('leaves it to the Tol. Source column when that is shown, and marks nothing for drawing tolerances', () => {
    expect(
      generalToleranceMarkerColumn(row({}), shown('plus_tolerance', 'tolerance_source')),
    ).toBeNull()
    expect(
      generalToleranceMarkerColumn(row({ tolerance_source: 'drawing' }), shown('plus_tolerance')),
    ).toBeNull()
    expect(generalToleranceMarkerColumn(row({}), shown('nominal_value'))).toBeNull()
  })
})
