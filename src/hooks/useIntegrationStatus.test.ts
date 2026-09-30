import { afterEach, describe, expect, it, vi } from 'vitest'

import { startIntegrationStatusPolling } from './useIntegrationStatus'

describe('integration status backup polling', () => {
  afterEach(() => vi.useRealTimers())

  it('suppresses 5-second backup checks while an MDB update is required and resumes after capability recovery', async () => {
    vi.useFakeTimers()
    const getBackupStatus = vi
      .fn()
      .mockResolvedValueOnce({ updateRequired: true })
      .mockResolvedValue({ updateRequired: false })
    const check = vi.fn(async (includeBackup: boolean) => {
      if (!includeBackup) return true
      return Boolean((await getBackupStatus()).updateRequired)
    })
    const polling = startIntegrationStatusPolling({ check, isOnline: () => true })

    await polling.checkNow(true)
    await vi.advanceTimersByTimeAsync(55_000)
    expect(getBackupStatus).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(getBackupStatus).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(getBackupStatus).toHaveBeenCalledTimes(3)
    polling.stop()
  })
})
