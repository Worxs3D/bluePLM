import { describe, expect, it } from 'vitest'

import {
  createPendingDecisionTracker,
  createQuitGuard,
  flushRenderersBeforeQuit,
  mayHoldSessionEnd,
  singleFlight,
  watchRendererLifetime,
  type QuitFlushPort,
  type QuitFlushTimers,
} from './reviewDecisionQuit'

/** An injected IPC: renderers (webContents ids) that answer, hang, or are already gone. */
function fakePort(opts: {
  pending: number[]
  answers?: number[]
  gone?: number[]
  throws?: number[]
}) {
  const requests: Array<{ target: number; requestId: string }> = []
  const listeners = new Set<(target: number, requestId: string) => void>()
  const port: QuitFlushPort = {
    pendingTargets: () => opts.pending,
    request: (target, requestId) => {
      if (opts.throws?.includes(target)) throw new Error('send failed')
      if (opts.gone?.includes(target)) return false
      requests.push({ target, requestId })
      if (opts.answers?.includes(target)) {
        queueMicrotask(() => listeners.forEach((l) => l(target, requestId)))
      }
      return true
    },
    onDone: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    port,
    requests,
    answer: (target: number, requestId: string) => listeners.forEach((l) => l(target, requestId)),
    listenerCount: () => listeners.size,
  }
}

/** Timers the test fires by hand. */
function manualTimers() {
  const scheduled: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  const timers: QuitFlushTimers = {
    setTimeout: (fn, ms) => {
      const entry = { fn, ms, cleared: false }
      scheduled.push(entry)
      return entry
    },
    clearTimeout: (handle) => {
      ;(handle as { cleared: boolean }).cleared = true
    },
  }
  const fire = () => scheduled.filter((s) => !s.cleared).forEach((s) => s.fn())
  return { timers, scheduled, fire }
}

describe('flushing renderers before the app quits', () => {
  it('resolves at once, asking nobody, when no renderer holds decisions', async () => {
    const fake = fakePort({ pending: [] })
    const { timers, scheduled } = manualTimers()
    await expect(flushRenderersBeforeQuit(fake.port, 5000, timers)).resolves.toEqual({
      asked: [],
      done: [],
      timedOut: [],
    })
    expect(fake.requests).toEqual([])
    expect(scheduled).toEqual([])
  })

  it('asks every renderer with decisions and waits until all have answered', async () => {
    const fake = fakePort({ pending: [1, 4], answers: [1, 4] })
    const { timers, scheduled } = manualTimers()
    const outcome = await flushRenderersBeforeQuit(fake.port, 5000, timers)
    expect(outcome).toEqual({ asked: [1, 4], done: [1, 4], timedOut: [] })
    // One request id for the whole quit.
    expect(new Set(fake.requests.map((r) => r.requestId)).size).toBe(1)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].ms).toBe(5000)
    expect(scheduled[0].cleared).toBe(true)
    expect(fake.listenerCount()).toBe(0)
  })

  it('stops waiting at the timeout and names the renderer that never answered', async () => {
    const fake = fakePort({ pending: [1, 2], answers: [1] })
    const { timers, fire } = manualTimers()
    const flushing = flushRenderersBeforeQuit(fake.port, 3000, timers)
    let settled = false
    void flushing.then(() => {
      settled = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
    fire()
    await expect(flushing).resolves.toEqual({ asked: [1, 2], done: [1], timedOut: [2] })
    expect(fake.listenerCount()).toBe(0)
  })

  it('ignores answers to another request and from renderers it did not ask', async () => {
    const fake = fakePort({ pending: [1] })
    const { timers, fire } = manualTimers()
    const flushing = flushRenderersBeforeQuit(fake.port, 3000, timers)
    const id = fake.requests[0].requestId
    fake.answer(1, 'quit-flush-elsewhere')
    fake.answer(9, id)
    fire()
    await expect(flushing).resolves.toEqual({ asked: [1], done: [], timedOut: [1] })
  })

  it('does not wait for a renderer that is gone or whose send throws', async () => {
    const fake = fakePort({ pending: [1, 2, 3], gone: [2], throws: [3], answers: [1] })
    const { timers } = manualTimers()
    await expect(flushRenderersBeforeQuit(fake.port, 5000, timers)).resolves.toEqual({
      asked: [1, 2, 3],
      done: [1],
      timedOut: [],
    })
  })

  it('resolves at once when every renderer it would ask is gone', async () => {
    const fake = fakePort({ pending: [2], gone: [2] })
    const { timers, scheduled } = manualTimers()
    await expect(flushRenderersBeforeQuit(fake.port, 5000, timers)).resolves.toEqual({
      asked: [2],
      done: [],
      timedOut: [],
    })
    expect(scheduled).toEqual([])
  })

  it('times out with real timers too (the quit is never held forever)', async () => {
    const fake = fakePort({ pending: [1] })
    const started = Date.now()
    const outcome = await flushRenderersBeforeQuit(fake.port, 20)
    expect(outcome.timedOut).toEqual([1])
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('tracking which renderers hold decisions', () => {
  it('adds, clears and forgets renderers by webContents id', () => {
    const tracker = createPendingDecisionTracker()
    expect(tracker.hasPending()).toBe(false)
    tracker.set(3, true)
    tracker.set(5, true)
    tracker.set(3, false)
    expect(tracker.pendingTargets()).toEqual([5])
    tracker.forget(5)
    expect(tracker.hasPending()).toBe(false)
  })
})

describe('one flush per quit', () => {
  it('joins a flush already running, and runs again after it settled', async () => {
    let runs = 0
    let release: () => void = () => {}
    const flush = singleFlight(
      () =>
        new Promise<number>((resolve) => {
          runs++
          release = () => resolve(runs)
        }),
    )
    const a = flush()
    const b = flush()
    expect(a).toBe(b)
    release()
    await expect(a).resolves.toBe(1)
    const c = flush()
    expect(c).not.toBe(a)
    release()
    await expect(c).resolves.toBe(2)
  })
})

describe('holding a Windows session end', () => {
  it('holds shutdown, restart and log-off, never a critical shutdown', () => {
    expect(mayHoldSessionEnd(['shutdown'])).toBe(true)
    expect(mayHoldSessionEnd(['logoff'])).toBe(true)
    expect(mayHoldSessionEnd(['close-app'])).toBe(true)
    expect(mayHoldSessionEnd(['shutdown', 'critical'])).toBe(false)
  })
})

describe('one quit at a time (before-quit)', () => {
  it('runs the first quit and holds every later before-quit, so none cuts it short', () => {
    const guard = createQuitGuard()
    const event = () => {
      const e = { prevented: false, preventDefault: () => (e.prevented = true) }
      return e
    }
    expect(guard.inProgress()).toBe(false)
    const first = event()
    expect(guard.begin(first)).toBe(true)
    expect(first.prevented).toBe(true)
    expect(guard.inProgress()).toBe(true)
    // A shutdown handler's app.quit() (or Exit clicked again) while the first quit runs.
    const again = event()
    expect(guard.begin(again)).toBe(false)
    expect(again.prevented).toBe(true)
  })
})

describe('forgetting a renderer whose page went away', () => {
  function fakeLifetime() {
    const listeners: Record<'destroyed' | 'gone' | 'navigation', Array<() => void>> = {
      destroyed: [],
      gone: [],
      navigation: [],
    }
    return {
      lifetime: {
        onDestroyed: (l: () => void) => listeners.destroyed.push(l),
        onGone: (l: () => void) => listeners.gone.push(l),
        onMainFrameNavigation: (l: () => void) => listeners.navigation.push(l),
      },
      fire: (kind: keyof typeof listeners) => listeners[kind].forEach((l) => l()),
    }
  }

  it.each(['destroyed', 'gone', 'navigation'] as const)('forgets it on %s', (kind) => {
    const tracker = createPendingDecisionTracker()
    const fake = fakeLifetime()
    tracker.set(7, true)
    tracker.set(8, true)
    watchRendererLifetime(7, fake.lifetime, tracker)
    fake.fire(kind)
    expect(tracker.pendingTargets()).toEqual([8])
  })

  it('tracks the reloaded page again once it reports', () => {
    const tracker = createPendingDecisionTracker()
    const fake = fakeLifetime()
    tracker.set(7, true)
    watchRendererLifetime(7, fake.lifetime, tracker)
    fake.fire('navigation')
    expect(tracker.hasPending()).toBe(false)
    tracker.set(7, true)
    expect(tracker.pendingTargets()).toEqual([7])
  })
})
