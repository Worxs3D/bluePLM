// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  installReviewDecisionQuitBridge,
  type ReviewDecisionQuitBridge,
} from '@/lib/reviewDecisionFlush'

import { usePendingDecisions } from './usePendingDecisions'

/** What the window tells the main process about queued decisions (the desktop quit handshake). */
function recordingBridge() {
  const reports: boolean[] = []
  const bridge: ReviewDecisionQuitBridge = {
    setPending: (pending) => reports.push(pending),
    onFlushRequest: () => () => {},
    flushDone: () => {},
  }
  return { bridge, reports }
}

describe('usePendingDecisions and the quit handshake', () => {
  it('reports the window as holding decisions from queueing until the send settles', async () => {
    const { bridge, reports } = recordingBridge()
    const uninstall = installReviewDecisionQuitBridge(bridge)
    let release: () => void = () => {}
    const sent = new Promise<void>((resolve) => {
      release = resolve
    })
    const { result, unmount } = renderHook(() =>
      usePendingDecisions({
        owedOnServer: new Set(['item-1']),
        send: () => sent,
        onSent: () => {},
        onUndone: () => {},
        onFailed: () => {},
      }),
    )
    expect(reports).toEqual([false])

    act(() => {
      result.current.queueDecision(
        { reviewId: 'r1', scope: 'item', itemIds: ['item-1'], decision: 'approved', comment: null },
        'Approved',
      )
    })
    expect(reports).toEqual([false, true])

    // Sent early (as a quit would): still held while the RPC is in flight.
    act(() => result.current.flush())
    expect(reports).toEqual([false, true])
    // In flight: the item still says what it is being sent as.
    expect(result.current.sending.has('item-1')).toBe(true)
    expect(result.current.sendingDecisions.get('item-1')).toBe('approved')

    await act(async () => {
      release()
      await sent
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(reports).toEqual([false, true, false])

    unmount()
    uninstall()
  })
})
