import { describe, expect, it } from 'vitest'

import { isPerfBootRequested, PERF_BOOT_ARG } from './perfBootFlag'

describe('perf boot flag', () => {
  it('is on only for an unpackaged app with the env flag', () => {
    expect(isPerfBootRequested(false, { BLUEPLM_PERF_BOOT: '1' })).toBe(true)
    expect(isPerfBootRequested(true, { BLUEPLM_PERF_BOOT: '1' })).toBe(false)
    expect(isPerfBootRequested(false, { BLUEPLM_PERF_BOOT: 'true' })).toBe(false)
    expect(isPerfBootRequested(false, {})).toBe(false)
    expect(PERF_BOOT_ARG.startsWith('--')).toBe(true)
  })
})
