/**
 * The bytes behind a preview: downloaded from the vault bucket by content hash, checked against
 * that hash, and kept in a small least-recently-used cache so clicking between a few rows does
 * not download again. Content-addressed, so a cached entry can never be stale.
 *
 * Bounded for sessions that run for weeks: at most `MAX_ENTRIES` entries and `MAX_BYTES` in all;
 * the oldest go first, and an item larger than the whole budget is returned but never cached.
 * Concurrent requests for one hash share a single download.
 */

import { downloadInspectionContent } from '@/lib/supabase/inspectionReports'

export const PREVIEW_CACHE_MAX_ENTRIES = 8
export const PREVIEW_CACHE_MAX_BYTES = 96 * 1024 * 1024

/** A byte-budgeted LRU. Pure; exported for the tests. */
export class ByteLru {
  private readonly entries = new Map<string, Uint8Array>()
  private total = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get(key: string): Uint8Array | undefined {
    const value = this.entries.get(key)
    if (value) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }

  set(key: string, value: Uint8Array): void {
    const old = this.entries.get(key)
    if (old) {
      this.entries.delete(key)
      this.total -= old.byteLength
    }
    if (value.byteLength > this.maxBytes) return
    this.entries.set(key, value)
    this.total += value.byteLength
    for (const [k, v] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.total <= this.maxBytes) break
      this.entries.delete(k)
      this.total -= v.byteLength
    }
  }

  clear(): void {
    this.entries.clear()
    this.total = 0
  }

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.total
  }
}

const cache = new ByteLru(PREVIEW_CACHE_MAX_ENTRIES, PREVIEW_CACHE_MAX_BYTES)
const inFlight = new Map<string, Promise<Uint8Array>>()

/**
 * The verified bytes of `hash`. `userId` scopes the cache, so after a sign-out the next user never
 * reads what the previous one downloaded (those entries age out). The returned array is shared
 * with the cache: callers that hand it to something that transfers or mutates buffers (pdf.js)
 * pass a copy.
 */
export function loadPreviewBytes(userId: string, orgId: string, hash: string): Promise<Uint8Array> {
  const key = `${userId}:${orgId}:${hash}`
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = inFlight.get(key)
  if (pending) return pending
  const download = downloadInspectionContent(orgId, hash)
    .then((bytes) => {
      cache.set(key, bytes)
      return bytes
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, download)
  return download
}
