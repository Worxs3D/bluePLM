/**
 * Reviews sidebar: the review queue.
 *
 * Buckets come from the server (`list_review_queue`): Awaiting me (the default; package items I
 * owe and workflow gates I may decide), Requested by me, My teams and Done. The server filters,
 * sorts (overdue first, then priority, due date, age) and pages; the list keeps its order. A row
 * opens in the main area; checkboxes drive the bulk actions.
 */

import { useCallback, useMemo, useState } from 'react'
import { Inbox, Loader2, RefreshCw, Search } from 'lucide-react'

import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewQueueBucket } from '@/types/reviews'

import { BulkActionBar } from './components/BulkActionBar'
import { GateQueueRow } from './components/GateQueueRow'
import { QueueRow } from './components/QueueRow'
import { useReviewQueue } from './hooks/useReviewQueue'
import { pruneSelection } from './lib/bulk'
import { localDateString } from './lib/queueChips'

const BUCKETS: ReviewQueueBucket[] = ['awaiting_me', 'requested_by_me', 'my_teams', 'done']

export function ReviewsDashboard() {
  const user = usePDMStore((s) => s.user)
  const organization = usePDMStore((s) => s.organization)
  const userTeams = usePDMStore((s) => s.userTeams)
  const badge = usePDMStore((s) => s.pendingReviewCount)
  const activeReviewId = usePDMStore((s) => s.activeReviewId)
  const setActiveReviewId = usePDMStore((s) => s.setActiveReviewId)

  const [bucket, setBucket] = useState<ReviewQueueBucket>('awaiting_me')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const queue = useReviewQueue(bucket, bucket === 'my_teams' ? teamId : null, search)
  const today = localDateString()

  const liveSelection = useMemo(() => pruneSelection(selected, queue.rows), [selected, queue.rows])
  const selectedRows = useMemo(
    () => queue.rows.filter((r) => liveSelection.has(r.id)),
    [queue.rows, liveSelection],
  )

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const openReview = useCallback((id: string) => setActiveReviewId(id), [setActiveReviewId])

  const chooseBucket = (next: ReviewQueueBucket) => {
    setBucket(next)
    setSelected(new Set())
  }

  if (!user || !organization) {
    return (
      <div className="p-4 text-xs text-plm-fg-muted text-center">{t('reviewQueue.signIn')}</div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Buckets */}
      <div className="px-2 pt-2 pb-1.5 border-b border-plm-border space-y-1.5">
        <div className="grid grid-cols-2 gap-1">
          {BUCKETS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => chooseBucket(b)}
              className={`flex items-center justify-between px-2 py-1 text-[11px] rounded text-left ${
                bucket === b
                  ? 'bg-plm-accent/20 text-plm-accent'
                  : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light'
              }`}
            >
              <span className="truncate">{t(`reviewQueue.bucket.${b}`)}</span>
              {b === 'awaiting_me' && badge > 0 && (
                <span className="ml-1 px-1.5 rounded-full bg-plm-accent text-white text-[10px] tabular-nums">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {bucket === 'my_teams' && userTeams && userTeams.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setTeamId(null)}
              className={`px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap border ${
                teamId === null
                  ? 'bg-plm-accent/20 text-plm-accent border-plm-accent/40'
                  : 'text-plm-fg-muted border-plm-border hover:text-plm-fg'
              }`}
            >
              {t('reviewQueue.allTeams')}
            </button>
            {userTeams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setTeamId(teamId === team.id ? null : team.id)}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap border ${
                  teamId === team.id
                    ? 'bg-plm-accent/20 text-plm-accent border-plm-accent/40'
                    : 'text-plm-fg-muted border-plm-border hover:text-plm-fg'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.color }} />
                {team.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('reviewQueue.search')}
              className="w-full pl-6 pr-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded focus:outline-none focus:border-plm-accent"
            />
          </div>
          <button
            type="button"
            onClick={queue.refresh}
            className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light"
            title={t('reviewQueue.refresh')}
          >
            <RefreshCw size={12} className={queue.loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {queue.error ? (
          <div className="p-4 text-center space-y-2">
            <p className="text-xs text-plm-error">{queue.error}</p>
            <button
              type="button"
              onClick={queue.refresh}
              className="text-xs text-plm-accent hover:underline"
            >
              {t('reviewQueue.retry')}
            </button>
          </div>
        ) : queue.loading && queue.rows.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 size={16} className="animate-spin text-plm-fg-muted" />
          </div>
        ) : queue.rows.length === 0 ? (
          <div className="flex flex-col items-center py-10 px-4 text-center">
            <Inbox size={28} className="text-plm-fg-muted/40 mb-2" />
            <p className="text-xs text-plm-fg-muted">{t(`reviewQueue.empty.${bucket}`)}</p>
          </div>
        ) : (
          <div className="space-y-1.5 p-2">
            {queue.rows.map((row) =>
              row.kind === 'gate' ? (
                <GateQueueRow
                  key={`gate-${row.id}`}
                  row={row}
                  selected={liveSelection.has(row.id)}
                  onToggleSelected={toggleSelected}
                />
              ) : (
                <QueueRow
                  key={row.id}
                  row={row}
                  today={today}
                  active={row.id === activeReviewId}
                  selected={liveSelection.has(row.id)}
                  onOpen={openReview}
                  onToggleSelected={toggleSelected}
                />
              ),
            )}
            {queue.hasMore && (
              <button
                type="button"
                onClick={queue.loadMore}
                disabled={queue.loadingMore}
                className="w-full py-1.5 text-xs text-plm-accent hover:underline disabled:opacity-50"
              >
                {queue.loadingMore ? t('reviewQueue.loading') : t('reviewQueue.loadMore')}
              </button>
            )}
          </div>
        )}
      </div>

      {selectedRows.length > 0 && (
        <BulkActionBar selectedRows={selectedRows} onClear={() => setSelected(new Set())} />
      )}
    </div>
  )
}
