/**
 * Guards for every collection a long session could grow, run at many times its cap: the size must
 * stay at or under the cap however long the app runs. One test per cap; a new cap gets one here.
 */
import { describe, expect, it } from 'vitest'

import { markRecentlyModified, RECENTLY_MODIFIED_WINDOW_MS, isRecentlyModified } from '@/lib/recentlyModified'
import { capToasts, MAX_MESSAGE_TOASTS } from '@/stores/slices/toastsSlice'
import type { ToastMessage } from '@/stores/types'

import { dropRebuildableCaches, rebuildableCacheSizes, registerRebuildableCache } from './cacheRegistry'
import { collectionSizes } from './collectionSizes'

describe('recently modified files', () => {
  it('holds only the files written inside the window, over a month of edits', () => {
    let map = new Map<string, number>()
    let now = 0
    let largest = 0
    // A busy month: an edit every 2 s on a rotating set of 30k files.
    for (let i = 0; i < 1_300_000; i++) {
      now += 2_000
      map = markRecentlyModified(map, `file-${i % 30_000}`, now)
      largest = Math.max(largest, map.size)
    }
    expect(largest).toBeLessThanOrEqual(RECENTLY_MODIFIED_WINDOW_MS / 2_000 + 1)
    expect(isRecentlyModified(map, `file-${(1_300_000 - 1) % 30_000}`, now)).toBe(true)
    expect(isRecentlyModified(map, 'file-0', now + RECENTLY_MODIFIED_WINDOW_MS)).toBe(false)
  })
})

describe('toasts', () => {
  const message = (i: number): ToastMessage => ({ id: `m${i}`, type: 'error', message: `failed ${i}`, duration: 0 })
  const progress = (i: number): ToastMessage => ({
    id: `p${i}`,
    type: 'progress',
    message: 'Downloading',
    duration: 0,
    progress: { current: 0, total: 10, percent: 0 },
  })

  it('keeps at most the cap of message toasts after 20 times the cap, newest kept', () => {
    let toasts: ToastMessage[] = []
    for (let i = 0; i < MAX_MESSAGE_TOASTS * 20; i++) {
      toasts = capToasts([...toasts, message(i)])
      expect(toasts.length).toBeLessThanOrEqual(MAX_MESSAGE_TOASTS)
    }
    expect(toasts[toasts.length - 1].id).toBe(`m${MAX_MESSAGE_TOASTS * 20 - 1}`)
  })

  it('never drops a progress toast its operation still owns', () => {
    let toasts: ToastMessage[] = [progress(1), progress(2)]
    for (let i = 0; i < MAX_MESSAGE_TOASTS * 5; i++) toasts = capToasts([...toasts, message(i)])
    expect(toasts.filter((t) => t.type === 'progress').map((t) => t.id)).toEqual(['p1', 'p2'])
    expect(toasts).toHaveLength(MAX_MESSAGE_TOASTS + 2)
  })
})

describe('rebuildable cache registry', () => {
  it('drops every registered cache and keeps one entry per name', () => {
    const a = new Map<number, number>()
    for (let i = 0; i < 100; i++) a.set(i, i)
    for (let i = 0; i < 10; i++) registerRebuildableCache('test-a', { size: () => a.size, drop: () => a.clear() })
    registerRebuildableCache('test-broken', {
      size: () => {
        throw new Error('x')
      },
      drop: () => {
        throw new Error('x')
      },
    })
    expect(rebuildableCacheSizes()['test-a']).toBe(100)
    expect(rebuildableCacheSizes()['test-broken']).toBe(-1)
    expect(dropRebuildableCaches()).toContain('test-a')
    expect(a.size).toBe(0)
    expect(Object.keys(rebuildableCacheSizes()).filter((k) => k === 'test-a')).toHaveLength(1)
  })
})

describe('collectionSizes', () => {
  it('sizes arrays, maps, sets and records and skips the rest', () => {
    expect(
      collectionSizes({
        files: [1, 2, 3],
        byId: new Map([[1, 1]]),
        expanded: new Set(['a', 'b']),
        persisted: { a: 1, b: 2 },
        name: 'x',
        count: 3,
        fn: () => 1,
        nothing: null,
        date: new Date(),
      }),
    ).toEqual({ files: 3, byId: 1, expanded: 2, persisted: 2 })
  })
})
