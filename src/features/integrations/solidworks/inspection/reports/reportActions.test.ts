import { describe, expect, it } from 'vitest'

import { isReportNumberTaken } from './reportActions'

describe('isReportNumberTaken', () => {
  it('recognises the database refusal by code or message', () => {
    expect(isReportNumberTaken(Object.assign(new Error('taken'), { code: 'REPORT_NUMBER_TAKEN' }))).toBe(true)
    expect(isReportNumberTaken(new Error('REPORT_NUMBER_TAKEN: X-IR2'))).toBe(true)
    expect(isReportNumberTaken(new Error('permission denied'))).toBe(false)
    expect(isReportNumberTaken(null)).toBe(false)
  })
})
