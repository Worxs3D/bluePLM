/**
 * Review decisions wait in an undo window before they are sent (`usePendingDecisions`). Anything
 * that ends the session has to send them first, while the user who made them is still signed in:
 * sign-out, an organization switch and closing the window. The open review registers its queue
 * here; those paths call `flushPendingReviewDecisions()` and wait for it.
 */

import { log } from '@/lib/logger'

export interface PendingDecisionFlusher {
  /** Send everything queued and wait for the sends. */
  flush: () => Promise<void>
  /** Something is queued or being sent. */
  hasPending: () => boolean
}

const flushers = new Set<PendingDecisionFlusher>()

/** Register a queue; returns the unregister function (an effect cleanup). */
export function registerPendingDecisionFlush(flusher: PendingDecisionFlusher): () => void {
  flushers.add(flusher)
  return () => {
    flushers.delete(flusher)
  }
}

export function hasPendingReviewDecisions(): boolean {
  return [...flushers].some((f) => f.hasPending())
}

/** Send every queued decision now and wait, at most `timeoutMs`, for the sends to finish. */
export async function flushPendingReviewDecisions(timeoutMs = 8000): Promise<void> {
  if (!hasPendingReviewDecisions()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log.warn('[Reviews]', 'Queued review decisions were still sending when the session ended')
      resolve()
    }, timeoutMs)
  })
  try {
    await Promise.race([Promise.allSettled([...flushers].map((f) => f.flush())), deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Closing the window with decisions still queued: hold the close, send them, then close. A
 * desktop window closes without a prompt once the sends are done; a browser tab asks first
 * (the browser's own "Leave site?"), and the sends go out while it asks.
 */
export function installReviewDecisionUnloadGuard(closeWindow: () => void): () => void {
  let releasing = false
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (releasing || !hasPendingReviewDecisions()) return
    event.preventDefault()
    event.returnValue = ''
    void flushPendingReviewDecisions().finally(() => {
      releasing = true
      closeWindow()
    })
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}
