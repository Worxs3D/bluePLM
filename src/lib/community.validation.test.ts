import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMMUNITY_API_VERSION, validateCommunityConfig } from './community'

describe('Community backend compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts the supported MDB API contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            runtime: 'php',
            supabase: false,
            apiVersion: COMMUNITY_API_VERSION,
          }),
          { status: 200 },
        ),
      ),
    )

    await expect(validateCommunityConfig('https://mdb.example.test')).resolves.toEqual({
      valid: true,
    })
  })

  it('rejects an older MDB API before settings pages can call missing endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, runtime: 'php', supabase: false }), {
          status: 200,
        }),
      ),
    )

    await expect(validateCommunityConfig('https://mdb.example.test')).resolves.toEqual({
      valid: false,
      error: `The MariaDB backend is outdated. Install API version ${COMMUNITY_API_VERSION} or newer.`,
    })
  })

  it('rejects a different backend even if it reports an API version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ supabase: true, apiVersion: COMMUNITY_API_VERSION }), {
          status: 200,
        }),
      ),
    )

    await expect(validateCommunityConfig('https://mdb.example.test')).resolves.toEqual({
      valid: false,
      error: 'This is not a BluePLM Community backend.',
    })
  })
})
