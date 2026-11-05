/**
 * The people and teams a package can be sent to, and who of them is an admin (an admin reads every
 * vault; the draft's own vault grants come from `useDraftVaultGrants`). Loaded once per
 * organization while the pane is open.
 */

import { useCallback, useEffect, useState } from 'react'

import { ADMINISTRATORS_TEAM_NAME } from '@/lib/isAdminUser'
import { log } from '@/lib/logger'
import { getOrgUsers } from '@/lib/supabase'
import { getOrgTeamsWithMembers, type TeamWithMembers } from '@/lib/supabase/reviews'
import type { OrgUser } from '@/types/database'

function toOrgUser(raw: unknown): OrgUser | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    email: typeof r.email === 'string' ? r.email : '',
    full_name: typeof r.full_name === 'string' ? r.full_name : null,
    avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
  }
}

/** The one definition of admin: `role = 'admin'` or a member of the Administrators team. */
function adminIdsOf(rawUsers: readonly unknown[], teams: readonly TeamWithMembers[]): Set<string> {
  const ids = new Set<string>()
  for (const raw of rawUsers) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    if (typeof r.id === 'string' && r.role === 'admin') ids.add(r.id)
  }
  for (const team of teams) {
    if (team.name === ADMINISTRATORS_TEAM_NAME) for (const m of team.members) ids.add(m.id)
  }
  return ids
}

export interface ReviewerDirectory {
  users: OrgUser[]
  teams: TeamWithMembers[]
  /** Admins: `role = 'admin'` or the Administrators team. They read every vault. */
  adminIds: ReadonlySet<string>
  loading: boolean
  error: string | null
  /** Read the directory again (after a failure). */
  reload: () => void
}

export function useReviewerDirectory(orgId: string | null | undefined): ReviewerDirectory {
  const [attempt, setAttempt] = useState(0)
  const [directory, setDirectory] = useState<Omit<ReviewerDirectory, 'reload'>>({
    users: [],
    teams: [],
    adminIds: new Set<string>(),
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setDirectory((d) => ({ ...d, loading: true, error: null }))
    void (async () => {
      const [usersResult, teamsResult] = await Promise.all([
        getOrgUsers(orgId),
        getOrgTeamsWithMembers(orgId),
      ])
      if (cancelled) return
      const rawUsers = usersResult.users as unknown[]
      const users = rawUsers.map(toOrgUser).filter((u): u is OrgUser => u !== null)
      const error = usersResult.error ?? teamsResult.error ?? null
      if (error) log.warn('[ReviewPackage]', 'Loading reviewers failed', { error })
      const adminIds = adminIdsOf(rawUsers, teamsResult.teams)
      setDirectory({ users, teams: teamsResult.teams, adminIds, loading: false, error })
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...directory, reload }
}
