/**
 * Review decisions wait 5 s in the renderer with Undo before they are sent
 * (`src/features/source/reviews/lib/pendingDecisions.ts`). Quitting the application (the Exit
 * menu item, Alt+F4 / Cmd+Q, the dock, an update install, the OS shutting down) ends every
 * renderer without its `beforeunload`, so a decision made in those 5 s would be lost. Before any
 * of those, the main process asks each renderer that reported queued decisions to send them and
 * waits for its answer, never longer than `timeoutMs`.
 *
 * Pure: the IPC is injected (`QuitFlushPort`), so the orchestration is tested without Electron.
 * `reviewDecisionQuitIpc.ts` wires it to `ipcMain` and `webContents`.
 */

/** How long a quit waits for renderers to send their queued decisions. */
export const QUIT_FLUSH_TIMEOUT_MS = 5000

/** Which renderers (webContents ids) said they hold queued or in-flight decisions. */
export interface PendingDecisionTracker {
  set: (target: number, pending: boolean) => void
  forget: (target: number) => void
  pendingTargets: () => number[]
  hasPending: () => boolean
}

export function createPendingDecisionTracker(): PendingDecisionTracker {
  const pending = new Set<number>()
  return {
    set: (target, value) => {
      if (value) pending.add(target)
      else pending.delete(target)
    },
    forget: (target) => {
      pending.delete(target)
    },
    pendingTargets: () => [...pending],
    hasPending: () => pending.size > 0,
  }
}

export interface QuitFlushPort {
  /** Renderers that reported queued decisions. */
  pendingTargets: () => number[]
  /** Ask one renderer to send them; false when it is gone (nothing to wait for). */
  request: (target: number, requestId: string) => boolean
  /** A renderer answered a request; returns the unsubscribe function. */
  onDone: (listener: (target: number, requestId: string) => void) => () => void
}

export interface QuitFlushTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface QuitFlushOutcome {
  /** Renderers that were asked. */
  asked: number[]
  /** Renderers that answered in time. */
  done: number[]
  /** Renderers still unanswered when the time ran out. */
  timedOut: number[]
}

const realTimers: QuitFlushTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

let nextRequest = 0

/**
 * Ask every renderer with queued decisions to send them, and resolve when all have answered or
 * `timeoutMs` has passed, whichever comes first. Resolves at once when none has any. Never rejects.
 */
export function flushRenderersBeforeQuit(
  port: QuitFlushPort,
  timeoutMs: number = QUIT_FLUSH_TIMEOUT_MS,
  timers: QuitFlushTimers = realTimers,
): Promise<QuitFlushOutcome> {
  const targets = port.pendingTargets()
  if (targets.length === 0) return Promise.resolve({ asked: [], done: [], timedOut: [] })

  const requestId = `quit-flush-${++nextRequest}`
  const waiting = new Set<number>()
  const done: number[] = []

  return new Promise<QuitFlushOutcome>((resolve) => {
    let settled = false
    let timer: unknown = null
    let unsubscribe: () => void = () => {}
    const finish = () => {
      if (settled) return
      settled = true
      unsubscribe()
      if (timer !== null) timers.clearTimeout(timer)
      resolve({ asked: targets, done, timedOut: [...waiting] })
    }

    let allAsked = false
    unsubscribe = port.onDone((target, id) => {
      if (id !== requestId || !waiting.delete(target)) return
      done.push(target)
      if (allAsked && waiting.size === 0) finish()
    })

    for (const target of targets) {
      // Waiting before the send, so even an answer that comes back at once is counted.
      waiting.add(target)
      let sent = false
      try {
        sent = port.request(target, requestId)
      } catch {
        sent = false
      }
      if (!sent) waiting.delete(target)
    }
    allAsked = true
    if (waiting.size === 0) {
      finish()
      return
    }
    timer = timers.setTimeout(finish, timeoutMs)
  })
}

/**
 * One flush at a time: a second quit path (an update install that then quits, `before-quit`
 * after a shutdown handler) joins the flush already running instead of asking twice.
 */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null
  return () => {
    if (current) return current
    current = run().finally(() => {
      current = null
    })
    return current
  }
}

/** Whether a Windows `query-session-end` may be held: never for a critical shutdown. */
export function mayHoldSessionEnd(reasons: readonly string[]): boolean {
  return !reasons.includes('critical')
}

/**
 * One quit at a time. The first `before-quit` runs the flush and the cleanup and ends in
 * `app.exit()`; any later `before-quit` (a shutdown handler's `app.quit()`, Exit clicked again)
 * must be held too, or Electron would quit while that first one is still flushing or cleaning up.
 */
export interface QuitGuard {
  /** From `before-quit`: true for the first call (run the quit), false for a re-entry (held). */
  begin(event: { preventDefault: () => void }): boolean
  /** A quit has begun; a shutdown handler leaves the quitting to it. */
  inProgress(): boolean
}

export function createQuitGuard(): QuitGuard {
  let begun = false
  return {
    begin(event) {
      event.preventDefault()
      if (begun) return false
      begun = true
      return true
    },
    inProgress: () => begun,
  }
}

/** How a renderer's lifetime reaches the tracker (webContents events, injected for tests). */
export interface RendererLifetime {
  onDestroyed(listener: () => void): void
  /** The renderer process crashed or was killed; the page and its queue are gone. */
  onGone(listener: () => void): void
  /** A main-frame, cross-document navigation started (a reload): the old page's queue is gone. */
  onMainFrameNavigation(listener: () => void): void
}

/**
 * Forget a renderer's pending report whenever its page goes away: destroyed, crashed, or reloaded
 * (same webContents id; the new page reports its own state when its bridge installs). Without
 * this a quit would wait the full timeout for a page that no longer exists.
 */
export function watchRendererLifetime(
  target: number,
  lifetime: RendererLifetime,
  tracker: PendingDecisionTracker,
): void {
  const forget = () => tracker.forget(target)
  lifetime.onDestroyed(forget)
  lifetime.onGone(forget)
  lifetime.onMainFrameNavigation(forget)
}
