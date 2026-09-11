import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCommandConfirm = vi.fn()

vi.mock('@/lib/commands/executor', () => ({ resolveCommandConfirm }))

const { cancelPendingCommandConfirm } = await import('./terminalConfirmCancel')

describe('cancelPendingCommandConfirm', () => {
  beforeEach(() => {
    resolveCommandConfirm.mockClear()
  })

  it('declines the pending confirmation and reports that it did', () => {
    const pending = { title: 'Adopt server paths?', message: 'Rename 12 files?' }

    const cancelled = cancelPendingCommandConfirm(pending)

    expect(cancelled).toBe(true)
    expect(resolveCommandConfirm).toHaveBeenCalledTimes(1)
    expect(resolveCommandConfirm).toHaveBeenCalledWith(false)
  })

  it('is a no-op when nothing is pending, so Ctrl+C can fall back to its other meaning', () => {
    const cancelled = cancelPendingCommandConfirm(null)

    expect(cancelled).toBe(false)
    expect(resolveCommandConfirm).not.toHaveBeenCalled()
  })
})
