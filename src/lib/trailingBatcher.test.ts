import { describe, expect, it, vi } from 'vitest'

import { createTrailingBatcher, type BatcherTimers } from './trailingBatcher'

function fakeTimers() {
  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, { at: number; callback: () => void }>()

  const timers: BatcherTimers = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle++
      scheduled.set(handle, { at: now + delayMs, callback })
      return handle
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number)
    },
  }

  const advance = (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = [...scheduled.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      scheduled.delete(due[0])
      now = due[1].at
      due[1].callback()
    }
    now = target
  }

  return { timers, advance }
}

describe('createTrailingBatcher', () => {
  it('turns a burst into one flush after the quiet period', () => {
    const { timers, advance } = fakeTimers()
    const onFlush = vi.fn()
    const batcher = createTrailingBatcher({ onFlush, quietMs: 250, maxWaitMs: 1000, timers })

    batcher.add('a')
    advance(100)
    batcher.add('b')
    advance(100)
    batcher.add('c')
    advance(249)
    expect(onFlush).not.toHaveBeenCalled()

    advance(1)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(batcher.size).toBe(0)
  })

  it('flushes at the max wait even when events keep arriving inside the quiet period', () => {
    const { timers, advance } = fakeTimers()
    const onFlush = vi.fn()
    const batcher = createTrailingBatcher({ onFlush, quietMs: 250, maxWaitMs: 1000, timers })

    // One event every 200 ms: the quiet period never elapses.
    for (let i = 0; i < 5; i++) {
      batcher.add(`id-${i}`)
      advance(200)
    }
    batcher.add('id-5')
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(['id-0', 'id-1', 'id-2', 'id-3', 'id-4'])

    advance(250)
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush).toHaveBeenLastCalledWith(['id-5'])
  })

  it('de-duplicates ids and keeps arrival order', () => {
    const { timers, advance } = fakeTimers()
    const onFlush = vi.fn()
    const batcher = createTrailingBatcher({ onFlush, timers })

    batcher.add('b')
    batcher.add('a')
    batcher.add('b')
    advance(250)

    expect(onFlush).toHaveBeenCalledWith(['b', 'a'])
  })

  it('flush() hands over pending ids immediately and cancels the timer', () => {
    const { timers, advance } = fakeTimers()
    const onFlush = vi.fn()
    const batcher = createTrailingBatcher({ onFlush, timers })

    batcher.add('a')
    expect(batcher.has('a')).toBe(true)
    batcher.flush()
    expect(onFlush).toHaveBeenCalledWith(['a'])
    expect(batcher.has('a')).toBe(false)

    advance(5000)
    expect(onFlush).toHaveBeenCalledTimes(1)
    // Flushing nothing is a no-op.
    batcher.flush()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('cancel() drops pending ids without a flush', () => {
    const { timers, advance } = fakeTimers()
    const onFlush = vi.fn()
    const batcher = createTrailingBatcher({ onFlush, timers })

    batcher.add('a')
    batcher.cancel()
    advance(5000)

    expect(onFlush).not.toHaveBeenCalled()
    expect(batcher.size).toBe(0)
  })
})
