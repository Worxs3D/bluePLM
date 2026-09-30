import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('telemetry activation', () => {
  beforeEach(() => {
    vi.resetModules()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('window', globalThis)
  })

  it('does not collect FPS samples while recording is disabled', async () => {
    const { telemetry } = await import('./telemetry')

    telemetry.loadConfig()

    expect(telemetry.isRunning()).toBe(false)
    expect(telemetry.getHistory()).toHaveLength(0)
  })

  it('restores an explicitly enabled recording session after reload', async () => {
    localStorage.setItem(
      'telemetry.config',
      JSON.stringify({ enabled: true, sampleRateHz: 1, retentionSeconds: 10 }),
    )
    const { telemetry } = await import('./telemetry')

    telemetry.loadConfig()

    expect(telemetry.isRunning()).toBe(true)
    telemetry.stop()
  })
})
