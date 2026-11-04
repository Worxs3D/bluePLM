import { describe, expect, it } from 'vitest'

import {
  flushPendingReviewDecisions,
  hasPendingReviewDecisions,
  registerPendingDecisionFlush,
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
