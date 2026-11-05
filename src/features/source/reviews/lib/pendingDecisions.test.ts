import { describe, expect, it } from 'vitest'

import {
  UNDO_WINDOW_MS,
  cancelDecision,
  decisionsToSend,
  effectiveOwed,
  enqueueDecision,
  expireDecisions,
  flushDecisions,
  pendingItemIds,
  restoreApplies,
  restoreFromUndo,
  settleSending,
  type PendingDecision,
} from './pendingDecisions'

const entry = (id: string, itemIds: string[], queuedAt = 0): PendingDecision => ({
  id,
  reviewId: 'r1',
  scope: itemIds.length > 1 ? 'all' : 'item',
  itemIds,
  decision: 'approved',
  comment: null,
  queuedAt,
})

describe('the decision undo window', () => {
  it('sends nothing at once, and the earlier decision first when another is made', () => {
    const first = enqueueDecision([], entry('d1', ['a']))
    expect(first.toSend).toEqual([])
    const second = enqueueDecision(first.queue, entry('d2', ['b']))
    expect(second.toSend.map((e) => e.id)).toEqual(['d1'])
    expect(second.queue.map((e) => e.id)).toEqual(['d2'])
  })

  it('takes back only what is still waiting', () => {
    const { queue } = enqueueDecision([], entry('d1', ['a']))
    const undone = cancelDecision(queue, 'd1')
    expect(undone.cancelled?.id).toBe('d1')
    expect(undone.queue).toEqual([])
    expect(cancelDecision(undone.queue, 'd1').cancelled).toBeNull()
  })

  it('sends a decision once its window has passed, not before', () => {
    const queue = [entry('d1', ['a'], 1000)]
    expect(expireDecisions(queue, 1000 + UNDO_WINDOW_MS - 1).toSend).toEqual([])
    const due = expireDecisions(queue, 1000 + UNDO_WINDOW_MS)
    expect(due.toSend.map((e) => e.id)).toEqual(['d1'])
    expect(due.queue).toEqual([])
  })

  it('flushes everything when the review goes off screen, never drops it', () => {
    const queue = [entry('d1', ['a']), entry('d2', ['b', 'c'])]
    const flushed = flushDecisions(queue)
    expect(flushed.queue).toEqual([])
    expect(flushed.toSend).toHaveLength(2)
  })

  it('treats queued and in-flight items as decided for moving on', () => {
    const queue = [entry('d2', ['b', 'c'])]
    expect([...pendingItemIds(queue)].sort()).toEqual(['b', 'c'])
    expect(effectiveOwed(['a', 'b', 'c', 'd'], queue, new Set(['a']))).toEqual(['d'])
  })
})

describe('what a queued decision sends', () => {
  it('sends Approve remaining for exactly the files it was made on', () => {
    const all = { ...entry('d1', ['a', 'b']), scope: 'all' as const }
    expect(decisionsToSend(all)).toEqual([
      { itemId: 'a', decision: 'approved', comment: null },
      { itemId: 'b', decision: 'approved', comment: null },
    ])
    expect(decisionsToSend({ ...all, comment: ' Fine. ' }).map((d) => d.decision)).toEqual([
      'approved_with_comments',
      'approved_with_comments',
    ])
  })

  it('sends a single decision as made', () => {
    const one = { ...entry('d1', ['a']), decision: 'changes_requested' as const, comment: 'Fix' }
    expect(decisionsToSend(one)).toEqual([
      { itemId: 'a', decision: 'changes_requested', comment: 'Fix' },
    ])
  })
})

describe('reopening an undone decision', () => {
  it('reopens only on the file the decision was made on', () => {
    const one = { ...entry('d1', ['x']), decision: 'changes_requested' as const, comment: 'Fix' }
    const restore = restoreFromUndo(one, 1)
    expect(restoreApplies(restore, 'x')).toBe(true)
    expect(restoreApplies(restore, 'y')).toBe(false)
    expect(restoreApplies(null, 'x')).toBe(false)
  })

  it('brings Approve remaining back as Approve remaining, and a plain Approve not at all', () => {
    const all = { ...entry('d1', ['a', 'b']), scope: 'all' as const, comment: 'ok' }
    expect(restoreFromUndo(all, 1)).toMatchObject({ itemId: 'a', decision: 'approve_all', comment: 'ok' })
    expect(restoreApplies(restoreFromUndo(entry('d2', ['a']), 1), 'a')).toBe(false)
  })
})

describe('items in flight', () => {
  it('stay sending until a reload no longer lists them as owed', () => {
    const sending = new Set(['a', 'b'])
    // Sent, but the reload has not landed: still owed on the server.
    expect([...settleSending(sending, new Set(['a', 'b']), new Set(['a']))].sort()).toEqual(['a', 'b'])
    // The reload landed without a: done.
    expect([...settleSending(sending, new Set(['b']), new Set(['a']))]).toEqual(['b'])
    // b was never sent (its RPC is still running): it stays.
    expect([...settleSending(sending, new Set([]), new Set(['a']))]).toEqual(['b'])
  })
})
