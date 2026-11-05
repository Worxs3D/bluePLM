/**
 * Wires the quit-time flush of queued review decisions (`reviewDecisionQuit.ts`) to Electron:
 *
 *   renderer -> main  `review-decisions:pending`     (boolean) it holds queued or in-flight decisions
 *   main -> renderer  `review-decisions:flush`       (request id) send them now
 *   renderer -> main  `review-decisions:flush-done`  (request id) sent, or given up
 *
 * Any window that runs the renderer bridge counts (the main window, a pop-out); main tracks them by
 * webContents id and forgets one when it is destroyed.
 */

import { app, ipcMain, powerMonitor, webContents, type BrowserWindow } from 'electron'

import {
  QUIT_FLUSH_TIMEOUT_MS,
  createPendingDecisionTracker,
  createQuitGuard,
  flushRenderersBeforeQuit,
  mayHoldSessionEnd,
  singleFlight,
  watchRendererLifetime,
  type QuitFlushOutcome,
  type QuitFlushPort,
} from './reviewDecisionQuit'
import { writeLog } from './logging'

const tracker = createPendingDecisionTracker()
/** The application's one quit (`before-quit` in main.ts); shutdown handlers defer to it. */
export const quitGuard = createQuitGuard()
const doneListeners = new Set<(target: number, requestId: string) => void>()
const watched = new Set<number>()
let registered = false

const port: QuitFlushPort = {
  pendingTargets: () => tracker.pendingTargets(),
  request: (target, requestId) => {
    const contents = webContents.fromId(target)
    if (!contents || contents.isDestroyed()) {
      tracker.forget(target)
      return false
    }
    contents.send('review-decisions:flush', requestId)
    return true
  },
  onDone: (listener) => {
    doneListeners.add(listener)
    return () => {
      doneListeners.delete(listener)
    }
  },
}

/** Whether any renderer reported queued decisions. Cheap; no IPC. */
export function hasRendererPendingReviewDecisions(): boolean {
  return tracker.hasPending()
}

const flushOnce = singleFlight(async (): Promise<QuitFlushOutcome> => {
  const started = Date.now()
  const outcome = await flushRenderersBeforeQuit(port, QUIT_FLUSH_TIMEOUT_MS)
  if (outcome.asked.length > 0) {
    const level = outcome.timedOut.length > 0 ? 'warn' : 'info'
    writeLog(level, '[Main] Sent queued review decisions before quitting', {
      ...outcome,
      ms: Date.now() - started,
    })
  }
  return outcome
})

/**
 * Ask every renderer with queued review decisions to send them and wait (at most
 * `QUIT_FLUSH_TIMEOUT_MS`). Resolves at once when none has any; never rejects.
 */
export function flushReviewDecisionsBeforeQuit(): Promise<QuitFlushOutcome> {
  return flushOnce()
}

/** After a shutdown handler's flush: quit, unless a quit already running will finish the job. */
function quitUnlessQuitting(): void {
  if (!quitGuard.inProgress()) app.quit()
}

export function registerReviewDecisionQuitHandlers(): void {
  if (registered) return
  registered = true

  ipcMain.on('review-decisions:pending', (event, pending: unknown) => {
    if (typeof pending !== 'boolean') return
    const contents = event.sender
    tracker.set(contents.id, pending)
    if (!watched.has(contents.id)) {
      watched.add(contents.id)
      const id = contents.id
      watchRendererLifetime(
        id,
        {
          onDestroyed: (listener) =>
            contents.once('destroyed', () => {
              watched.delete(id)
              listener()
            }),
          onGone: (listener) => contents.on('render-process-gone', () => listener()),
          onMainFrameNavigation: (listener) =>
            contents.on('did-start-navigation', (details) => {
              if (details.isMainFrame && !details.isSameDocument) listener()
            }),
        },
        tracker,
      )
    }
  })

  ipcMain.on('review-decisions:flush-done', (event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    for (const listener of [...doneListeners]) listener(event.sender.id, requestId)
  })

  // Linux and macOS: the system is shutting down. Holding it is allowed only to exit cleanly, so
  // the app quits right after the flush (macOS also reaches `before-quit`, which flushes again for
  // nothing).
  // Electron passes an event here although its typings declare no argument.
  powerMonitor.on('shutdown', (event?: { preventDefault?: () => void }) => {
    if (!tracker.hasPending()) return
    event?.preventDefault?.()
    void flushReviewDecisionsBeforeQuit().finally(quitUnlessQuitting)
  })
}

/**
 * Windows: the session is ending (shutdown, restart, log-off). `query-session-end` can still hold
 * it, so with decisions queued the app holds it, sends them and quits, which lets Windows go on.
 * `session-end` cannot be held; it only starts the sends, which may or may not finish in time.
 */
export function watchWindowSessionEnd(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  win.on('query-session-end', (event) => {
    if (!tracker.hasPending()) return
    if (!mayHoldSessionEnd(event.reasons)) {
      void flushReviewDecisionsBeforeQuit()
      return
    }
    event.preventDefault()
    void flushReviewDecisionsBeforeQuit().finally(quitUnlessQuitting)
  })
  win.on('session-end', () => {
    if (tracker.hasPending()) void flushReviewDecisionsBeforeQuit()
  })
}
