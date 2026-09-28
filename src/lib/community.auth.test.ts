import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCommunityPrincipal, loadCommunityConfig, saveCommunityConfig } from './community'

const storage = new Map<string, string>()

describe('MariaDB session expiry', () => {
  afterEach(() => {
    storage.clear()
    vi.unstubAllGlobals()
  })

  it('removes an invalid access token after an authenticated request returns 401', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'UNAUTHENTICATED', message: 'Session is invalid or expired.' }), {
          status: 401,
        }),
      ),
    )
    saveCommunityConfig({
      version: 1,
      serverUrl: 'https://mdb.example.test',
      accessToken: 'expired-token',
    })

    await expect(getCommunityPrincipal()).rejects.toThrow('Session is invalid or expired.')
    expect(loadCommunityConfig()).toEqual({
      version: 1,
      serverUrl: 'https://mdb.example.test',
    })
  })
})
