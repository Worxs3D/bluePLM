/**
 * The session boundary of the output queue (`autoQueue.ts`). Kept free of imports so the store's
 * sign-out and organization-change paths can call it without importing the queue (and through it
 * the store itself).
 */

let reset: (() => void) | null = null

/** Called by the app's queue when it is created. */
export function registerOutputQueueReset(fn: () => void): void {
  reset = fn
}

/**
 * Drop the app's output queue: waiting jobs are discarded, retry timers stop counting, and the
 * result of a job already running is ignored. The next job queued starts a fresh queue.
 */
export function resetOutputQueue(): void {
  const fn = reset
  reset = null
  fn?.()
}
