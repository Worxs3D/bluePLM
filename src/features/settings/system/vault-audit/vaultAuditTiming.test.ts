import { describe, expect, it } from 'vitest'

import { estimateRemainingMs, formatDuration } from './vaultAuditTiming'

describe('estimateRemainingMs', () => {
  it('waits for a sample worth quoting', () => {
    expect(estimateRemainingMs(null, { at: 10_000, completed: 100 }, 1000)).toBeNull()
    expect(
      estimateRemainingMs({ at: 0, completed: 1 }, { at: 1000, completed: 100 }, 1000),
    ).toBeNull()
    expect(
      estimateRemainingMs({ at: 0, completed: 1 }, { at: 9000, completed: 5 }, 1000),
    ).toBeNull()
  })

  it('extrapolates the rate since the first counted file', () => {
    // 200 files in 4 s: 20 ms each, 800 left.
    expect(
      estimateRemainingMs({ at: 1000, completed: 0 }, { at: 5000, completed: 200 }, 1000),
    ).toBe(16_000)
  })

  it('never goes below zero', () => {
    expect(estimateRemainingMs({ at: 0, completed: 0 }, { at: 5000, completed: 100 }, 100)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats minutes and seconds, and hours when there are any', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(42_000)).toBe('0:42')
    expect(formatDuration(185_000)).toBe('3:05')
    expect(formatDuration(3_729_000)).toBe('1:02:09')
  })
})
