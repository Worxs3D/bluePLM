/**
 * The Reviews view's main area with no review open: what waits on the viewer and where their own
 * requests stand, with one button to start ("Start reviewing", Enter) instead of a dead
 * placeholder (review UX audit F16). The same reads as the review pane (`useReviewSummary`).
 */

import { ShieldCheck } from 'lucide-react'

import { Button, EmptyState, ListRow, Page, RowGroup, Section } from '@/components/core/ui'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import { useShortcutLabel, useShortcuts } from '@/lib/keybindings'
import type { ReviewQueueRow } from '@/types/reviews'

import { DueText } from './components/DueText'
import { TONE_CLASS } from './components/QueueRow'
import { useReviewSummary } from './hooks/useReviewSummary'
import {
  describeNextMove,
  displayName,
  isViewersMove,
  nextMoveForRow,
  nextMoveTone,
} from './lib/reviewState'
import { tCount } from './lib/plural'

const SHOWN = 5

export function ReviewsOverview() {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const openReview = usePDMStore((s) => s.openReview)
  const setActiveGateReviewId = usePDMStore((s) => s.setActiveGateReviewId)
  const setView = usePDMStore((s) => s.setReviewQueueView)
  const setPaneOpen = usePDMStore((s) => s.setReviewPackagePaneOpen)
  const summary = useReviewSummary(!!userId)
  const nextKey = useShortcutLabel('reviews.nextReview')
  const { awaiting, requested, counts } = summary

  const open = (row: ReviewQueueRow) =>
    row.kind === 'gate' ? setActiveGateReviewId(row.id) : openReview(row.id)
  const first = awaiting[0]
  const firstAction = requested.find((r) =>
    isViewersMove(nextMoveForRow(r, userId, 'requested_by_me')),
  )

  useShortcuts(
    'reviews',
    {
      'reviews.nextReview': () =>
        first ? open(first) : firstAction ? open(firstAction) : undefined,
    },
    { enabled: !!first || !!firstAction, blockedByModal: true },
  )

  const row = (r: ReviewQueueRow, bucket: 'awaiting_me' | 'requested_by_me') => {
    const move = nextMoveForRow(r, userId, bucket)
    const who = displayName(r.requestedBy)
    return (
      <ListRow
        key={`${r.kind}-${r.id}`}
        title={r.kind === 'gate' && r.gate ? displayFileName(r.gate.fileName) : r.title}
        leading={r.kind === 'gate' ? <ShieldCheck size={14} /> : undefined}
        trailing={<DueText dueDate={r.dueDate} overdue={r.overdue} />}
        secondary={
          <span>
            <span className={TONE_CLASS[nextMoveTone(move)]}>{describeNextMove(move)}</span>
            {bucket === 'awaiting_me' && who && <span> · {who}</span>}
          </span>
        }
        onActivate={() => open(r)}
        className="-mx-3"
      />
    )
  }

  const waitingParts = [
    counts.reviews > 0
      ? `${tCount('reviewQueue.overview.files', counts.drawings)} ${tCount('reviewQueue.overview.inReviews', counts.reviews)}`
      : null,
    counts.gates === 1
      ? t('reviewQueue.overview.gateOne')
      : counts.gates > 1
        ? t('reviewQueue.overview.gates', { count: counts.gates })
        : null,
    counts.overdue > 0 ? t('reviewQueue.overview.overdue', { count: counts.overdue }) : null,
  ].filter((p): p is string => !!p)
  const requestParts = [
    counts.needAction > 0 ? tCount('reviewQueue.overview.needAction', counts.needAction) : null,
    counts.waiting > 0
      ? t('reviewQueue.overview.waitingOnReviewers', { count: counts.waiting })
      : null,
  ].filter((p): p is string => !!p)

  return (
    <div className="h-full w-full overflow-y-auto bg-ui-bg font-ui">
      <div
        className="mx-auto max-w-[720px] px-6 pb-12 pt-10"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget && first) open(first)
        }}
      >
        {summary.error && !summary.loaded ? (
          <EmptyState
            title={t('reviewQueue.errorTitle')}
            description={summary.error}
            actions={
              <Button onClick={summary.retry} size="sm">
                {t('reviewQueue.retry')}
              </Button>
            }
          />
        ) : !summary.loaded ? (
          <p className="text-[14px] text-ui-fg-secondary">{t('reviewQueue.loading')}</p>
        ) : (
          <Page>
            <Section
              title={t('reviewQueue.overview.waitingTitle')}
              description={
                waitingParts.length > 0
                  ? waitingParts.join(' · ')
                  : t('reviewQueue.overview.nothingWaiting')
              }
              actions={
                first ? (
                  <Button variant="primary" onClick={() => open(first)}>
                    {t('reviewQueue.overview.start')}
                    {nextKey && (
                      <span className="text-[12px] font-normal opacity-60">{nextKey}</span>
                    )}
                  </Button>
                ) : undefined
              }
            >
              {awaiting.length > 0 && (
                <RowGroup className="mt-2">
                  {awaiting.slice(0, SHOWN).map((r) => row(r, 'awaiting_me'))}
                </RowGroup>
              )}
              {awaiting.length > SHOWN && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2.5 mt-1"
                  onClick={() => setView({ bucket: 'awaiting_me' })}
                >
                  {t('reviewQueue.overview.seeAll')}
                </Button>
              )}
            </Section>

            <Section
              title={t('reviewQueue.overview.requestsTitle')}
              description={
                requestParts.length > 0
                  ? requestParts.join(' · ')
                  : t('reviewQueue.overview.noRequests')
              }
              actions={
                !first && firstAction ? (
                  <Button variant="primary" onClick={() => open(firstAction)}>
                    {t('reviewQueue.overview.openFirst', { title: firstAction.title })}
                  </Button>
                ) : (
                  <Button onClick={() => setPaneOpen(true)}>{t('reviewQueue.startReview')}</Button>
                )
              }
            >
              {requested.length > 0 && (
                <RowGroup className="mt-2">
                  {requested.slice(0, SHOWN).map((r) => row(r, 'requested_by_me'))}
                </RowGroup>
              )}
              {requested.length > SHOWN && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2.5 mt-1"
                  onClick={() => setView({ bucket: 'requested_by_me' })}
                >
                  {t('reviewQueue.overview.seeAll')}
                </Button>
              )}
            </Section>
          </Page>
        )}
      </div>
    </div>
  )
}
