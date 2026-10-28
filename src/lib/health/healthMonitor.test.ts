import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createHealthMonitor,
  DEFAULT_HEALTH_OPTIONS,
  MAX_RECOVERIES_KEPT,
  type HealthMonitorDeps,
} from './healthMonitor'

const MIN = 60_000

function setup(overrides: Partial<HealthMonitorDeps> = {}) {
  let now = 1_000_000
  const states = new Map<string, string>([
    ['files', 'joined'],
    ['activity', 'joined'],
  ])
  const warnings: string[] = []
  const deps: HealthMonitorDeps = {
    now: () => now,
    online: () => true,
    realtimeStates: () => [...states].map(([kind, state]) => ({ kind, state })),
    resubscribe: vi.fn((kinds: readonly string[]) => {
      for (const kind of kinds) states.set(kind, 'joined')
      return [...kinds]
    }),
    probeVaultCache: vi.fn(async () => true),
    heap: () => ({ usedMB: 300, limitMB: 4096 }),
    dropCaches: vi.fn(() => ['sw-references', 'config-caches']),
    diagnostics: () => ({ 'store.files': 30_000 }),
    log: { info: () => {}, warn: (message) => warnings.push(message) },
    ...overrides,
  }
  const monitor = createHealthMonitor(deps)
  return {
    monitor,
    deps,
    states,
    warnings,
    advance(ms: number) {
      now += ms
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('health monitor: realtime', () => {
  it('resubscribes a channel left errored for minutes, logs it, and only that channel', async () => {
    const { monitor, deps, states, warnings, advance } = setup()
    states.set('files', 'errored')
    expect(await monitor.tick()).toEqual([])
    advance(2 * MIN)
    expect(await monitor.tick()).toEqual([])
    advance(2 * MIN)
    const [recovery] = await monitor.tick()
    expect(recovery.kind).toBe('realtime-resubscribed')
    expect(deps.resubscribe).toHaveBeenCalledWith(['files'])
    expect(warnings[0]).toMatch(/resubscribed files/)
    expect(monitor.counts()['realtime-resubscribed']).toBe(1)
  })

  it('leaves a channel that rejoins on its own alone', async () => {
    const { monitor, deps, states, advance } = setup()
    states.set('files', 'joining')
    await monitor.tick()
    advance(2 * MIN)
    states.set('files', 'joined')
    await monitor.tick()
    advance(5 * MIN)
    await monitor.tick()
    expect(deps.resubscribe).not.toHaveBeenCalled()
  })

  it('does nothing while offline: the rejoin then is supabase-js work', async () => {
    const { monitor, deps, states, advance } = setup({ online: () => false })
    states.set('files', 'errored')
    for (let i = 0; i < 10; i++) {
      await monitor.tick()
      advance(MIN)
    }
    expect(deps.resubscribe).not.toHaveBeenCalled()
  })

  it('waits out its cooldown between resubscribes', async () => {
    const { monitor, deps, states, advance } = setup({ resubscribe: vi.fn(() => ['files']) })
    states.set('files', 'errored')
    await monitor.tick() // t0: first seen errored
    advance(4 * MIN)
    await monitor.tick() // t4: dead for 4 min, resubscribed
    expect(deps.resubscribe).toHaveBeenCalledTimes(1)
    // Still errored after that try. It counts as dead again from t5...
    advance(MIN)
    await monitor.tick()
    advance(3 * MIN)
    await monitor.tick() // t8: dead again, but only 4 min since the last try
    expect(deps.resubscribe).toHaveBeenCalledTimes(1)
    advance(1.5 * MIN)
    await monitor.tick() // t9.5: past the 5 min cooldown
    expect(deps.resubscribe).toHaveBeenCalledTimes(2)
  })
})

describe('health monitor: IndexedDB', () => {
  it('probes the vault cache on its own cadence and records a failed probe', async () => {
    const probe = vi.fn(async () => false)
    const { monitor, advance } = setup({ probeVaultCache: probe })
    const [first] = await monitor.tick()
    expect(first.kind).toBe('vault-cache-probe-failed')
    advance(MIN)
    expect(await monitor.tick()).toEqual([])
    advance(DEFAULT_HEALTH_OPTIONS.vaultCacheProbeEveryMs)
    await monitor.tick()
    expect(probe).toHaveBeenCalledTimes(2)
  })
})

describe('health monitor: heap', () => {
  it('drops rebuildable caches past the high-water mark and logs what the store held', async () => {
    const warn = vi.fn()
    const { monitor, deps } = setup({
      heap: () => ({ usedMB: 3000, limitMB: 4096 }),
      log: { info: () => {}, warn },
    })
    const [recovery] = await monitor.tick()
    expect(recovery.kind).toBe('heap-caches-dropped')
    expect(deps.dropCaches).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Heap 3000 MB is over its 2048 MB/),
      expect.objectContaining({ dropped: ['sw-references', 'config-caches'], diagnostics: { 'store.files': 30_000 } }),
    )
  })

  it('leaves the caches alone below the mark and when the browser gives no reading', async () => {
    const { monitor, deps } = setup({ heap: () => null })
    await monitor.tick()
    expect(deps.dropCaches).not.toHaveBeenCalled()
  })
})

describe('health monitor: its own footprint', () => {
  it('keeps at most a fixed number of recoveries however many it makes', async () => {
    const { monitor, advance } = setup({
      heap: () => ({ usedMB: 3000, limitMB: 4096 }),
      probeVaultCache: async () => false,
    })
    for (let i = 0; i < MAX_RECOVERIES_KEPT * 4; i++) {
      await monitor.tick()
      advance(DEFAULT_HEALTH_OPTIONS.vaultCacheProbeEveryMs)
    }
    expect(monitor.recoveries()).toHaveLength(MAX_RECOVERIES_KEPT)
    expect(monitor.counts()['heap-caches-dropped']).toBe(MAX_RECOVERIES_KEPT * 4)
  })

  it('holds one interval while running and none after stop, over many start/stop cycles', () => {
    vi.useFakeTimers()
    const { monitor } = setup()
    for (let i = 0; i < 50; i++) {
      monitor.start()
      monitor.start()
      expect(vi.getTimerCount()).toBe(1)
      monitor.stop()
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('keeps checking when one check throws', async () => {
    const { monitor, deps } = setup({
      realtimeStates: () => {
        throw new Error('no client')
      },
      heap: () => ({ usedMB: 3000, limitMB: 4096 }),
    })
    const made = await monitor.tick()
    expect(made.map((r) => r.kind)).toEqual(['heap-caches-dropped'])
    expect(deps.dropCaches).toHaveBeenCalled()
  })
})
