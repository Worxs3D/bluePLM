/**
 * Collects ids and hands them over in one batch: after `quietMs` without a new id, or after
 * `maxWaitMs` since the first id of the batch, whichever comes first. The cap is what keeps a
 * steady stream (one event every 100 ms for a minute) from postponing the flush forever.
 *
 * Used by the realtime file handler so a burst of soft deletes becomes one store update.
 * Ids keep their arrival order and are de-duplicated.
 */

export const BATCH_QUIET_MS = 250
export const BATCH_MAX_WAIT_MS = 1000

export interface BatcherTimers {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

export interface TrailingBatcherOptions {
  onFlush: (ids: string[]) => void
  quietMs?: number
  maxWaitMs?: number
  /** Injectable for tests. */
  timers?: BatcherTimers
}

export interface TrailingBatcher {
  add: (id: string) => void
  has: (id: string) => boolean
  /** Hand over whatever is pending right now. A no-op when nothing is. */
  flush: () => void
  /** Drop what is pending without handing it over. */
  cancel: () => void
  readonly size: number
}

const defaultTimers: BatcherTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export function createTrailingBatcher(options: TrailingBatcherOptions): TrailingBatcher {
  const { onFlush, quietMs = BATCH_QUIET_MS, maxWaitMs = BATCH_MAX_WAIT_MS } = options
  const timers = options.timers ?? defaultTimers

  const pending = new Set<string>()
  let timer: unknown = null
  let firstAddedAt = 0

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  const flush = () => {
    clearTimer()
    if (pending.size === 0) return
    const ids = Array.from(pending)
    pending.clear()
    onFlush(ids)
  }

  return {
    add: (id) => {
      const now = timers.now()
      if (pending.size === 0) firstAddedAt = now
      pending.add(id)

      clearTimer()
      const remainingMs = Math.max(0, maxWaitMs - (now - firstAddedAt))
      timer = timers.setTimeout(flush, Math.min(quietMs, remainingMs))
    },
    has: (id) => pending.has(id),
    flush,
    cancel: () => {
      clearTimer()
      pending.clear()
    },
    get size() {
      return pending.size
    },
  }
}
