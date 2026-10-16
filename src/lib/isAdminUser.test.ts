import { describe, expect, it } from 'vitest'

import { ADMINISTRATORS_TEAM_NAME, isAdminUser, isInAdministratorsTeam } from './isAdminUser'

describe('isAdminUser', () => {
  it('is true for the admin role with no teams', () => {
    expect(isAdminUser('admin', null)).toBe(true)
    expect(isAdminUser('admin', [])).toBe(true)
  })

  it('is true for a non-admin role when the user is in the Administrators team', () => {
    expect(isAdminUser('engineer', [{ name: ADMINISTRATORS_TEAM_NAME }])).toBe(true)
    expect(isAdminUser('viewer', [{ name: 'Engineers' }, { name: ADMINISTRATORS_TEAM_NAME }])).toBe(
      true,
    )
  })

  it('is false for a non-admin role with no admin team', () => {
    expect(isAdminUser('engineer', [{ name: 'Engineers' }])).toBe(false)
    expect(isAdminUser('viewer', null)).toBe(false)
    expect(isAdminUser(undefined, undefined)).toBe(false)
  })

  it('matches the team name exactly, as is_org_admin() does', () => {
    expect(isAdminUser('engineer', [{ name: 'administrators' }])).toBe(false)
    expect(isAdminUser('engineer', [{ name: 'Administrators Assistants' }])).toBe(false)
  })
})

describe('isInAdministratorsTeam', () => {
  it('handles a team list that has not loaded', () => {
    expect(isInAdministratorsTeam(null)).toBe(false)
    expect(isInAdministratorsTeam(undefined)).toBe(false)
  })
})
