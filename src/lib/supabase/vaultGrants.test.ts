/**
 * `getVaultGrants` against the typed fake Supabase: it reads only the asked vaults' grants, and
 * pages, so a large organization is never cut off at the server's row cap.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeSupabase } from '@/test/fakeSupabase'
import { setActiveFakeSupabase } from '@/test/supabaseClientMock'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const { getVaultGrants, VAULT_GRANT_PAGE_SIZE } = await import('./vaults')

let db: FakeSupabase

beforeEach(() => {
  db = new FakeSupabase()
  setActiveFakeSupabase(db)
  const org = db.seed('organization', { name: 'Example', slug: 'example' })
  for (const id of ['v1', 'v2', 'v3']) db.seed('vault', { id, org_id: org.id, name: id, slug: id })
  db.seed('team', { id: 't1', org_id: org.id, name: 'Design' })
})

describe('getVaultGrants', () => {
  it('reads direct and team grants of the asked vaults only', async () => {
    db.seed('vault_access', { vault_id: 'v1', user_id: 'ann' })
    db.seed('vault_access', { vault_id: 'v2', user_id: 'bob' })
    db.seed('vault_access', { vault_id: 'v3', user_id: 'cat' })
    db.seed('team_vault_access', { vault_id: 'v1', team_id: 't1' })
    db.seed('team_vault_access', { vault_id: 'v3', team_id: 't1' })

    const grants = await getVaultGrants(['v1', 'v2', 'v1'])
    expect(grants.error).toBeUndefined()
    expect(grants.users).toEqual({ v1: ['ann'], v2: ['bob'] })
    expect(grants.teams).toEqual({ v1: ['t1'] })
  })

  it('reads past the server row cap, page by page', async () => {
    const count = VAULT_GRANT_PAGE_SIZE + 5
    for (let i = 0; i < count; i++) db.seed('vault_access', { vault_id: 'v1', user_id: `user-${i}` })
    const grants = await getVaultGrants(['v1'])
    expect(grants.users.v1).toHaveLength(count)
    expect(new Set(grants.users.v1).size).toBe(count)
  })

  it('asks nothing for no vaults', async () => {
    await expect(getVaultGrants([])).resolves.toEqual({ users: {}, teams: {} })
  })
})
