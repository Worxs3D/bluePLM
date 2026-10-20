/**
 * Storage adapter for the store's `persist` middleware.
 *
 * zustand's `persist` calls `setItem` after EVERY `set()`, whether or not a persisted key changed,
 * and the old adapter answered each call with `JSON.stringify` of the whole blob plus a synchronous
 * `localStorage.setItem`. That is harmless at 55 KB and expensive at 700 KB: a session log from a
 * machine with a 701,839-byte blob showed a 2.4 GB renderer working set collapsing to 574 MB, and
 * four 3.5 s stalls with no script, layout or paint behind them in the first 40 seconds - garbage
 * collection over megabytes of throwaway strings per store write.
 *
 * This adapter does three things about that:
 *
 * 1. It skips a write when no persisted key changed, judged per key by reference. That only works
 *    when `partialize` returns stable references, so derived values there go through
 *    `memoizeByReference`.
 * 2. It coalesces the writes that remain behind a trailing debounce, serializing once per burst
 *    instead of once per `set()`.
 * 3. It flushes a pending write when the page is hidden or unloading, so the debounce never
 *    costs more than the last moments before a crash.
 *
 * It also logs what it is doing - a rollup of writes and bytes, and the biggest keys when the
 * blob is large - so the next report says what is filling the blob instead of leaving it to be
 * guessed.
 */

import type { PersistStorage, StorageValue } from 'zustand/middleware'

import { log } from '@/lib/logger'
import { PERSIST_WRITE_THRESHOLD_MS } from '@/lib/performanceThresholds'

/** Quiet period after the last store write before the blob is serialized and stored. */
export const PERSIST_DEBOUNCE_MS = 500

/** A blob over this gets its biggest keys logged at startup, not only when a write is slow. */
export const LARGE_BLOB_BYTES = 256 * 1024

/** How often the write counters are logged, when there were any writes. */
export const PERSIST_ROLLUP_INTERVAL_MS = 30_000

const MAX_PERSISTED_KEY_DETAILS = 5

export interface PersistedKeySize {
  key: string
  bytes: number
  entries: number | null
}

/** The part of `Storage` the adapter uses, so a test can hand it a map. */
export interface PersistBackingStorage {
  getItem: (name: string) => string | null
  setItem: (name: string, value: string) => void
  removeItem: (name: string) => void
}

export interface PersistStorageOptions {
  getStorage: () => PersistBackingStorage | null
  debounceMs?: number
  rollupIntervalMs?: number
  now?: () => number
}

export interface PersistStorageHandle extends PersistStorage<unknown> {
  /** Write any pending blob now. A no-op when nothing is pending. */
  flush: () => void
  /**
   * Remove the stored blob and refuse every later write until the page reloads. For a "fresh
   * start": the store is still live for a moment after the blob is removed, and a debounced or
   * flush-on-unload write would otherwise put the old state straight back.
   */
  discard: (name: string) => void
}

interface RollupCounters {
  requested: number
  skippedUnchanged: number
  written: number
  totalBytes: number
  maxBytes: number
  serializeMs: number
}

function emptyCounters(): RollupCounters {
  return {
    requested: 0,
    skippedUnchanged: 0,
    written: 0,
    totalBytes: 0,
    maxBytes: 0,
    serializeMs: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const textEncoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder()

function getByteLength(value: string): number {
  return textEncoder ? textEncoder.encode(value).length : value.length
}

function countEntries(value: unknown): number | null {
  if (Array.isArray(value)) return value.length
  if (isRecord(value)) return Object.keys(value).length
  return null
}

/** The biggest top-level keys of a persisted blob, with how many entries each holds. */
export function getTopPersistedKeySizes(value: StorageValue<unknown>): PersistedKeySize[] {
  if (!isRecord(value.state)) return []

  return Object.entries(value.state)
    .map(([key, stateValue]) => {
      const serialized = JSON.stringify(stateValue)
      return {
        key,
        bytes: serialized === undefined ? 0 : getByteLength(serialized),
        entries: countEntries(stateValue),
      }
    })
    .sort((first, second) => second.bytes - first.bytes)
    .slice(0, MAX_PERSISTED_KEY_DETAILS)
}

/**
 * True when the two blobs would serialize identically as far as this adapter can tell: same
 * version, same keys, and every key holding the very same reference. A different key set counts as
 * a change, so a key added or removed by a migration is written.
 */
export function isPersistedStateUnchanged(
  previous: StorageValue<unknown> | null,
  next: StorageValue<unknown>,
): boolean {
  if (!previous) return false
  if (previous.version !== next.version) return false
  const previousState = previous.state
  const nextState = next.state
  if (!isRecord(previousState) || !isRecord(nextState)) return false

  const previousKeys = Object.keys(previousState)
  const nextKeys = Object.keys(nextState)
  if (previousKeys.length !== nextKeys.length) return false

  return nextKeys.every((key) => key in previousState && Object.is(previousState[key], nextState[key]))
}

/** How many changed keys a slow-write log line names; more than this is "everything changed". */
const MAX_CHANGED_KEYS_LOGGED = 10

/**
 * Top-level keys whose reference differs between two blobs: what the store action that caused
 * the write actually touched. `null` previous means everything is new.
 */
export function getChangedPersistedKeys(
  previous: StorageValue<unknown> | null,
  next: StorageValue<unknown>,
): string[] {
  if (!isRecord(next.state)) return []
  const nextState = next.state
  const previousState = previous && isRecord(previous.state) ? previous.state : null

  return Object.keys(nextState).filter(
    (key) => !previousState || !(key in previousState) || !Object.is(previousState[key], nextState[key]),
  )
}

/**
 * Wrap a pure function so that calling it again with the same input reference returns the same
 * output reference. `partialize` rebuilds derived values (a Set as an array, a sliced list) on
 * every call; without this each call looks like a change to `isPersistedStateUnchanged`.
 */
export function memoizeByReference<Input, Output>(
  derive: (input: Input) => Output,
): (input: Input) => Output {
  let hasValue = false
  let lastInput: Input
  let lastOutput: Output

  return (input) => {
    if (hasValue && Object.is(lastInput, input)) return lastOutput
    lastOutput = derive(input)
    lastInput = input
    hasValue = true
    return lastOutput
  }
}

export function createPersistStorage(options: PersistStorageOptions): PersistStorageHandle {
  const {
    getStorage,
    debounceMs = PERSIST_DEBOUNCE_MS,
    rollupIntervalMs = PERSIST_ROLLUP_INTERVAL_MS,
    now = () => performance.now(),
  } = options

  let counters = emptyCounters()
  let lastRollupAt = now()
  let blobSizeLogged = false

  // What the storage will hold once the pending write lands, for the unchanged check.
  let lastSeen: StorageValue<unknown> | null = null
  let pending: { name: string; value: StorageValue<unknown> } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let discarded = false
  // Keys that changed since the last write landed. A debounced write is no longer tied to the
  // store action that asked for it, so the keys are the only attribution a slow write can carry.
  const changedSinceWrite = new Set<string>()

  const logRollupIfDue = () => {
    const current = now()
    if (current - lastRollupAt < rollupIntervalMs) return

    const rollup = counters
    counters = emptyCounters()
    lastRollupAt = current
    if (rollup.requested === 0) return

    log.info('[Perf]', 'Persist writes', {
      requested: rollup.requested,
      skippedUnchanged: rollup.skippedUnchanged,
      written: rollup.written,
      totalBytes: rollup.totalBytes,
      maxBytes: rollup.maxBytes,
      serializeMs: Math.round(rollup.serializeMs),
      windowMs: Math.round(rollupIntervalMs),
    })
  }

  const writePending = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return

    const { name, value } = pending
    pending = null
    const changedKeys = Array.from(changedSinceWrite)
    changedSinceWrite.clear()

    const serializeStart = now()
    const serialized = JSON.stringify(value)
    const serializeMs = now() - serializeStart
    if (serialized === undefined) return

    const writeStart = now()
    getStorage()?.setItem(name, serialized)
    const writeMs = now() - writeStart
    const totalMs = now() - serializeStart
    const totalBytes = getByteLength(serialized)

    counters.written += 1
    counters.totalBytes += totalBytes
    counters.maxBytes = Math.max(counters.maxBytes, totalBytes)
    counters.serializeMs += serializeMs

    if (totalMs < PERSIST_WRITE_THRESHOLD_MS) return

    log.warn('[Perf]', 'Persist write', {
      key: name,
      serializeMs: Math.round(serializeMs),
      writeMs: Math.round(writeMs),
      totalMs: Math.round(totalMs),
      totalBytes,
      changedKeys: changedKeys.slice(0, MAX_CHANGED_KEYS_LOGGED),
      changedKeyCount: changedKeys.length,
      topLevelKeys: getTopPersistedKeySizes(value),
    })
  }

  return {
    getItem: (name) => {
      const rawValue = getStorage()?.getItem(name) ?? null

      if (!blobSizeLogged) {
        blobSizeLogged = true
        log.info('[Perf]', 'Persisted blob size', {
          key: name,
          totalBytes: rawValue === null ? 0 : getByteLength(rawValue),
        })
      }

      if (rawValue === null) return null

      const parsed: unknown = JSON.parse(rawValue)
      if (!isRecord(parsed)) return null

      const stored = parsed as unknown as StorageValue<unknown>
      if (rawValue.length > LARGE_BLOB_BYTES) {
        log.info('[Perf]', 'Persisted blob is large', {
          key: name,
          totalBytes: getByteLength(rawValue),
          topLevelKeys: getTopPersistedKeySizes(stored),
        })
      }
      return stored
    },

    setItem: (name, value) => {
      if (discarded) return
      // Before counting this call, so the rollup describes the interval that just ended.
      logRollupIfDue()
      counters.requested += 1

      if (isPersistedStateUnchanged(lastSeen, value)) {
        counters.skippedUnchanged += 1
        return
      }

      for (const key of getChangedPersistedKeys(lastSeen, value)) changedSinceWrite.add(key)
      lastSeen = value
      pending = { name, value }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(writePending, debounceMs)
    },

    removeItem: (name) => {
      // A removed blob must not be resurrected by a write that was still waiting.
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
      lastSeen = null
      getStorage()?.removeItem(name)
    },

    flush: writePending,

    discard: (name) => {
      discarded = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
      lastSeen = null
      getStorage()?.removeItem(name)
    },
  }
}

/**
 * Flush a pending write when the page is hidden or going away, which is the last chance the
 * debounce gets. Returns a disposer. Safe where there is no `window` (tests, SSR).
 */
export function flushPersistStorageOnPageHide(storage: Pick<PersistStorageHandle, 'flush'>): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') storage.flush()
  }
  const onPageHide = () => storage.flush()

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onPageHide)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('beforeunload', onPageHide)
  }
}
