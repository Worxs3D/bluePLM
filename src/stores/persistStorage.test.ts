import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'

import {
  createPersistStorage,
  flushPersistStorageOnPageHide,
  getTopPersistedKeySizes,
  isPersistedStateUnchanged,
  memoizeByReference,
  PERSIST_DEBOUNCE_MS,
  PERSIST_ROLLUP_INTERVAL_MS,
  type PersistBackingStorage,
} from './persistStorage'

const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ log: logMock }))

const NAME = 'blue-plm-storage'

class FakeStorage implements PersistBackingStorage {
  items = new Map<string, string>()
  setCalls = 0
  bytesWritten = 0

  getItem(name: string): string | null {
    return this.items.get(name) ?? null
  }

  setItem(name: string, value: string): void {
    this.setCalls += 1
    this.bytesWritten += value.length
    this.items.set(name, value)
  }

  removeItem(name: string): void {
    this.items.delete(name)
  }
}

function blob(state: Record<string, unknown>, version = 1): StorageValue<unknown> {
  return { state, version }
}

describe('isPersistedStateUnchanged', () => {
  const shared = { a: 1 }

  it('is false with nothing to compare against', () => {
    expect(isPersistedStateUnchanged(null, blob({ shared }))).toBe(false)
  })

  it('is true when every key holds the same reference', () => {
    expect(isPersistedStateUnchanged(blob({ shared, n: 2 }), blob({ shared, n: 2 }))).toBe(true)
  })

  it('is false when one key holds an equal but different reference', () => {
    expect(isPersistedStateUnchanged(blob({ shared }), blob({ shared: { a: 1 } }))).toBe(false)
  })

  it('is false when a key was added or removed', () => {
    expect(isPersistedStateUnchanged(blob({ shared }), blob({ shared, extra: 1 }))).toBe(false)
    expect(isPersistedStateUnchanged(blob({ shared, extra: 1 }), blob({ shared }))).toBe(false)
  })

  it('is false when the version changed', () => {
    expect(isPersistedStateUnchanged(blob({ shared }, 1), blob({ shared }, 2))).toBe(false)
  })
})

describe('memoizeByReference', () => {
  it('returns the same output for the same input reference and recomputes for a new one', () => {
    const derive = vi.fn((input: string[]) => input.slice(0, 1))
    const memo = memoizeByReference(derive)
    const input = ['a', 'b']

    expect(memo(input)).toBe(memo(input))
    expect(derive).toHaveBeenCalledTimes(1)

    memo(['a', 'b'])
    expect(derive).toHaveBeenCalledTimes(2)
  })
})

describe('createPersistStorage', () => {
  let backing: FakeStorage

  beforeEach(() => {
    vi.useFakeTimers()
    logMock.info.mockClear()
    logMock.warn.mockClear()
    backing = new FakeStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeStorage() {
    return createPersistStorage({ getStorage: () => backing, now: () => Date.now() })
  }

  it('writes once after the debounce, with the latest value, however many sets came before', () => {
    const storage = makeStorage()

    for (let i = 0; i < 50; i++) storage.setItem(NAME, blob({ counter: i }))
    expect(backing.setCalls).toBe(0)

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)

    expect(backing.setCalls).toBe(1)
    expect(JSON.parse(backing.items.get(NAME) ?? '{}')).toEqual({ state: { counter: 49 }, version: 1 })
  })

  it('does not write again when a later set carries the same references', () => {
    const storage = makeStorage()
    const tabs = [{ id: 1 }]

    storage.setItem(NAME, blob({ tabs }))
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    storage.setItem(NAME, blob({ tabs }))
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)

    expect(backing.setCalls).toBe(1)
  })

  it('writes again when a persisted key changes', () => {
    const storage = makeStorage()

    storage.setItem(NAME, blob({ tabs: [1] }))
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    storage.setItem(NAME, blob({ tabs: [1, 2] }))
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)

    expect(backing.setCalls).toBe(2)
    expect(JSON.parse(backing.items.get(NAME) ?? '{}').state.tabs).toEqual([1, 2])
  })

  it('flush writes the pending value immediately and the timer does not write it twice', () => {
    const storage = makeStorage()

    storage.setItem(NAME, blob({ theme: 'dark' }))
    storage.flush()
    expect(backing.setCalls).toBe(1)

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2)
    expect(backing.setCalls).toBe(1)
  })

  it('flush with nothing pending does nothing', () => {
    const storage = makeStorage()
    storage.flush()
    expect(backing.setCalls).toBe(0)
  })

  it('discard removes the stored blob and refuses later writes, pending or new', () => {
    const storage = makeStorage()
    backing.items.set(NAME, '{"state":{},"version":1}')

    storage.setItem(NAME, blob({ theme: 'dark' }))
    storage.discard(NAME)
    storage.setItem(NAME, blob({ theme: 'light' }))
    storage.flush()
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2)

    expect(backing.items.has(NAME)).toBe(false)
    expect(backing.setCalls).toBe(0)
  })

  it('removeItem drops a write that was still waiting', () => {
    const storage = makeStorage()

    storage.setItem(NAME, blob({ theme: 'dark' }))
    storage.removeItem(NAME)
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2)

    expect(backing.items.has(NAME)).toBe(false)
  })

  it('reads a stored blob back and returns null for missing or non-object values', () => {
    const storage = makeStorage()
    expect(storage.getItem(NAME)).toBeNull()

    backing.items.set(NAME, '"just a string"')
    expect(storage.getItem(NAME)).toBeNull()

    backing.items.set(NAME, JSON.stringify(blob({ theme: 'dark' })))
    expect(storage.getItem(NAME)).toEqual(blob({ theme: 'dark' }))
  })

  it('logs the biggest keys when the stored blob is large, and not when it is small', () => {
    const storage = makeStorage()

    backing.items.set(NAME, JSON.stringify(blob({ small: 1 })))
    storage.getItem(NAME)
    expect(logMock.info).not.toHaveBeenCalledWith('[Perf]', 'Persisted blob is large', expect.anything())

    const bulkyEntryCount = 12_000
    const bulky: Record<string, number> = {}
    for (let i = 0; i < bulkyEntryCount; i++) bulky[`C:\\vault\\file-${i}.SLDPRT`] = i
    backing.items.set(NAME, JSON.stringify(blob({ small: 1, persistedMetadataWriteState: bulky })))
    storage.getItem(NAME)

    const largeCall = logMock.info.mock.calls.find((call) => call[1] === 'Persisted blob is large')
    expect(largeCall).toBeDefined()
    const details = largeCall?.[2] as { topLevelKeys: Array<{ key: string; entries: number | null }> }
    expect(details.topLevelKeys[0]).toMatchObject({
      key: 'persistedMetadataWriteState',
      entries: bulkyEntryCount,
    })
  })

  it('logs a rollup of requested, skipped and written once the interval has passed', () => {
    const storage = makeStorage()
    const tabs = [1]

    storage.setItem(NAME, blob({ tabs }))
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    storage.setItem(NAME, blob({ tabs }))
    vi.advanceTimersByTime(PERSIST_ROLLUP_INTERVAL_MS)
    storage.setItem(NAME, blob({ tabs }))

    const rollup = logMock.info.mock.calls.find((call) => call[1] === 'Persist writes')
    expect(rollup?.[2]).toMatchObject({ requested: 2, skippedUnchanged: 1, written: 1 })
  })
})

describe('getTopPersistedKeySizes', () => {
  it('orders keys by serialized size and counts entries', () => {
    const top = getTopPersistedKeySizes(
      blob({ small: 'x', big: ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'], mid: { a: 1, b: 2 } }),
    )

    expect(top.map((entry) => entry.key)).toEqual(['big', 'mid', 'small'])
    expect(top[0].entries).toBe(3)
    expect(top[2].entries).toBeNull()
  })
})

describe('store writes that change nothing persisted', () => {
  // The reported blob was 701,839 bytes. Replays a burst of store writes that touch only
  // unpersisted state, through zustand's real persist middleware, once with the old adapter
  // behaviour (serialize and store on every call) and once with the new one.
  const BLOB_ENTRY_COUNT = 8_000
  const STORE_WRITES = 300

  interface ReplayState {
    persistedMetadataWriteState: Record<string, { promoted: boolean }>
    tabs: string[]
    progress: number
  }

  function initialState(): ReplayState {
    const map: Record<string, { promoted: boolean }> = {}
    for (let i = 0; i < BLOB_ENTRY_COUNT; i++) {
      map[`C:\\BluePLM\\br-vault\\FOLDER-${i % 97}\\PART-${i}.SLDPRT`] = { promoted: i % 2 === 0 }
    }
    return { persistedMetadataWriteState: map, tabs: ['explorer'], progress: 0 }
  }

  function replay(storage: PersistStorage<unknown>): void {
    const store = createStore<ReplayState>()(
      persist(() => initialState(), {
        name: NAME,
        storage,
        partialize: (state) => ({
          persistedMetadataWriteState: state.persistedMetadataWriteState,
          tabs: state.tabs,
        }),
      }),
    )
    for (let i = 1; i <= STORE_WRITES; i++) store.setState({ progress: i })
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('old behaviour serialized the whole blob on every store write', () => {
    const backing = new FakeStorage()
    replay({
      getItem: () => null,
      setItem: (name, value) => backing.setItem(name, JSON.stringify(value)),
      removeItem: (name) => backing.removeItem(name),
    })

    expect(backing.setCalls).toBeGreaterThanOrEqual(STORE_WRITES)
    expect(backing.bytesWritten).toBeGreaterThan(STORE_WRITES * 400_000)
  })

  it('new behaviour writes the blob once for the whole burst', () => {
    const backing = new FakeStorage()
    const storage = createPersistStorage({ getStorage: () => backing, now: () => Date.now() })

    replay(storage)
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)

    expect(backing.setCalls).toBe(1)
    expect(backing.bytesWritten).toBeLessThan(2_000_000)
  })
})

describe('flushPersistStorageOnPageHide', () => {
  it('does nothing and returns a disposer where there is no window', () => {
    const flush = vi.fn()
    const dispose = flushPersistStorageOnPageHide({ flush })

    expect(() => dispose()).not.toThrow()
    expect(flush).not.toHaveBeenCalled()
  })
})
