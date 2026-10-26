import { describe, expect, it, vi } from 'vitest'

import type { VaultWatcher } from './fsWatcher'
import { createWatcherLifecycle } from './watcherLifecycle'

function fakeWatchers(closeDelayMs = 5) {
  const open = new Set<string>()
  const create = (dirPath: string): VaultWatcher => {
    const id = `${dirPath}#${open.size}-${Math.random()}`
    open.add(id)
    return {
      close: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            open.delete(id)
            resolve()
          }, closeDelayMs),
        ),
    } as VaultWatcher
  }
  return { open, create }
}

describe('watcher lifecycle', () => {
  it('leaves exactly one watcher open after overlapping vault switches', async () => {
    const { open, create } = fakeWatchers()
    const life = createWatcherLifecycle(create, () => {})
    await life.start('A')
    // Two switches without awaiting the first: the race that leaked a watcher.
    await Promise.all([life.start('B'), life.start('C')])
    expect(open.size).toBe(1)
    expect([...open][0].startsWith('C#')).toBe(true)
  })

  it('stays at one open watcher across many start/stop cycles', async () => {
    const { open, create } = fakeWatchers(1)
    const life = createWatcherLifecycle(create, () => {})
    const all: Array<Promise<void>> = []
    for (let i = 0; i < 200; i++) {
      all.push(life.start(`V${i % 3}`))
      if (i % 7 === 0) all.push(life.stop())
    }
    await Promise.all(all)
    expect(open.size).toBe(life.current() ? 1 : 0)
    await life.stop()
    expect(open.size).toBe(0)
  })

  it('does not let a close that never settles block the next start', async () => {
    vi.useFakeTimers()
    try {
      const created: string[] = []
      const life = createWatcherLifecycle(
        (dirPath) => {
          created.push(dirPath)
          return { close: () => new Promise<void>(() => {}) } as VaultWatcher
        },
        () => {},
        100,
      )
      await life.start('A')
      const next = life.start('B')
      await vi.advanceTimersByTimeAsync(150)
      await next
      expect(created).toEqual(['A', 'B'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('dedupes a start for the path already watched', async () => {
    const { open, create } = fakeWatchers()
    const life = createWatcherLifecycle(create, () => {})
    await life.start('A')
    await life.start('A')
    expect(open.size).toBe(1)
  })
})
