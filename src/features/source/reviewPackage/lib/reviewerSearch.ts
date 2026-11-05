/**
 * The reviewer search's results: people and teams in one list, people first, filtered by one
 * query. Pure, so the order and matching are tested without the picker.
 */

import { resolveTeamReviewers, type TeamWithMembers } from '@/lib/supabase/reviewTeams'
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

/** Who may read which vault, as the reviewer directory loaded it. */
export interface VaultGrants {
  /** vault id -> user ids granted directly (`vault_access`). */
  users: Readonly<Record<string, readonly string[]>>
  /** vault id -> team ids granted (`team_vault_access`). */
  teams: Readonly<Record<string, readonly string[]>>
  /** Organization admins (`users.role = 'admin'` or the Administrators team): every vault. */
  adminIds: ReadonlySet<string>
}

/**
 * The people of `userIds` who cannot read every one of `vaultIds`, by the server's rule
 * (`can_user_access_vault`): an admin reads every vault, anyone else needs a grant to that vault,
 * directly or through a team they belong to. A file with no vault restricts nobody. The server
 * refuses a review naming such a person (`REVIEWER_NO_VAULT_ACCESS`) and skips them in a team.
 */
export function usersWithoutVaultAccess(
  userIds: readonly string[],
  vaultIds: readonly (string | null)[],
  grants: VaultGrants,
  teams: readonly TeamWithMembers[],
): Set<string> {
  const vaults = [...new Set(vaultIds.filter((v): v is string => !!v))]
  const blocked = new Set<string>()
  if (vaults.length === 0) return blocked
  const teamsOf = new Map<string, Set<string>>()
  for (const team of teams) {
    for (const m of team.members) {
      const set = teamsOf.get(m.id) ?? new Set<string>()
      set.add(team.id)
      teamsOf.set(m.id, set)
    }
  }
  for (const userId of userIds) {
    if (grants.adminIds.has(userId)) continue
    const own = teamsOf.get(userId)
    const sees = (vaultId: string) =>
      (grants.users[vaultId] ?? []).includes(userId) ||
      (grants.teams[vaultId] ?? []).some((teamId) => own?.has(teamId) === true)
    if (!vaults.every(sees)) blocked.add(userId)
  }
  return blocked
}

/** How many people a team would add who will be skipped for want of vault access. */
export function teamMembersWithoutAccess(
  team: TeamWithMembers,
  blocked: ReadonlySet<string>,
  requesterId: string | null,
): number {
  return resolveTeamReviewers(team).filter((id) => id !== requesterId && blocked.has(id)).length
}
