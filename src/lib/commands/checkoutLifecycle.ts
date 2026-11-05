/**
 * Listeners for the end of a checkout: a successful check-in or a discard. Features that keep work
 * tied to a checked-out copy (inspection reports of a working copy) register here, so the command
 * handlers notify them without importing them. A listener must return at once and never throw;
 * anything slow runs in its own background task.
 */
import { log } from '@/lib/logger'
import type { LocalFile } from '@/stores/types'

export type CheckoutEnd = 'checkin' | 'discard'

/** `after`: background work of the operation (check-in reference extraction) to wait for. */
export type CheckoutEndListener = (end: CheckoutEnd, files: readonly LocalFile[], after?: Promise<unknown>) => void

const listeners = new Set<CheckoutEndListener>()

/** Returns the unregister function. */
export function registerCheckoutEndListener(fn: CheckoutEndListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function notifyCheckoutEnd(end: CheckoutEnd, files: readonly LocalFile[], after?: Promise<unknown>): void {
  if (files.length === 0) return
  for (const fn of listeners) {
    try {
      fn(end, files, after)
    } catch (err) {
      log.warn('[Checkout]', 'Checkout end listener failed', { end, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
