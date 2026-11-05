/**
 * Reviews sidebar: the review queue, in the settings-navigation idiom.
 *
 * Search, then the lists (Waiting on me, My requests, My teams with its teams, Done) as nav items
 * with counts, then the rows of the chosen list as a listbox: whose move each review is, due
 * dates, gates beside package reviews. The list, team and search live in the store
 * (`reviewQueueView`), so leaving the Reviews view keeps them. The server filters, sorts (overdue
 * first, then priority, due date, age) and pages; the list keeps its order.
 *
 * Keyboard in the list: Up/Down move, Enter/Space open, X toggles the row's checkbox, Ctrl+A
 * selects all, Escape clears the selection.
 */

import { useOfficialExtensionInstalled } from '@/hooks/useOfficialExtensionInstalled'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { RefreshCw, Search } from 'lucide-react'

import { Button, EmptyState, IconButton, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import { DEFAULT_REVIEW_QUEUE_VIEW } from '@/stores/slices/reviewsSlice'
import type { ReviewQueueBucket, ReviewQueueRow } from '@/types/reviews'

import { BulkActionBar } from './components/BulkActionBar'
import { QueueRow } from './components/QueueRow'
import { useReviewQueue } from './hooks/useReviewQueue'
import { useReviewSummary } from './hooks/useReviewSummary'
import { pruneSelection } from './lib/bulk'

const BUCKETS: ReviewQueueBucket[] = ['awaiting_me', 'requested_by_me', 'my_teams', 'done']

/**
 * The viewer the queue's list, team and search were chosen by. Another user or organization
 * (sign-out, switching organization) starts from the defaults, never with someone else's filter.
 */
let queueViewOwner: string | null = null

function NavItem({
  label,
  count,
  selected,
  indent = false,
  dot,
  onSelect,
}: {
  label: string
  count?: number
  selected: boolean
  indent?: boolean
  dot?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ui-accent/50 ${
        indent ? 'pl-7 text-[13px]' : 'text-[14px]'
      } ${selected ? 'bg-ui-selected font-medium text-ui-fg' : 'text-ui-fg hover:bg-ui-hover'}`}
    >
      {dot && (
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="flex-shrink-0 text-[13px] tabular-nums text-ui-fg-secondary">{count}</span>
      )}
    </button>
  )
}

export function ReviewsDashboard() {
  const user = usePDMStore((s) => s.user)
  const organization = usePDMStore((s) => s.organization)
  const userTeams = usePDMStore((s) => s.userTeams)
  const badge = usePDMStore((s) => s.pendingReviewCount)
  const activeReviewId = usePDMStore((s) => s.activeReviewId)
  const activeGateId = usePDMStore((s) => s.activeGateReviewId)
  const openReview = usePDMStore((s) => s.openReview)
  const setActiveGateReviewId = usePDMStore((s) => s.setActiveGateReviewId)
  const view = usePDMStore((s) => s.reviewQueueView)
  const setView = usePDMStore((s) => s.setReviewQueueView)
  const setReviewPackagePaneOpen = usePDMStore((s) => s.setReviewPackagePaneOpen)

  const { bucket, teamId, search } = view
  const viewer = user && organization ? `${user.id}:${organization.id}` : null
  useEffect(() => {
    if (!viewer) return
    if (queueViewOwner && queueViewOwner !== viewer) setView(DEFAULT_REVIEW_QUEUE_VIEW)
    queueViewOwner = viewer
  }, [viewer, setView])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const queue = useReviewQueue(bucket, bucket === 'my_teams' ? teamId : null, search)
  // Without the Reviews extension the view holds workflow gate approvals only (core).
  const packagesOn = useOfficialExtensionInstalled('blueplm.reviews')
  const queueRows = useMemo(
    () => (packagesOn ? queue.rows : queue.rows.filter((row) => row.kind === 'gate')),
    [packagesOn, queue.rows],
  )
  const summary = useReviewSummary(!!user && !!organization)
  const userId = user?.id ?? null

  const liveSelection = useMemo(() => pruneSelection(selected, queueRows), [selected, queueRows])
  const selectedRows = useMemo(
    () => queueRows.filter((r) => liveSelection.has(r.id)),
    [queueRows, liveSelection],
  )

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const open = useCallback(
    (row: ReviewQueueRow) => {
      if (row.kind === 'gate') setActiveGateReviewId(row.id)
      else openReview(row.id)
    },
    [openReview, setActiveGateReviewId],
  )

  const chooseBucket = (next: ReviewQueueBucket) => {
    setView({ bucket: next })
    setSelected(new Set())
    setFocusIndex(0)
  }

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(queueRows.length - 1, index))
    setFocusIndex(clamped)
    const row = queueRows[clamped]
    if (row)
      listRef.current?.querySelector<HTMLElement>(`[id="queue-row-${row.kind}-${row.id}"]`)?.focus()
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const row = queueRows[focusIndex]
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(focusIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(focusIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(queueRows.length - 1)
    } else if (
      (event.key === 'x' || event.key === 'X') &&
      !event.ctrlKey &&
      !event.metaKey &&
      row
    ) {
      event.preventDefault()
      toggleSelected(row.id)
    } else if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      setSelected(new Set(queueRows.map((r) => r.id)))
    } else if (event.key === 'Escape' && liveSelection.size > 0) {
      event.preventDefault()
      setSelected(new Set())
    }
  }

  if (!user || !organization) {
    return (
      <div className="p-4">
        <EmptyState title={t('reviewQueue.signIn')} />
      </div>
    )
  }

  const counts: Partial<Record<ReviewQueueBucket, number>> = {
    awaiting_me: badge,
    requested_by_me: summary.counts.needAction,
  }

  const emptyState = () => {
    if (search.trim())
      return <EmptyState title={t('reviewQueue.emptySearch', { search: search.trim() })} />
    return (
      <EmptyState
        title={t(`reviewQueue.empty.${bucket}`)}
        description={t(`reviewQueue.emptyHint.${bucket}`)}
        actions={
          bucket === 'requested_by_me' && packagesOn ? (
            <Button size="sm" onClick={() => setReviewPackagePaneOpen(true)}>
              {t('reviewQueue.startReview')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ui-nav font-ui">
      <div className="flex-shrink-0 space-y-3 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-fg-secondary"
              aria-hidden
            />
            <TextInput
              type="search"
              value={search}
              onChange={(e) => setView({ search: e.target.value })}
              placeholder={t('reviewQueue.search')}
              aria-label={t('reviewQueue.search')}
              className="bg-ui-search pl-8"
            />
          </div>
          <IconButton
            label={t('reviewQueue.refresh')}
            icon={<RefreshCw size={14} className={queue.loading ? 'animate-spin' : ''} />}
            onClick={queue.refresh}
          />
        </div>

        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('reviewQueue.bucketsLabel')}
          className="space-y-0.5"
        >
          {BUCKETS.map((b) => (
            <div key={b}>
              <NavItem
                label={t(`reviewQueue.bucket.${b}`)}
                count={counts[b]}
                selected={bucket === b && (b !== 'my_teams' || teamId === null)}
                onSelect={() => {
                  chooseBucket(b)
                  if (b === 'my_teams') setView({ teamId: null })
                }}
              />
              {b === 'my_teams' && bucket === 'my_teams' && (userTeams?.length ?? 0) > 0 && (
                <div className="mt-0.5 space-y-0.5">
                  {userTeams?.map((team) => (
                    <NavItem
                      key={team.id}
                      indent
                      dot={team.color}
                      label={team.name}
                      selected={teamId === team.id}
                      onSelect={() => setView({ teamId: teamId === team.id ? null : team.id })}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-ui-border">
        {queue.error ? (
          <div className="p-3">
            <EmptyState
              title={t('reviewQueue.errorTitle')}
              description={queue.error}
              actions={
                <Button size="sm" onClick={queue.refresh}>
                  {t('reviewQueue.retry')}
                </Button>
              }
            />
          </div>
        ) : queue.loading && queueRows.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-ui-fg-secondary">{t('reviewQueue.loading')}</p>
        ) : queueRows.length === 0 ? (
          <div className="p-3">{emptyState()}</div>
        ) : (
          <>
            <div
              ref={listRef}
              role="listbox"
              aria-label={t('reviewQueue.listLabel')}
              aria-multiselectable
              className="divide-y divide-ui-divider"
            >
              {queueRows.map((row, index) => (
                <QueueRow
                  key={`${row.kind}-${row.id}`}
                  row={row}
                  bucket={bucket}
                  userId={userId}
                  optionId={`queue-row-${row.kind}-${row.id}`}
                  focusable={index === Math.min(focusIndex, queueRows.length - 1)}
                  active={row.kind === 'gate' ? row.id === activeGateId : row.id === activeReviewId}
                  checked={liveSelection.has(row.id)}
                  checkboxesVisible={liveSelection.size > 0}
                  onOpen={open}
                  onToggleChecked={toggleSelected}
                  onFocusRow={() => setFocusIndex(index)}
                  onKeyDown={onListKeyDown}
                />
              ))}
            </div>
            {queue.hasMore && (
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  loading={queue.loadingMore}
                  onClick={queue.loadMore}
                >
                  {queue.loadingMore ? t('reviewQueue.loading') : t('reviewQueue.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedRows.length > 0 && (
        <BulkActionBar selectedRows={selectedRows} onClear={() => setSelected(new Set())} />
      )}
    </div>
  )
}
