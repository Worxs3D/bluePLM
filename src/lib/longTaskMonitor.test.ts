import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/performanceMetrics', () => ({ recordMetric: vi.fn() }))

// The first dynamic import transforms the module graph, which is slow on a loaded machine.
const IMPORT_TIMEOUT_MS = 30_000

describe('reportStallToMain', { timeout: IMPORT_TIMEOUT_MS }, () => {
  const reportRendererStall = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    reportRendererStall.mockReset()
    vi.stubGlobal('window', { electronAPI: { reportRendererStall } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tells the main process about a stall of two seconds or more', async () => {
    const { reportStallToMain } = await import('./longTaskMonitor')

    reportStallToMain(2400.6, 'long-animation-frame')

    expect(reportRendererStall).toHaveBeenCalledWith({ durationMs: 2401, source: 'long-animation-frame' })
  })

  it('ignores shorter stalls', async () => {
    const { reportStallToMain } = await import('./longTaskMonitor')

    reportStallToMain(1999, 'watchdog')

    expect(reportRendererStall).not.toHaveBeenCalled()
  })

  it('does not repeat inside the cooldown', async () => {
    const { reportStallToMain } = await import('./longTaskMonitor')

    reportStallToMain(5000, 'watchdog')
    reportStallToMain(9000, 'long-animation-frame')

    expect(reportRendererStall).toHaveBeenCalledTimes(1)
  })

  it('never throws, even when the bridge is missing or fails', async () => {
    const { reportStallToMain } = await import('./longTaskMonitor')

    vi.stubGlobal('window', {})
    expect(() => reportStallToMain(5000, 'watchdog')).not.toThrow()

    vi.resetModules()
    const again = await import('./longTaskMonitor')
    vi.stubGlobal('window', {
      electronAPI: {
        reportRendererStall: () => {
          throw new Error('ipc closed')
        },
      },
    })
    expect(() => again.reportStallToMain(5000, 'watchdog')).not.toThrow()
  })
})
