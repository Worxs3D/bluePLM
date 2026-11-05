/**
 * The session boundary of the output queue (`autoQueue.ts`) and of the output request worker
 * (`requests.ts`, 5.13.0). Kept free of imports so the store's sign-out and organization-change
 * paths can call it without importing the queue (and through it the store itself).
 */

const resets = new Set<() => void>()

/**
 * Called by the app's queue when it is created, and by the request worker when it starts. Every
 * registration runs once, at the next `resetOutputQueue`. Returns a function that withdraws it
 * (a worker stopped for another reason).
 */
export function registerOutputQueueReset(fn: () => void): () => void {
  resets.add(fn)
  return () => {
    resets.delete(fn)
  }
}

/**
 * Drop the app's output queue: waiting jobs are discarded, retry timers stop counting, and the
 * result of a job already running is ignored. The next job queued starts a fresh queue. The
 * request worker stops too; the next session starts it again.
 */
export function resetOutputQueue(): void {
  const fns = [...resets]
  resets.clear()
  for (const fn of fns) fn()
}
