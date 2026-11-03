import { describe, expect, it } from 'vitest'

import type { InspectionReport } from '../../types/inspectionReports'
import { mergeDrawingReports } from './inspectionReportsSlice'

const r = (id: string) => ({ id }) as InspectionReport

describe('mergeDrawingReports', () => {
  it('stores lists and marks loaded drawings without reports as empty', () => {
    const next = mergeDrawingReports(new Map(), ['a', 'b'], new Map([['a', [r('1')]]]))
    expect(next.get('a')).toEqual([r('1')])
    expect(next.get('b')).toEqual([])
  })

  it('keeps at most the cap, dropping the least recently written', () => {
    let map = new Map<string, InspectionReport[]>()
    map = mergeDrawingReports(map, ['a', 'b', 'c'], new Map(), 3)
    map = mergeDrawingReports(map, ['a'], new Map(), 3)
    map = mergeDrawingReports(map, ['d'], new Map(), 3)
    expect([...map.keys()]).toEqual(['c', 'a', 'd'])
  })
})
