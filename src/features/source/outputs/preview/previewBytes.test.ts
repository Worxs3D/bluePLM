import { beforeEach, describe, expect, it, vi } from 'vitest'

const download = vi.fn<(orgId: string, hash: string) => Promise<Uint8Array>>()
vi.mock('@/lib/supabase/inspectionReports', () => ({
  downloadInspectionContent: (orgId: string, hash: string) => download(orgId, hash),
}))

import { ByteLru, loadPreviewBytes } from './previewBytes'

const bytes = (n: number) => new Uint8Array(n)

describe('ByteLru', () => {
  it('drops the least recently used entry past the entry cap', () => {
    const lru = new ByteLru(2, 1000)
    lru.set('a', bytes(1))
    lru.set('b', bytes(1))
    lru.get('a')
    lru.set('c', bytes(1))
    expect(lru.get('a')).toBeDefined()
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('c')).toBeDefined()
    expect(lru.size).toBe(2)
  })

  it('keeps the byte total under its budget and never caches an item larger than it', () => {
    const lru = new ByteLru(10, 100)
    lru.set('a', bytes(60))
    lru.set('b', bytes(30))
    lru.set('c', bytes(30))
    expect(lru.get('a')).toBeUndefined()
    expect(lru.bytes).toBe(60)
    lru.set('huge', bytes(101))
    expect(lru.get('huge')).toBeUndefined()
    expect(lru.bytes).toBe(60)
    lru.set('b', bytes(10))
    expect(lru.bytes).toBe(40)
    lru.clear()
    expect(lru.size).toBe(0)
    expect(lru.bytes).toBe(0)
  })
})

describe('loadPreviewBytes', () => {
  beforeEach(() => download.mockReset())

  it('shares one download between concurrent requests and serves the cache after', async () => {
    let resolve: (b: Uint8Array) => void = () => {}
    download.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const first = loadPreviewBytes('user', 'org', 'h1')
    const second = loadPreviewBytes('user', 'org', 'h1')
    resolve(bytes(4))
    expect(await first).toBe(await second)
    expect(await loadPreviewBytes('user', 'org', 'h1')).toBe(await first)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('scopes the cache by user and retries after a failure', async () => {
    download.mockResolvedValueOnce(bytes(1))
    await loadPreviewBytes('user-a', 'org', 'h2')
    download.mockRejectedValueOnce(new Error('offline'))
    await expect(loadPreviewBytes('user-b', 'org', 'h2')).rejects.toThrow('offline')
    download.mockResolvedValueOnce(bytes(2))
    expect((await loadPreviewBytes('user-b', 'org', 'h2')).byteLength).toBe(2)
    expect(download).toHaveBeenCalledTimes(3)
  })
})
