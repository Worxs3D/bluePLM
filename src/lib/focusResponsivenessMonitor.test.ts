import { describe, expect, it } from 'vitest'

import {
  createFocusWindowTracker,
  FOCUS_WARN_BLOCKED_MS,
  FOCUS_WARN_INPUT_DELAY_MS,
  isSlowFocusWindow,
} from './focusResponsivenessMonitor'

describe('createFocusWindowTracker', () => {
  it('records nothing until a window is started, and finishes to null', () => {
    const tracker = createFocusWindowTracker()

    tracker.recordLongTask(900)
    tracker.recordEvent(300, 250)

    expect(tracker.isActive()).toBe(false)
    expect(tracker.finish()).toBeNull()
  })

  it('sums blocking above the 50 ms floor and keeps the longest task', () => {
    const tracker = createFocusWindowTracker()
    tracker.start(12_345.6)

    tracker.recordLongTask(250)
    tracker.recordLongTask(90)

    expect(tracker.finish()).toMatchObject({
      awayMs: 12_346,
      longTasks: 2,
      blockedMs: 240,
      longestTaskMs: 250,
    })
  })

  it('keeps the first frame time and the worst input delay', () => {
    const tracker = createFocusWindowTracker()
    tracker.start(5_000)

    tracker.recordFirstFrame(40.4)
    tracker.recordFirstFrame(900)
    tracker.recordEvent(120, 30)
    tracker.recordEvent(80, 70)

    expect(tracker.finish()).toMatchObject({
      firstFrameMs: 40,
      slowEvents: 2,
      longestEventMs: 120,
      longestInputDelayMs: 70,
    })
  })

  it('is empty again after finish, so the next refocus starts clean', () => {
    const tracker = createFocusWindowTracker()
    tracker.start(4_000)
    tracker.recordLongTask(500)
    tracker.finish()

    tracker.start(4_000)
    expect(tracker.finish()).toMatchObject({ longTasks: 0, blockedMs: 0 })
  })
})

describe('isSlowFocusWindow', () => {
  const quiet = {
    awayMs: 10_000,
    firstFrameMs: 16,
    longTasks: 0,
    blockedMs: 0,
    longestTaskMs: 0,
    slowEvents: 0,
    longestEventMs: 0,
    longestInputDelayMs: 0,
  }

  it('is false for a quiet window', () => {
    expect(isSlowFocusWindow(quiet)).toBe(false)
  })

  it('is true when blocking or input delay reaches its threshold', () => {
    expect(isSlowFocusWindow({ ...quiet, blockedMs: FOCUS_WARN_BLOCKED_MS })).toBe(true)
    expect(isSlowFocusWindow({ ...quiet, longestInputDelayMs: FOCUS_WARN_INPUT_DELAY_MS })).toBe(true)
  })
})
