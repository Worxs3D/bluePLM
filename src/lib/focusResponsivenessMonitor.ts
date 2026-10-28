/**
 * What the window feels like in the seconds after it regains focus.
 *
 * Users report hover and cursor feedback lagging "when you just start looking at the PLM window
 * after being someplace else" and then catching up. The long task monitor records blocking
 * wherever it happens, but nothing lined it up with the focus change, so a stall at that moment
 * was indistinguishable from any other. This opens a short window at each refocus and reports,
 * once, how long the first frame took, how much of the window was blocked, and how late the
 * pointer and keyboard events were handled (Event Timing: `processingStart - startTime` is the
 * wait before the handler even began, which is exactly "slow to update the row under the cursor").
 *
 * The main process logs the renderer's working set at the same focus moment, so the two lines
 * together say whether the pages had been trimmed while the window sat behind another app.
 */

import { log } from '@/lib/logger'

/** How long after a refocus the window stays open collecting. */
export const FOCUS_WINDOW_MS = 5_000

/** A shorter spell away than this is a click on the title bar, not "being someplace else". */
export const MIN_AWAY_MS = 3_000

/** Event Timing reports nothing quicker than this; 16 is the API floor. */
const EVENT_DURATION_THRESHOLD_MS = 16

/** A window with more blocking than this, or an input this late, is logged as a warning. */
export const FOCUS_WARN_BLOCKED_MS = 200
export const FOCUS_WARN_INPUT_DELAY_MS = 100

export interface FocusWindowSummary {
  awayMs: number
  firstFrameMs: number | null
  longTasks: number
  blockedMs: number
  longestTaskMs: number
  slowEvents: number
  longestEventMs: number
  longestInputDelayMs: number
}

export interface FocusWindowTracker {
  start: (awayMs: number) => void
  isActive: () => boolean
  recordFirstFrame: (ms: number) => void
  recordLongTask: (durationMs: number) => void
  recordEvent: (durationMs: number, inputDelayMs: number) => void
  finish: () => FocusWindowSummary | null
}

/** Accumulates one focus window. Pure, so the arithmetic is testable without a browser. */
export function createFocusWindowTracker(): FocusWindowTracker {
  let summary: FocusWindowSummary | null = null

  return {
    start: (awayMs) => {
      summary = {
        awayMs: Math.round(awayMs),
        firstFrameMs: null,
        longTasks: 0,
        blockedMs: 0,
        longestTaskMs: 0,
        slowEvents: 0,
        longestEventMs: 0,
        longestInputDelayMs: 0,
      }
    },

    isActive: () => summary !== null,

    recordFirstFrame: (ms) => {
      if (summary && summary.firstFrameMs === null) summary.firstFrameMs = Math.round(ms)
    },

    recordLongTask: (durationMs) => {
      if (!summary) return
      summary.longTasks += 1
      // The Long Tasks API only reports above 50 ms, so what counts as blocking is the excess.
      summary.blockedMs += Math.max(0, durationMs - 50)
      summary.longestTaskMs = Math.max(summary.longestTaskMs, durationMs)
    },

    recordEvent: (durationMs, inputDelayMs) => {
      if (!summary) return
      summary.slowEvents += 1
      summary.longestEventMs = Math.max(summary.longestEventMs, durationMs)
      summary.longestInputDelayMs = Math.max(summary.longestInputDelayMs, inputDelayMs)
    },

    finish: () => {
      const result = summary
      summary = null
      if (!result) return null
      return {
        ...result,
        blockedMs: Math.round(result.blockedMs),
        longestTaskMs: Math.round(result.longestTaskMs),
        longestEventMs: Math.round(result.longestEventMs),
        longestInputDelayMs: Math.round(result.longestInputDelayMs),
      }
    },
  }
}

export function isSlowFocusWindow(summary: FocusWindowSummary): boolean {
  return (
    summary.blockedMs >= FOCUS_WARN_BLOCKED_MS ||
    summary.longestInputDelayMs >= FOCUS_WARN_INPUT_DELAY_MS
  )
}

interface EventTimingEntry extends PerformanceEntry {
  processingStart: number
}

function isEventTimingEntry(entry: PerformanceEntry): entry is EventTimingEntry {
  return 'processingStart' in entry && typeof entry.processingStart === 'number'
}

let stop: (() => void) | null = null

/**
 * Begin watching for refocus. Safe where the observers are missing, and a second call is a
 * no-op that returns the first disposer, matching `startLongTaskMonitor`.
 */
export function startFocusResponsivenessMonitor(
  getContext: () => Record<string, unknown> = () => ({}),
): () => void {
  if (stop) return stop
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined

  const tracker = createFocusWindowTracker()
  let awaySince: number | null = document.visibilityState === 'hidden' ? performance.now() : null
  let windowTimer: ReturnType<typeof setTimeout> | null = null

  const supported =
    typeof PerformanceObserver === 'undefined' ? [] : (PerformanceObserver.supportedEntryTypes ?? [])

  const longTaskObserver = supported.includes('longtask')
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tracker.recordLongTask(entry.duration)
      })
    : null
  longTaskObserver?.observe({ type: 'longtask' })

  const eventObserver = supported.includes('event')
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!isEventTimingEntry(entry)) continue
          tracker.recordEvent(entry.duration, entry.processingStart - entry.startTime)
        }
      })
    : null
  // `durationThreshold` is part of Event Timing but missing from the DOM typings in use.
  const eventObserverInit: PerformanceObserverInit & { durationThreshold: number } = {
    type: 'event',
    durationThreshold: EVENT_DURATION_THRESHOLD_MS,
  }
  eventObserver?.observe(eventObserverInit)

  const closeWindow = () => {
    windowTimer = null
    const summary = tracker.finish()
    if (!summary) return

    const line = { ...summary, windowMs: FOCUS_WINDOW_MS, ...getContext() }
    if (isSlowFocusWindow(summary)) log.warn('[Perf]', 'Window focus regained', line)
    else log.info('[Perf]', 'Window focus regained', line)
  }

  const markAway = () => {
    if (awaySince === null) awaySince = performance.now()
  }

  const markReturned = () => {
    if (awaySince === null) return
    const now = performance.now()
    const awayMs = now - awaySince
    awaySince = null
    if (awayMs < MIN_AWAY_MS || tracker.isActive()) return

    tracker.start(awayMs)
    requestAnimationFrame(() => tracker.recordFirstFrame(performance.now() - now))
    windowTimer = setTimeout(closeWindow, FOCUS_WINDOW_MS)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') markAway()
    else markReturned()
  }

  window.addEventListener('blur', markAway)
  window.addEventListener('focus', markReturned)
  document.addEventListener('visibilitychange', onVisibilityChange)

  stop = () => {
    window.removeEventListener('blur', markAway)
    window.removeEventListener('focus', markReturned)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    longTaskObserver?.disconnect()
    eventObserver?.disconnect()
    if (windowTimer) clearTimeout(windowTimer)
    stop = null
  }

  return stop
}
