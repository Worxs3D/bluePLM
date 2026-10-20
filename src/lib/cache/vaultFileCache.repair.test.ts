import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CachedServerFile } from './vaultFileCache'

vi.mock('@/lib/supabase/files/queries', () => ({
  getFilesDelta: vi.fn(),
  getVaultFilesCount: vi.fn(),
}))

const ORG_ID = 'org-a'
const VAULT_ID = 'vault-a'
const BACKING_STORE_MESSAGE = 'Internal error opening backing store for indexedDB.open.'

function file(id: string): CachedServerFile {
  return {
    id,
    file_path: `designs/${id}.sldprt`,
    file_name: `${id}.sldprt`,
    extension: '.sldprt',
    file_type: 'part',
    part_number: null,
    description: null,
    revision: null,
    version: 1,
    content_hash: `hash-${id}`,
    file_size: 100,
    state: 'In Work',
    checked_out_by: null,
    checked_out_at: null,
    updated_at: '2026-08-10T17:00:00.000Z',
    custom_properties: null,
    checked_out_file_path: null,
    checked_out_file_name: null,
  }
}

function files(count: number): CachedServerFile[] {
  return Array.from({ length: count }, (_, index) => file(`file-${index}`))
}

interface FakeError {
  name: string
  message: string
}

/**
 * IndexedDB fake whose `open` and `deleteDatabase` can be told to fail. `openFailures` is consumed
 * one entry per `open` call (undefined = succeed); `deleteFails` makes every delete fail.
 */
function installFakeIndexedDB(options: {
  openFailures?: Array<FakeError | undefined>
  deleteFails?: boolean
}) {
  const data = new Map<string, unknown>()
  const openFailures = [...(options.openFailures ?? [])]
  const counts = { open: 0, delete: 0, put: 0, get: 0 }
  let storeExists = false

  class FakeRequest {
    result: unknown
    error: unknown = null
    onsuccess: (() => void) | null = null
    onerror: (() => void) | null = null
    onblocked: (() => void) | null = null
    onupgradeneeded: ((event: unknown) => void) | null = null
  }

  const settle = (request: FakeRequest, result: unknown) => {
    queueMicrotask(() => {
      request.result = result
      request.onsuccess?.()
    })
  }

  const store = {
    createIndex: () => undefined,
    get(key: string) {
      counts.get += 1
      const request = new FakeRequest()
      settle(request, data.get(key))
      return request
    },
    put(value: Record<string, unknown>) {
      counts.put += 1
      data.set(String(value.vaultId), value)
      const request = new FakeRequest()
      settle(request, undefined)
      return request
    },
    delete: (key: string) => {
      data.delete(key)
      const request = new FakeRequest()
      settle(request, undefined)
      return request
    },
    clear: () => {
      data.clear()
      const request = new FakeRequest()
      settle(request, undefined)
      return request
    },
  }

  const fakeDb = {
    objectStoreNames: { contains: () => storeExists },
    deleteObjectStore: () => {
      storeExists = false
    },
    createObjectStore: () => {
      storeExists = true
      return store
    },
    transaction: () => ({ objectStore: () => store, abort: () => undefined }),
    close: () => undefined,
    onclose: null as (() => void) | null,
    onversionchange: null as (() => void) | null,
  }

  ;(globalThis as { indexedDB?: unknown }).indexedDB = {
    open() {
      counts.open += 1
      const request = new FakeRequest()
      const failure = openFailures.shift()
      queueMicrotask(() => {
        if (failure) {
          request.error = failure
          request.onerror?.()
          return
        }
        request.result = fakeDb
        if (!storeExists) request.onupgradeneeded?.({ target: { result: fakeDb } })
        request.onsuccess?.()
      })
      return request
    },
    deleteDatabase() {
      counts.delete += 1
      const request = new FakeRequest()
      queueMicrotask(() => {
        if (options.deleteFails) {
          request.error = { name: 'UnknownError', message: 'delete failed' }
          request.onerror?.()
          return
        }
        data.clear()
        storeExists = false
        request.onsuccess?.()
      })
      return request
    },
  }

  return { counts, data }
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('vault file cache IndexedDB self-repair', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: any // TODO: type this - re-imported per test after vi.resetModules()
  let clearIndexedDbStorage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    clearIndexedDbStorage = vi.fn().mockResolvedValue({ success: true })
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: { clearIndexedDbStorage, log: vi.fn() },
    }
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    vi.clearAllMocks()
  })

  async function loadCache() {
    cache = await import('./vaultFileCache')
  }

  it('does not remember a failed open: the next call opens again', async () => {
    const fake = installFakeIndexedDB({
      openFailures: [{ name: 'AbortError', message: 'transient' }],
    })
    await loadCache()

    expect(await cache.getCachedVaultFiles(ORG_ID, VAULT_ID)).toBeNull()
    await cache.setCachedVaultFiles(ORG_ID, VAULT_ID, files(2))
    const read = await cache.getCachedVaultFiles(ORG_ID, VAULT_ID)

    expect(read?.files).toHaveLength(2)
    // One failed open, then one successful open that both later calls share.
    expect(fake.counts.open).toBe(2)
    // A transient error is not corruption: no delete, no main-process clear.
    expect(fake.counts.delete).toBe(0)
    expect(clearIndexedDbStorage).not.toHaveBeenCalled()
  })

  it('deletes the database once on a backing store error and works again afterwards', async () => {
    const fake = installFakeIndexedDB({
      openFailures: [{ name: 'UnknownError', message: BACKING_STORE_MESSAGE }],
    })
    await loadCache()

    // The load that hits the corruption still falls back (null = cache miss), unblocked.
    expect(await cache.getCachedVaultFiles(ORG_ID, VAULT_ID)).toBeNull()
    await cache.waitForVaultCacheRepair()

    expect(fake.counts.delete).toBe(1)
    expect(clearIndexedDbStorage).not.toHaveBeenCalled()

    await cache.setCachedVaultFiles(ORG_ID, VAULT_ID, files(3))
    expect((await cache.getCachedVaultFiles(ORG_ID, VAULT_ID))?.files).toHaveLength(3)
  })

  it('asks the main process to clear storage when deleting the database fails', async () => {
    const fake = installFakeIndexedDB({
      openFailures: [{ name: 'UnknownError', message: BACKING_STORE_MESSAGE }],
      deleteFails: true,
    })
    await loadCache()

    expect(await cache.getCachedVaultFiles(ORG_ID, VAULT_ID)).toBeNull()
    await cache.waitForVaultCacheRepair()

    expect(fake.counts.delete).toBe(1)
    expect(clearIndexedDbStorage).toHaveBeenCalledTimes(1)

    await cache.setCachedVaultFiles(ORG_ID, VAULT_ID, files(1))
    expect((await cache.getCachedVaultFiles(ORG_ID, VAULT_ID))?.files).toHaveLength(1)
  })

  it('never repairs twice in a session and never throws into the load', async () => {
    const corruption = { name: 'UnknownError', message: BACKING_STORE_MESSAGE }
    const fake = installFakeIndexedDB({
      // The first failure starts the repair; the repair's own reopen fails, and so do two more.
      openFailures: [corruption, corruption, corruption, corruption],
      deleteFails: true,
    })
    clearIndexedDbStorage.mockResolvedValue({ success: false, error: 'denied' })
    await loadCache()

    expect(await cache.getCachedVaultFiles(ORG_ID, VAULT_ID)).toBeNull()
    await cache.waitForVaultCacheRepair()
    expect(await cache.getCachedVaultFiles(ORG_ID, VAULT_ID)).toBeNull()
    await cache.waitForVaultCacheRepair()
    await expect(cache.setCachedVaultFiles(ORG_ID, VAULT_ID, files(1))).resolves.toBeUndefined()
    await flush()

    expect(fake.counts.delete).toBe(1)
    expect(clearIndexedDbStorage).toHaveBeenCalledTimes(1)
  })

  it('does not open the database for an empty checkout profile map', async () => {
    const fake = installFakeIndexedDB({})
    await loadCache()

    await cache.updateCachedUserInfo(ORG_ID, VAULT_ID, {})

    expect(fake.counts.open).toBe(0)
    expect(fake.counts.get).toBe(0)
  })
})

describe('cache rewrite after a delta', () => {
  it('never rewrites for an empty delta, and throttles small ones', async () => {
    vi.resetModules()
    const cache = await import('./vaultFileCache')
    const now = 1_000_000_000_000
    const minuteMs = 60_000

    expect(cache.shouldRewriteCacheAfterDelta(0, now - 60 * minuteMs, now)).toBe(false)
    // One changed row, cache written a minute ago: skip.
    expect(cache.shouldRewriteCacheAfterDelta(1, now - minuteMs, now)).toBe(false)
    // One changed row, cache an hour old: persist.
    expect(cache.shouldRewriteCacheAfterDelta(1, now - 60 * minuteMs, now)).toBe(true)
    // A real delta is always persisted.
    expect(cache.shouldRewriteCacheAfterDelta(500, now - minuteMs, now)).toBe(true)
  })

  it('does not write the 27k-row entry back for a one-row delta on a fresh cache', async () => {
    vi.resetModules()
    const fake = installFakeIndexedDB({})
    const queries = await import('@/lib/supabase/files/queries')
    const cache = await import('./vaultFileCache')

    await cache.setCachedVaultFiles(ORG_ID, VAULT_ID, files(5))
    await flush()
    const putsAfterSeed = fake.counts.put

    const changed = { ...file('file-1'), version: 2, deleted_at: null, is_deleted: false }
    vi.mocked(queries.getFilesDelta).mockResolvedValue({ files: [changed], error: null })
    vi.mocked(queries.getVaultFilesCount).mockResolvedValue({ count: 5, error: null })

    const result = await cache.getFilesWithCache(ORG_ID, VAULT_ID, vi.fn())
    await flush()

    expect(result.deltaCount).toBe(1)
    expect(result.files?.find((row: CachedServerFile) => row.id === 'file-1')?.version).toBe(2)
    expect(fake.counts.put).toBe(putsAfterSeed)

    delete (globalThis as { indexedDB?: unknown }).indexedDB
  })
})
