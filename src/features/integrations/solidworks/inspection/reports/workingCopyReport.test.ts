import { describe, expect, it } from 'vitest'

import type { InspectionReportRow } from '@/lib/inspection/excel'
import { emptyRowValues } from '@/lib/supabase/files/inspectionRows'

import { workingCopyDiffers } from './workingCopyReport'

function row(id: string, over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return { ...emptyRowValues(0), id, source_key: `k-${id}`, nominal_value: '10', ...over } as InspectionReportRow
}

describe('workingCopyDiffers', () => {
  it('is false when the copy is unchanged and the table matches the version', () => {
    const live = [row('a'), row('b')]
    const version = [row('va', { source_key: 'k-a' }), row('vb', { source_key: 'k-b' })]
    expect(workingCopyDiffers({ modified: false, liveRows: live, versionRows: version })).toBe(false)
  })

  it('is true for rows extracted after the version (the version has none)', () => {
    expect(workingCopyDiffers({ modified: false, liveRows: [row('a')], versionRows: [] })).toBe(true)
  })

  it('is true when the drawing file changed (balloons are saved into it)', () => {
    expect(workingCopyDiffers({ modified: true, liveRows: [], versionRows: [] })).toBe(true)
  })

  it('is true when a requirement changed with the same number of rows', () => {
    const live = [row('a', { nominal_value: '12' })]
    const version = [row('va', { source_key: 'k-a' })]
    expect(workingCopyDiffers({ modified: false, liveRows: live, versionRows: version })).toBe(true)
  })

  it('is true when only the balloon numbers changed', () => {
    const live = [row('a', { balloon_number: '7' })]
    const version = [row('va', { source_key: 'k-a', balloon_number: '1' })]
    expect(workingCopyDiffers({ modified: false, liveRows: live, versionRows: version })).toBe(true)
  })
})
