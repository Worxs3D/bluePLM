import { describe, expect, it, vi } from 'vitest'

import { lazyLoader } from './lazy'

describe('lazyLoader', () => {
  it('loads once and caches success', async () => {
    const load = vi.fn(async () => 42)
    const get = lazyLoader(load)
    expect(await get()).toBe(42)
    expect(await get()).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed load so the next call retries', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('chunk missing')).mockResolvedValue('ok')
    const get = lazyLoader(load)
    await expect(get()).rejects.toThrow('chunk missing')
    expect(await get()).toBe('ok')
    expect(await get()).toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight load between concurrent callers', async () => {
    const load = vi.fn(async () => 'x')
    const get = lazyLoader(load)
    await Promise.all([get(), get(), get()])
    expect(load).toHaveBeenCalledTimes(1)
  })
})
