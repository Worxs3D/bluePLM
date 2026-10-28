import { describe, expect, it } from 'vitest'

import { expandReviewerSelection, resolveTeamReviewers, type TeamWithMembers } from './reviewTeams'

function member(id: string, roles: string[] = []) {
  return { id, email: `${id}@x.test`, full_name: id, avatar_url: null, workflow_role_ids: roles }
}

const allMembers: TeamWithMembers = {
  id: 'mfg',
  name: 'Manufacturing',
  color: '#000',
  icon: 'users',
  description: null,
  members: [member('m1'), member('m2'), member('m3'), member('req')],
  reviewerConfigs: [],
}

const ruled: TeamWithMembers = {
  id: 'qa',
  name: 'QA',
  color: '#111',
  icon: 'users',
  description: null,
  members: [member('q1', ['inspector']), member('q2'), member('q3', ['inspector'])],
  reviewerConfigs: [
    { id: 'r1', reviewer_type: 'workflow_role', user_id: null, workflow_role_id: 'inspector' },
    { id: 'r2', reviewer_type: 'user', user_id: 'q2', workflow_role_id: null },
    { id: 'r3', reviewer_type: 'user', user_id: 'not-a-member', workflow_role_id: null },
  ],
}

describe('resolveTeamReviewers', () => {
  it('uses every member when the team has no reviewer rules', () => {
    expect(resolveTeamReviewers(allMembers)).toEqual(['m1', 'm2', 'm3', 'req'])
  })

  it('applies user and workflow-role rules, members only', () => {
    expect(resolveTeamReviewers(ruled).sort()).toEqual(['q1', 'q2', 'q3'])
  })
})

describe('expandReviewerSelection', () => {
  it('keeps every member of a selected team (the old modal kept only the last one)', () => {
    const result = expandReviewerSelection({ reviewerIds: [], teamIds: ['mfg'] }, [allMembers], null)
    expect(result.userIds.sort()).toEqual(['m1', 'm2', 'm3', 'req'])
  })

  it('merges named users and teams once each and leaves out the requester', () => {
    const result = expandReviewerSelection(
      { reviewerIds: ['m1', 'x9', 'req'], teamIds: ['mfg', 'qa'] },
      [allMembers, ruled],
      'req',
    )
    expect(result.userIds.sort()).toEqual(['m1', 'm2', 'm3', 'q1', 'q2', 'q3', 'x9'])
    expect(result.byTeam.mfg.sort()).toEqual(['m1', 'm2', 'm3'])
    expect(result.emptyTeamIds).toEqual([])
  })

  it('reports teams that add nobody and teams that no longer exist', () => {
    const solo: TeamWithMembers = { ...allMembers, id: 'solo', members: [member('req')] }
    const result = expandReviewerSelection({ reviewerIds: [], teamIds: ['solo', 'gone'] }, [solo], 'req')
    expect(result.userIds).toEqual([])
    expect(result.emptyTeamIds).toEqual(['solo'])
    expect(result.unknownTeamIds).toEqual(['gone'])
  })
})
