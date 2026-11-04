/**
 * The reviewer search's results: people and teams in one list, people first, filtered by one
 * query. Pure, so the order and matching are tested without the picker.
 */

import type { TeamWithMembers } from '@/lib/supabase/reviewTeams'
import type { OrgUser } from '@/types/database'

export type ReviewerResult =
  | { kind: 'user'; id: string; user: OrgUser }
  | { kind: 'team'; id: string; team: TeamWithMembers }

export function userLabel(user: Pick<OrgUser, 'full_name' | 'email'>): string {
  return user.full_name || user.email
}

/** Matching people (never the requester) then matching teams, each alphabetical. */
export function reviewerResults(
  users: readonly OrgUser[],
  teams: readonly TeamWithMembers[],
  query: string,
  requesterId: string | null,
): ReviewerResult[] {
  const q = query.trim().toLowerCase()
  const people = users
    .filter(
      (u) =>
        u.id !== requesterId &&
        (!q || userLabel(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    )
    .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
    .map((user): ReviewerResult => ({ kind: 'user', id: user.id, user }))
  const groups = teams
    .filter((team) => !q || team.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team): ReviewerResult => ({ kind: 'team', id: team.id, team }))
  return [...people, ...groups]
}

/**
 * The selection's last entry as the picker lists it (teams, then people), for Backspace in an
 * empty search field.
 */
export function lastSelected(
  reviewerIds: readonly string[],
  teamIds: readonly string[],
): { kind: 'user' | 'team'; id: string } | null {
  if (reviewerIds.length > 0) return { kind: 'user', id: reviewerIds[reviewerIds.length - 1] }
  if (teamIds.length > 0) return { kind: 'team', id: teamIds[teamIds.length - 1] }
  return null
}
