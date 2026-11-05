/**
 * Whether a version's references are frozen (gap 12 c).
 *
 * A released version whose closure is exact cannot change underneath it: every edge names the
 * child version recorded at check-in, and the database refuses deleting a version a released
 * version's closure references (schema 515, hint `REFERENCED_BY_RELEASE`). Version history marks
 * such a version "References frozen"; releasing an assembly or drawing whose newest version's
 * closure is approximate is warned about first.
 *
 * `freezeStatusOf` is pure. `getFreezeStatus` reads the closure once per version and keeps the
 * answer in a small bounded cache (a version's recorded references never change; an approximate
 * closure can, so its answer expires).
 */

import { getVersionDependencyClosure } from '@/lib/supabase/reviews'
import type { DependencyClosureRow } from '@/types/reviews'

import type { FreezeStatus } from './types'

export function freezeStatusOf(rows: readonly DependencyClosureRow[]): FreezeStatus {
  if (rows.some((r) => !r.exact)) return 'approximate'
  if (rows.some((r) => r.depth > 0 && r.missing)) return 'missing'
  return 'frozen'
}

const MAX_ENTRIES = 500
/** An approximate answer follows today's references, so it is read again after this long. */
const APPROXIMATE_TTL_MS = 5 * 60 * 1000

interface Cached {
  status: FreezeStatus
  at: number
}

const cache = new Map<string, Cached>()
const inFlight = new Map<string, Promise<FreezeStatus>>()

/** Closure reads at once: version history can list many released versions. */
const MAX_PARALLEL = 4
let running = 0
const waiting: Array<() => void> = []

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function remember(id: string, status: FreezeStatus, at: number): void {
  cache.delete(id)
  cache.set(id, { status, at })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export interface FreezeDeps {
  closure: (fileVersionId: string) => Promise<DependencyClosureRow[]>
  now: () => number
}

const defaultDeps: FreezeDeps = { closure: getVersionDependencyClosure, now: () => Date.now() }

/** The freeze status of one version, from the cache when it is fresh. Throws on a read error. */
export async function getFreezeStatus(
  fileVersionId: string,
  deps: FreezeDeps = defaultDeps,
): Promise<FreezeStatus> {
  const hit = cache.get(fileVersionId)
  if (hit && (hit.status !== 'approximate' || deps.now() - hit.at < APPROXIMATE_TTL_MS)) {
    return hit.status
  }
  const pending = inFlight.get(fileVersionId)
  if (pending) return pending
  const read = limited(() => deps.closure(fileVersionId))
    .then((rows) => {
      const status = freezeStatusOf(rows)
      remember(fileVersionId, status, deps.now())
      return status
    })
    .finally(() => inFlight.delete(fileVersionId))
  inFlight.set(fileVersionId, read)
  return read
}

/** For tests and sign-out: forget every cached answer. */
export function resetFreezeCache(): void {
  cache.clear()
  inFlight.clear()
}

/** How many answers the cache holds (tests). */
export function freezeCacheSize(): number {
  return cache.size
}
