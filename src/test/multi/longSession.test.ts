// @vitest-environment jsdom
/**
 * A long session in miniature: the app is left running while the network drops and comes back,
 * the health monitor forces resubscribes, and another machine checks files out and in. Whatever
 * the app subscribes to (realtime channels, watcher listeners, timers) must come back to where it
 * started after every cycle, so a month of this cannot stack anything up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/multi/clientMock')).mockMachineClientModule(await importOriginal()),
)

import { MULTI_TEST_TIMEOUT_MS, World } from './world'

let world: World | null = null
afterEach(() => {
  world?.dispose()
  world = null
})

const CYCLES = 20

describe('long session balance', { timeout: MULTI_TEST_TIMEOUT_MS }, () => {
  it('holds the same channels, watcher listeners and timers across drops, resubscribes and check-ins', async () => {
    const w = await World.create(['A', 'B'])
    world = w
    w.seed({ path: 'x.sldprt', partNumber: 'P-1', description: 'Bracket' })
    w.seed({ path: 'y.sldprt', partNumber: 'P-2', description: 'Plate' })
    await w.boot()
    await w.settle()

    const counts = () => ({
      channels: w.A.link.channels.size,
      kinds: w.A.on(() => w.A.graph.realtimeChannelStates().length),
      watcherListeners: w.A.watcherListenerCount(),
      timers: vi.getTimerCount(),
    })
    const before = counts()
    let settledTimers = before.timers
    expect(before.channels).toBeGreaterThan(0)
    expect(before.watcherListeners).toBeGreaterThan(0)

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const path = cycle % 2 ? 'x.sldprt' : 'y.sldprt'
      w.server.network.disconnect('A')
      await w.run(w.B.command('checkout', { files: [w.B.file(path)] }))
      w.B.on(() => w.B.disk.write(w.B.absolute(path), `B version ${cycle}`))
      await w.settle()
      await w.run(w.B.command('checkin', { files: [w.B.file(path)] }))
      w.server.network.reconnect('A', { catchUp: false })
      await w.settle()
      // What the health monitor does to a channel that stayed dead: subscribe every kind again.
      const kinds = w.A.on(() => w.A.graph.realtimeChannelStates().map((s) => s.kind))
      expect(w.A.on(() => w.A.graph.resubscribeRealtime(kinds))).toEqual(kinds)
      await w.settle()
      const now = counts()
      // A timer armed by the first cycle (a debounce, a scheduled refresh) may stay; what must not
      // happen is one more per cycle.
      if (cycle === 0) settledTimers = now.timers
      expect({ ...now, timers: now.timers - settledTimers }, `cycle ${cycle}`).toEqual({ ...before, timers: 0 })
    }
    expect(settledTimers - before.timers).toBeLessThanOrEqual(2)

    // And A still hears B: the resubscribed channels are live, and the catch-up reloads worked.
    await w.expectConverged()
  })
})
