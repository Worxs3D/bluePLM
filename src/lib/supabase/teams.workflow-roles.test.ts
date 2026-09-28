import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBackend, clearBackendProfile } from '../backend'
import { getUserWorkflowRoles } from './teams'

const { getCommunityUserWorkflowRoles } = vi.hoisted(() => ({
  getCommunityUserWorkflowRoles: vi.fn(),
}))

vi.mock('@/lib/community', () => ({
  getCommunityTeams: vi.fn(),
  getCommunityUserTeams: vi.fn(),
  getCommunityUserWorkflowRoles,
  removeCommunityUser: vi.fn(),
}))

vi.mock('./client', () => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('Supabase must not be initialized for MDB workflow-role lookup')
  }),
}))

const storage = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
})

describe('MDB workflow-role hydration', () => {
  beforeEach(() => {
    storage.clear()
    clearBackendProfile()
    getCommunityUserWorkflowRoles.mockReset()
    activateBackend('community')
  })

  it('loads separately assigned workflow roles for the active MDB user', async () => {
    getCommunityUserWorkflowRoles.mockResolvedValue(['workflow-role-1', 'workflow-role-2'])

    await expect(getUserWorkflowRoles('user-1')).resolves.toEqual({
      roleIds: ['workflow-role-1', 'workflow-role-2'],
    })
    expect(getCommunityUserWorkflowRoles).toHaveBeenCalledWith('user-1')
  })

  it('fails closed when the MDB role lookup cannot be loaded', async () => {
    getCommunityUserWorkflowRoles.mockRejectedValue(new Error('backend unavailable'))

    await expect(getUserWorkflowRoles('user-1')).resolves.toEqual({
      roleIds: [],
      error: 'backend unavailable',
    })
  })
})
