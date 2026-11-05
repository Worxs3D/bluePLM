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
const changeListeners = new Set<() => void>()

/** Register a queue; returns the unregister function (an effect cleanup). */
export function registerPendingDecisionFlush(flusher: PendingDecisionFlusher): () => void {
  flushers.add(flusher)
  notifyPendingReviewDecisionsChanged()
  return () => {
    flushers.delete(flusher)
    notifyPendingReviewDecisionsChanged()
  }
}

/** A queue's `hasPending()` may have changed (queued, sent, settled). */
export function notifyPendingReviewDecisionsChanged(): void {
  for (const listener of [...changeListeners]) listener()
}

/** Called whenever `hasPendingReviewDecisions()` may have changed; returns the unsubscribe. */
export function onPendingReviewDecisionsChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
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

/** The desktop's quit handshake (`window.electronAPI.reviewDecisions`, electron/handlers/reviewDecisionQuit.ts). */
export interface ReviewDecisionQuitBridge {
  /** Tell the main process whether this window holds queued or in-flight decisions. */
  setPending: (pending: boolean) => void
  /** The application is quitting: send them now. Returns the unsubscribe. */
  onFlushRequest: (callback: (requestId: string) => void) => () => void
  /** The sends for `requestId` are done (or were given up). */
  flushDone: (requestId: string) => void
}

/**
 * Below the main process's own wait (5 s), so this window answers before main stops waiting for
 * it, even when a send hangs.
 */
export const QUIT_FLUSH_RENDERER_TIMEOUT_MS = 4000

/**
 * Quitting the application (Exit, Alt+F4 / Cmd+Q, an update install, the OS shutting down) ends
 * this window without `beforeunload`. The main process holds the quit while any window says it
 * has queued decisions, asks it to send them, and quits once it answers. Desktop only; a browser
 * tab is covered by `installReviewDecisionUnloadGuard`.
 */
export function installReviewDecisionQuitBridge(
  bridge: ReviewDecisionQuitBridge,
  timeoutMs: number = QUIT_FLUSH_RENDERER_TIMEOUT_MS,
): () => void {
  // Unknown until the first report, which always goes out: a reloaded page reuses its
  // webContents, and main must hear that this page starts clear.
  let reported: boolean | null = null
  const report = () => {
    const pending = hasPendingReviewDecisions()
    if (pending === reported) return
    reported = pending
    bridge.setPending(pending)
  }
  const stopWatching = onPendingReviewDecisionsChange(report)
  report()
  const stopListening = bridge.onFlushRequest((requestId) => {
    void flushPendingReviewDecisions(timeoutMs)
      .catch((error: unknown) => {
        log.warn('[Reviews]', 'Sending queued review decisions before quitting failed', { error })
      })
      .finally(() => {
        report()
        bridge.flushDone(requestId)
      })
  })
  return () => {
    stopWatching()
    stopListening()
    if (reported === true) bridge.setPending(false)
  }
}
