/**
 * Team expansion for the reviewer picker. Pure, so the rule can be tested next to the one
 * `request_review` applies on the server: a team contributes the members its reviewer rules name
 * (a user rule, or every member holding a workflow role), and every member when it has no rules.
 * The requester is never their own reviewer.
 *
 * The picker sends `teamIds` to the server and lets it expand them; this module only previews who
 * that will be. Expanding on the client and sending user ids instead is what lost team members
 * before (audit C4).
 */

export interface TeamMember {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role?: string | null
  workflow_role_ids?: string[]
}

export interface TeamReviewerConfig {
  id: string
  reviewer_type: 'user' | 'workflow_role'
  user_id: string | null
  workflow_role_id: string | null
}

export interface TeamWithMembers {
  id: string
  name: string
  color: string
  icon: string
  description: string | null
  members: TeamMember[]
  reviewerConfigs: TeamReviewerConfig[]
}

/**
 * Resolve a team's reviewer rules into user ids. With no rules, every member reviews.
 */
export function resolveTeamReviewers(team: TeamWithMembers): string[] {
  if (team.reviewerConfigs.length === 0) {
    return team.members.map((m) => m.id)
  }

  const reviewerIds = new Set<string>()
  for (const config of team.reviewerConfigs) {
    if (config.reviewer_type === 'user' && config.user_id) {
      if (team.members.some((m) => m.id === config.user_id)) {
        reviewerIds.add(config.user_id)
      }
    } else if (config.reviewer_type === 'workflow_role' && config.workflow_role_id) {
      for (const member of team.members) {
        if (member.workflow_role_ids?.includes(config.workflow_role_id)) {
          reviewerIds.add(member.id)
        }
      }
    }
  }
  return Array.from(reviewerIds)
}

export interface ReviewerSelection {
  reviewerIds: readonly string[]
  teamIds: readonly string[]
}

export interface ExpandedReviewers {
  /** Everyone who will be asked, once each, without the requester. */
  userIds: string[]
  /** Per selected team, the members it contributes (without the requester). */
  byTeam: Record<string, string[]>
  /** Selected teams that contribute nobody (empty, or only the requester). */
  emptyTeamIds: string[]
  /** Selected teams no longer in the organization's team list. */
  unknownTeamIds: string[]
}

/**
 * Who a selection of users and teams will reach. Named users and team members are merged and
 * de-duplicated; the requester is left out, as the server does.
 */
export function expandReviewerSelection(
  selection: ReviewerSelection,
  teams: readonly TeamWithMembers[],
  requesterId: string | null,
): ExpandedReviewers {
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const users = new Set<string>()
  const byTeam: Record<string, string[]> = {}
  const emptyTeamIds: string[] = []
  const unknownTeamIds: string[] = []

  for (const id of selection.reviewerIds) {
    if (id !== requesterId) users.add(id)
  }
  for (const teamId of selection.teamIds) {
    const team = teamById.get(teamId)
    if (!team) {
      unknownTeamIds.push(teamId)
      continue
    }
    const members = resolveTeamReviewers(team).filter((id) => id !== requesterId)
    byTeam[teamId] = members
    if (members.length === 0) emptyTeamIds.push(teamId)
    for (const id of members) users.add(id)
  }

  return { userIds: Array.from(users), byTeam, emptyTeamIds, unknownTeamIds }
}
