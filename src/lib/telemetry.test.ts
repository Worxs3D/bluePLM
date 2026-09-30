import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('telemetry activation', () => {
  let values: Map<string, string>

  beforeEach(() => {
    vi.resetModules()
    values = new Map<string, string>()
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

  it('persists start and stop state across renderer reloads and clears timers', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { telemetry } = await import('./telemetry')

    telemetry.loadConfig()
    telemetry.start()
    expect(JSON.parse(values.get('telemetry.config') ?? '{}').enabled).toBe(true)
    expect(telemetry.isRunning()).toBe(true)

    telemetry.stop()
    expect(JSON.parse(values.get('telemetry.config') ?? '{}').enabled).toBe(false)
    expect(telemetry.isRunning()).toBe(false)
    expect(clearIntervalSpy).toHaveBeenCalled()
    expect(cancelAnimationFrame).toHaveBeenCalled()

    vi.resetModules()
    const reloaded = await import('./telemetry')
    reloaded.telemetry.loadConfig()
    expect(reloaded.telemetry.isRunning()).toBe(false)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
  })
})
