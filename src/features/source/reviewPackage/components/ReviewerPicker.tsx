/**
 * Pick reviewers: one search field for people and teams together. A team is sent as a team and
 * expanded on the server by its reviewer rules; the picker only previews who that reaches, so
 * selecting a team can never drop members the way the old file-list modal did (audit C4).
 *
 * Keys in the field: Up/Down move through the results, Enter adds or removes the highlighted one,
 * Escape closes the results, Backspace in an empty field removes the last reviewer.
 */

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Search, User, Users, X } from 'lucide-react'

import { Button, IconButton, ListRow, RowGroup, StatusText, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { expandReviewerSelection, type TeamWithMembers } from '@/lib/supabase/reviewTeams'
import type { OrgUser } from '@/types/database'

import {
  lastSelected,
  reviewerResults,
  teamMembersWithoutAccess,
  userLabel,
  type ReviewerResult,
} from '../lib/reviewerSearch'

interface ReviewerPickerProps {
  users: OrgUser[]
  teams: TeamWithMembers[]
  loading: boolean
  error: string | null
  onRetry: () => void
  requesterId: string | null
  reviewerIds: string[]
  teamIds: string[]
  onToggleReviewer: (userId: string) => void
  onToggleTeam: (teamId: string) => void
  /**
   * People who cannot read a vault of the draft's files: shown unavailable with the reason, never
   * added (the server refuses a review naming them, and skips them in a team).
   */
  noVaultAccessIds?: ReadonlySet<string>
  disabled?: boolean
}

const NONE: ReadonlySet<string> = new Set()

function TeamDot({ color }: { color: string }) {
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

export function ReviewerPicker({
  users,
  teams,
  loading,
  error,
  onRetry,
  requesterId,
  reviewerIds,
  teamIds,
  onToggleReviewer,
  onToggleTeam,
  noVaultAccessIds = NONE,
  disabled = false,
}: ReviewerPickerProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const expanded = useMemo(
    () => expandReviewerSelection({ reviewerIds, teamIds }, teams, requesterId),
    [reviewerIds, teamIds, teams, requesterId],
  )
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const teamById = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams])
  const results = useMemo(
    () => reviewerResults(users, teams, query, requesterId),
    [users, teams, query, requesterId],
  )
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0))

  const isSelected = (r: ReviewerResult) =>
    r.kind === 'user' ? reviewerIds.includes(r.id) : teamIds.includes(r.id)
  /** Cannot be added (removing an already added one stays possible). */
  const isUnavailable = (r: ReviewerResult) =>
    r.kind === 'user' && noVaultAccessIds.has(r.id) && !isSelected(r)
  const toggle = (r: ReviewerResult) => {
    if (isUnavailable(r)) return
    // Adding from a search is done with that search: the next name starts from an empty field.
    if (query && !isSelected(r)) {
      setQuery('')
      setActive(0)
    }
    if (r.kind === 'user') onToggleReviewer(r.id)
    else onToggleTeam(r.id)
  }

  const teamReach = (team: TeamWithMembers) => {
    const count = expandReviewerSelection({ reviewerIds: [], teamIds: [team.id] }, teams, requesterId)
      .userIds.length
    const reach =
      team.reviewerConfigs.length > 0
        ? t('reviewBuilder.reviewers.teamRuleCount', { count })
        : count === 1
          ? t('reviewBuilder.reviewers.teamMemberCountOne')
          : t('reviewBuilder.reviewers.teamMemberCount', { count })
    const skipped = teamMembersWithoutAccess(team, noVaultAccessIds, requesterId)
    return skipped > 0
      ? `${reach} · ${t('reviewBuilder.reviewers.teamNoVaultAccess', { count: skipped })}`
      : reach
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const r = results[activeIndex]
      if (open && r) {
        e.preventDefault()
        toggle(r)
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    } else if (e.key === 'Backspace' && query === '') {
      const last = lastSelected(reviewerIds, teamIds)
      if (last) {
        e.preventDefault()
        if (last.kind === 'user') onToggleReviewer(last.id)
        else onToggleTeam(last.id)
      }
    }
  }

  const hasSelection = reviewerIds.length > 0 || teamIds.length > 0
  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <div
      ref={wrapRef}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      {error && (
        <div className="flex items-center justify-between gap-3 py-2">
          <StatusText tone="danger">{t('reviewBuilder.reviewers.loadFailed')}</StatusText>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {t('reviewBuilder.reviewers.retry')}
          </Button>
        </div>
      )}

      <div className="relative pt-2">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-[calc(50%+4px)] -translate-y-1/2 text-ui-fg-secondary"
        />
        <TextInput
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results.length > 0 ? optionId(activeIndex) : undefined}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('reviewBuilder.reviewers.search')}
          spellCheck={false}
          autoComplete="off"
          className="pl-8"
        />
      </div>

      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('reviewBuilder.reviewers.resultsLabel')}
          aria-multiselectable="true"
          className="-mx-1 mt-1 max-h-60 overflow-y-auto rounded-lg border border-ui-border bg-ui-bg py-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading ? (
            <p className="px-3 py-2 text-[13px] text-ui-fg-secondary">{t('reviewBuilder.reviewers.loading')}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-ui-fg-secondary">{t('reviewBuilder.reviewers.none')}</p>
          ) : (
            results.map((r, i) => {
              const selected = isSelected(r)
              const unavailable = isUnavailable(r)
              const firstTeam = r.kind === 'team' && (i === 0 || results[i - 1].kind === 'user')
              return (
                <div key={`${r.kind}-${r.id}`}>
                  {firstTeam && i > 0 && <div className="mx-3 my-1 border-t border-ui-divider" />}
                  <ListRow
                    id={optionId(i)}
                    role="option"
                    shape="rounded"
                    className={`mx-1 py-1.5 ${i === activeIndex ? 'bg-ui-hover' : ''}`}
                    selected={false}
                    disabled={unavailable}
                    onActivate={() => {
                      setActive(i)
                      toggle(r)
                    }}
                    leading={
                      r.kind === 'user' ? <User size={14} /> : <TeamDot color={r.team.color} />
                    }
                    title={r.kind === 'user' ? userLabel(r.user) : r.team.name}
                    secondary={
                      r.kind === 'user'
                        ? noVaultAccessIds.has(r.id)
                          ? t('reviewBuilder.reviewers.noVaultAccess')
                          : r.user.full_name
                            ? r.user.email
                            : undefined
                        : teamReach(r.team)
                    }
                    trailing={
                      selected ? (
                        <span className="flex items-center gap-1 text-ui-fg">
                          <Check size={13} aria-hidden />
                          {t('reviewBuilder.reviewers.added')}
                        </span>
                      ) : undefined
                    }
                  />
                </div>
              )
            })
          )}
        </div>
      )}

      {hasSelection && (
        <RowGroup className="-mx-3 mt-2">
          {teamIds.map((id) => {
            const team = teamById.get(id)
            return (
              <ListRow
                key={`team-${id}`}
                leading={team ? <TeamDot color={team.color} /> : <Users size={14} />}
                title={team?.name ?? t('reviewBuilder.reviewers.unknownTeam')}
                secondary={team ? teamReach(team) : undefined}
                actionsVisible
                actions={
                  disabled ? undefined : (
                    <IconButton
                      size="sm"
                      label={t('reviewBuilder.reviewers.remove', {
                        name: team?.name ?? t('reviewBuilder.reviewers.unknownTeam'),
                      })}
                      icon={<X size={14} />}
                      onClick={() => onToggleTeam(id)}
                    />
                  )
                }
              />
            )
          })}
          {reviewerIds.map((id) => {
            const user = userById.get(id)
            const name = user ? userLabel(user) : t('reviewBuilder.reviewers.unknownUser')
            const noAccess = noVaultAccessIds.has(id)
            return (
              <ListRow
                key={`user-${id}`}
                leading={<User size={14} />}
                title={name}
                secondary={
                  noAccess ? (
                    <StatusText tone="warning">
                      {t('reviewBuilder.reviewers.noVaultAccessAdded')}
                    </StatusText>
                  ) : user?.full_name ? (
                    user.email
                  ) : undefined
                }
                actionsVisible
                actions={
                  disabled ? undefined : (
                    <IconButton
                      size="sm"
                      label={t('reviewBuilder.reviewers.remove', { name })}
                      icon={<X size={14} />}
                      onClick={() => onToggleReviewer(id)}
                    />
                  )
                }
              />
            )
          })}
        </RowGroup>
      )}

      {expanded.emptyTeamIds.length > 0 && (
        <div className="pt-1">
          <StatusText tone="warning">
            {t('reviewBuilder.reviewers.emptyTeams', {
              names: expanded.emptyTeamIds.map((id) => teamById.get(id)?.name ?? id).join(', '),
            })}
          </StatusText>
        </div>
      )}
    </div>
  )
}
