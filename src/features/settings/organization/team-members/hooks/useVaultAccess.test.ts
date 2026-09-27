import { describe, expect, it } from 'vitest'

import { getVaultAccessLoadPlan } from './useVaultAccess'

describe('getVaultAccessLoadPlan', () => {
  it('loads user and team access even when the vault catalogue was loaded earlier', () => {
    expect(getVaultAccessLoadPlan('org-1', true, false)).toEqual({
      loadVaults: false,
      loadUserAccess: true,
      loadTeamAccess: true,
    })
  })

  it('loads the catalogue and both access maps for a fresh organization', () => {
    expect(getVaultAccessLoadPlan('org-1', false, false)).toEqual({
      loadVaults: true,
      loadUserAccess: true,
      loadTeamAccess: true,
    })
  })

  it('does not issue requests without an active organization', () => {
    expect(getVaultAccessLoadPlan(null, false, false)).toEqual({
      loadVaults: false,
      loadUserAccess: false,
      loadTeamAccess: false,
    })
  })
})
