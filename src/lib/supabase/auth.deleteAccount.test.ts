import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteCommunityAccount, getSupabaseClient } = vi.hoisted(() => ({
  deleteCommunityAccount: vi.fn(),
  getSupabaseClient: vi.fn(),
}))

vi.mock('./client', () => ({
  authLog: vi.fn(),
  getCurrentConfigValues: vi.fn(),
  getSupabaseClient,
  setSessionResolver: vi.fn(),
}))

vi.mock('@/lib/community', () => ({
  communityAccessToken: vi.fn(),
  deleteCommunityAccount,
  getCommunityPrincipal: vi.fn(),
  signInCommunity: vi.fn(),
  signOutCommunity: vi.fn(),
}))

vi.mock('@/lib/backendAdapter', () => ({
  routeBackend: <TMdb, TSupabase>(routes: { mdb: () => TMdb; supabase: () => TSupabase }) =>
    routes.mdb(),
}))

import { deleteCurrentAccount } from './auth'

describe('deleteCurrentAccount in MDB mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses only the MDB account endpoint', async () => {
    deleteCommunityAccount.mockResolvedValue(undefined)

    await expect(deleteCurrentAccount()).resolves.toEqual({ error: null })
    expect(deleteCommunityAccount).toHaveBeenCalledOnce()
    expect(getSupabaseClient).not.toHaveBeenCalled()
  })

  it('normalizes MDB request failures', async () => {
    deleteCommunityAccount.mockRejectedValue('network failure')

    const result = await deleteCurrentAccount()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe('network failure')
  })
})
