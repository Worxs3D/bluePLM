/**
 * The people and teams a package can be sent to. Loaded once per organization while the pane is
 * open.
 */

import { useEffect, useState } from 'react'

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

export interface ReviewerDirectory {
  users: OrgUser[]
  teams: TeamWithMembers[]
  loading: boolean
  error: string | null
}

export function useReviewerDirectory(orgId: string | null | undefined): ReviewerDirectory {
  const [directory, setDirectory] = useState<ReviewerDirectory>({
    users: [],
    teams: [],
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
      const users = (usersResult.users as unknown[])
        .map(toOrgUser)
        .filter((u): u is OrgUser => u !== null)
      const error = usersResult.error ?? teamsResult.error ?? null
      if (error) log.warn('[ReviewPackage]', 'Loading reviewers failed', { error })
      setDirectory({ users, teams: teamsResult.teams, loading: false, error })
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  return directory
}
