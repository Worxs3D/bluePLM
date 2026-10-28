/**
 * Pick reviewers: people and teams. A team is sent as a team and expanded on the server by its
 * reviewer rules; the picker only previews who that reaches, so selecting a team can never drop
 * members the way the old file-list modal did (audit C4).
 */

import { useMemo, useState } from 'react'
import { Search, User, Users, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import { expandReviewerSelection, type TeamWithMembers } from '@/lib/supabase/reviewTeams'
import type { OrgUser } from '@/types/database'

interface ReviewerPickerProps {
  users: OrgUser[]
  teams: TeamWithMembers[]
  loading: boolean
  requesterId: string | null
  reviewerIds: string[]
  teamIds: string[]
  onToggleReviewer: (userId: string) => void
  onToggleTeam: (teamId: string) => void
}

type PickerTab = 'people' | 'teams'

function userLabel(user: Pick<OrgUser, 'full_name' | 'email'>): string {
  return user.full_name || user.email
}

export function ReviewerPicker({
  users,
  teams,
  loading,
  requesterId,
  reviewerIds,
  teamIds,
  onToggleReviewer,
  onToggleTeam,
}: ReviewerPickerProps) {
  const [tab, setTab] = useState<PickerTab>('people')
  const [query, setQuery] = useState('')

  const expanded = useMemo(
    () => expandReviewerSelection({ reviewerIds, teamIds }, teams, requesterId),
    [reviewerIds, teamIds, teams, requesterId],
  )
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const teamById = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams])

  const q = query.trim().toLowerCase()
  const visibleUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.id !== requesterId &&
          (!q || userLabel(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
      ),
    [users, requesterId, q],
  )
  const visibleTeams = useMemo(
    () => teams.filter((tm) => !q || tm.name.toLowerCase().includes(q)),
    [teams, q],
  )

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {(reviewerIds.length > 0 || teamIds.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {teamIds.map((id) => {
            const team = teamById.get(id)
            return (
              <button
                key={`team-${id}`}
                type="button"
                onClick={() => onToggleTeam(id)}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded bg-plm-accent/15 text-plm-accent hover:bg-plm-accent/25"
                title={t('reviewBuilder.reviewers.remove')}
              >
                <Users size={10} />
                {team?.name ?? t('reviewBuilder.reviewers.unknownTeam')}
                <span className="text-plm-fg-muted">({expanded.byTeam[id]?.length ?? 0})</span>
                <X size={10} />
              </button>
            )
          })}
          {reviewerIds.map((id) => {
            const user = userById.get(id)
            return (
              <button
                key={`user-${id}`}
                type="button"
                onClick={() => onToggleReviewer(id)}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded bg-plm-bg-light text-plm-fg hover:bg-plm-highlight border border-plm-border"
                title={t('reviewBuilder.reviewers.remove')}
              >
                <User size={10} />
                {user ? userLabel(user) : t('reviewBuilder.reviewers.unknownUser')}
                <X size={10} />
              </button>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-plm-fg-muted">
        {t('reviewBuilder.reviewers.reaches', { count: expanded.userIds.length })}
      </p>
      {expanded.emptyTeamIds.length > 0 && (
        <p className="text-[11px] text-plm-warning">
          {t('reviewBuilder.reviewers.emptyTeams', {
            names: expanded.emptyTeamIds.map((id) => teamById.get(id)?.name ?? id).join(', '),
          })}
        </p>
      )}

      {/* Tabs + search */}
      <div className="flex items-center gap-1">
        {(['people', 'teams'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-2 py-0.5 text-[11px] rounded ${
              tab === key
                ? 'bg-plm-accent/20 text-plm-accent'
                : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light'
            }`}
          >
            {t(`reviewBuilder.pickerTab.${key}`)}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('reviewBuilder.reviewers.search')}
          className="w-full pl-6 pr-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded focus:outline-none focus:border-plm-accent"
        />
      </div>

      <div className="max-h-48 overflow-y-auto border border-plm-border rounded divide-y divide-plm-border/50">
        {loading ? (
          <p className="px-2 py-3 text-xs text-plm-fg-muted">{t('reviewBuilder.reviewers.loading')}</p>
        ) : tab === 'people' ? (
          visibleUsers.length === 0 ? (
            <p className="px-2 py-3 text-xs text-plm-fg-muted">{t('reviewBuilder.reviewers.none')}</p>
          ) : (
            visibleUsers.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-plm-highlight"
              >
                <input
                  type="checkbox"
                  checked={reviewerIds.includes(u.id)}
                  onChange={() => onToggleReviewer(u.id)}
                  className="w-3 h-3"
                />
                <span className="truncate text-plm-fg">{userLabel(u)}</span>
                {u.full_name && <span className="truncate text-plm-fg-muted">{u.email}</span>}
              </label>
            ))
          )
        ) : visibleTeams.length === 0 ? (
          <p className="px-2 py-3 text-xs text-plm-fg-muted">{t('reviewBuilder.reviewers.noTeams')}</p>
        ) : (
          visibleTeams.map((team) => {
            const reach = expandReviewerSelection({ reviewerIds: [], teamIds: [team.id] }, teams, requesterId)
            return (
              <label
                key={team.id}
                className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-plm-highlight"
              >
                <input
                  type="checkbox"
                  checked={teamIds.includes(team.id)}
                  onChange={() => onToggleTeam(team.id)}
                  className="w-3 h-3"
                />
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: team.color }}
                />
                <span className="truncate text-plm-fg">{team.name}</span>
                <span className="ml-auto text-plm-fg-muted">
                  {team.reviewerConfigs.length > 0
                    ? t('reviewBuilder.reviewers.teamRuleCount', { count: reach.userIds.length })
                    : t('reviewBuilder.reviewers.teamMemberCount', { count: reach.userIds.length })}
                </span>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
