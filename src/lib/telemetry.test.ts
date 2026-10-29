import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('telemetry opt-in persistence', () => {
  let values: Map<string, string>

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('window', globalThis)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('persists recording start and stop and restores only saved opt-in state', async () => {
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

    vi.resetModules()
    const disabledReload = await import('./telemetry')
    disabledReload.telemetry.loadConfig()
    expect(disabledReload.telemetry.isRunning()).toBe(false)

    values.set(
      'telemetry.config',
      JSON.stringify({ enabled: true, sampleRateHz: 1, retentionSeconds: 10 }),
    )
    vi.resetModules()
    const optedInReload = await import('./telemetry')
    optedInReload.telemetry.loadConfig()
    expect(optedInReload.telemetry.isRunning()).toBe(true)
    optedInReload.telemetry.stop()

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(2)
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
  })

  it('resizes history to restored retention before resuming recording', async () => {
    values.set(
      'telemetry.config',
      JSON.stringify({ enabled: true, sampleRateHz: 60, retentionSeconds: 300 }),
    )
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { telemetry } = await import('./telemetry')

    telemetry.loadConfig()
    const sample = intervalSpy.mock.calls[0]?.[0]
    expect(typeof sample).toBe('function')
    for (let index = 0; index < 18_001; index++) {
      ;(sample as () => void)()
    }

    expect(telemetry.getHistory()).toHaveLength(18_000)
    expect(telemetry.getConfig()).toEqual({
      enabled: true,
      sampleRateHz: 60,
      retentionSeconds: 300,
    })
    telemetry.stop()
  })

  it('clamps invalid saved settings and keeps saved opt-in strict', async () => {
    values.set(
      'telemetry.config',
      JSON.stringify({ enabled: 'yes', sampleRateHz: 1000, retentionSeconds: -20 }),
    )
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { telemetry } = await import('./telemetry')

    expect(telemetry.loadConfig()).toEqual({
      enabled: false,
      sampleRateHz: 60,
      retentionSeconds: 10,
    })
    expect(telemetry.isRunning()).toBe(false)
    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('does not start duplicate timers when saved opt-in config is loaded repeatedly', async () => {
    values.set(
      'telemetry.config',
      JSON.stringify({ enabled: true, sampleRateHz: 10, retentionSeconds: 20 }),
    )
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { telemetry } = await import('./telemetry')

    telemetry.loadConfig()
    telemetry.loadConfig()

    expect(intervalSpy).toHaveBeenCalledTimes(1)
    expect(telemetry.isRunning()).toBe(true)
    telemetry.stop()
  })

  it('keeps recording usable when browser storage cannot be written', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })
    const { telemetry } = await import('./telemetry')

    expect(() => telemetry.start()).not.toThrow()
    expect(telemetry.isRunning()).toBe(true)
    expect(() => telemetry.stop()).not.toThrow()
    expect(telemetry.isRunning()).toBe(false)
  })
})
