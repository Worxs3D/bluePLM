import { describe, expect, it } from 'vitest'

import {
  flushPendingReviewDecisions,
  hasPendingReviewDecisions,
  installReviewDecisionQuitBridge,
  notifyPendingReviewDecisionsChanged,
  registerPendingDecisionFlush,
  type ReviewDecisionQuitBridge,
} from './reviewDecisionFlush'

describe('flushing queued review decisions before the session ends', () => {
  it('waits for every registered queue to send', async () => {
    const sent: string[] = []
    let pending = true
    const off = registerPendingDecisionFlush({
      hasPending: () => pending,
      flush: async () => {
        await new Promise((r) => setTimeout(r, 10))
        sent.push('a')
        pending = false
      },
    })
    expect(hasPendingReviewDecisions()).toBe(true)
    await flushPendingReviewDecisions()
    expect(sent).toEqual(['a'])
    expect(hasPendingReviewDecisions()).toBe(false)
    off()
  })

  it('does nothing without a queue, and gives up after the timeout', async () => {
    await expect(flushPendingReviewDecisions()).resolves.toBeUndefined()
    const off = registerPendingDecisionFlush({
      hasPending: () => true,
      flush: () => new Promise<void>(() => {}),
    })
    const started = Date.now()
    await flushPendingReviewDecisions(30)
    expect(Date.now() - started).toBeLessThan(1000)
    off()
    expect(hasPendingReviewDecisions()).toBe(false)
  })
})

/** A fake preload bridge that records what the window told the main process. */
function fakeBridge() {
  const reports: boolean[] = []
  const done: string[] = []
  let request: ((requestId: string) => void) | null = null
  const bridge: ReviewDecisionQuitBridge = {
    setPending: (pending) => reports.push(pending),
    onFlushRequest: (callback) => {
      request = callback
      return () => {
        request = null
      }
    },
    flushDone: (requestId) => done.push(requestId),
  }
  return {
    bridge,
    reports,
    done,
    quit: (requestId: string) => request?.(requestId),
    listening: () => request !== null,
  }
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('the quit handshake with the main process (desktop)', () => {
  it('reports only changes of whether the window holds decisions', () => {
    const fake = fakeBridge()
    const uninstall = installReviewDecisionQuitBridge(fake.bridge)
    // The first state always goes out: a reloaded page must clear what the old one reported.
    expect(fake.reports).toEqual([false])

    let pending = false
    const off = registerPendingDecisionFlush({ hasPending: () => pending, flush: async () => {} })
    expect(fake.reports).toEqual([false])
    pending = true
    notifyPendingReviewDecisionsChanged()
    notifyPendingReviewDecisionsChanged()
    expect(fake.reports).toEqual([false, true])
    pending = false
    notifyPendingReviewDecisionsChanged()
    expect(fake.reports).toEqual([false, true, false])

    off()
    uninstall()
    expect(fake.listening()).toBe(false)
  })

  it('sends the queue when asked and answers with the same request id', async () => {
    const fake = fakeBridge()
    const uninstall = installReviewDecisionQuitBridge(fake.bridge)
    const sent: string[] = []
    let pending = true
    const off = registerPendingDecisionFlush({
      hasPending: () => pending,
      flush: async () => {
        await new Promise((r) => setTimeout(r, 10))
        sent.push('decision')
        pending = false
      },
    })
    expect(fake.reports).toEqual([false, true])

    fake.quit('quit-flush-7')
    expect(fake.done).toEqual([])
    await waitFor(() => fake.done.length > 0)
    expect(sent).toEqual(['decision'])
    expect(fake.done).toEqual(['quit-flush-7'])
    // Nothing is left after the send, and the main process hears it.
    expect(fake.reports).toEqual([false, true, false])

    off()
    uninstall()
  })

  it('answers after its own timeout when a send hangs, so the quit is never held forever', async () => {
    const fake = fakeBridge()
    const uninstall = installReviewDecisionQuitBridge(fake.bridge, 30)
    const off = registerPendingDecisionFlush({
      hasPending: () => true,
      flush: () => new Promise<void>(() => {}),
    })
    const started = Date.now()
    fake.quit('quit-flush-8')
    await waitFor(() => fake.done.length > 0)
    expect(fake.done).toEqual(['quit-flush-8'])
    expect(Date.now() - started).toBeLessThan(1000)
    off()
    // Unregistering the last queue reports the window as clear.
    expect(fake.reports).toEqual([false, true, false])
    uninstall()
  })

  it('answers at once when asked with nothing queued', async () => {
    const fake = fakeBridge()
    const uninstall = installReviewDecisionQuitBridge(fake.bridge)
    fake.quit('quit-flush-9')
    await waitFor(() => fake.done.length > 0)
    expect(fake.done).toEqual(['quit-flush-9'])
    uninstall()
  })

  it('tells the main process the window is clear when it is uninstalled while holding decisions', () => {
    const fake = fakeBridge()
    const uninstall = installReviewDecisionQuitBridge(fake.bridge)
    const off = registerPendingDecisionFlush({ hasPending: () => true, flush: async () => {} })
    uninstall()
    expect(fake.reports).toEqual([false, true, false])
    off()
  })
})
