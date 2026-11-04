import { describe, expect, it } from 'vitest'

import type { TeamWithMembers } from '@/lib/supabase/reviewTeams'
import type { OrgUser } from '@/types/database'

import { lastSelected, reviewerResults } from './reviewerSearch'

const user = (id: string, full_name: string | null, email: string): OrgUser => ({
  id,
  full_name,
  email,
  avatar_url: null,
})
const team = (id: string, name: string): TeamWithMembers => ({
  id,
  name,
  color: '#888',
  icon: 'users',
  description: null,
  members: [],
  reviewerConfigs: [],
})

const users = [user('me', 'Me Myself', 'me@x.io'), user('b', 'Sam Rivera', 'sam@x.io'), user('a', null, 'alex@x.io')]
const teams = [team('t2', 'Quality'), team('t1', 'Mechanical review')]

describe('reviewerResults', () => {
  it('lists people (never the requester) before teams, each alphabetical', () => {
    expect(reviewerResults(users, teams, '', 'me').map((r) => `${r.kind}:${r.id}`)).toEqual([
      'user:a',
      'user:b',
      'team:t1',
      'team:t2',
    ])
  })

  it('matches names, emails and team names, case-insensitively', () => {
    expect(reviewerResults(users, teams, 'SAM', 'me').map((r) => r.id)).toEqual(['b'])
    expect(reviewerResults(users, teams, 'alex@', 'me').map((r) => r.id)).toEqual(['a'])
    expect(reviewerResults(users, teams, 'qual', 'me').map((r) => r.id)).toEqual(['t2'])
  })
})

describe('lastSelected', () => {
  it('takes the last person, then the last team, as the picker lists them', () => {
    expect(lastSelected(['u1', 'u2'], ['t1'])).toEqual({ kind: 'user', id: 'u2' })
    expect(lastSelected([], ['t1', 't2'])).toEqual({ kind: 'team', id: 't2' })
    expect(lastSelected([], [])).toBeNull()
  })
})
