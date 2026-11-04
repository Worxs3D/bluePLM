/**
 * The open review's header: back, the title, one line saying whose move it is and the review's
 * facts (requester, when, due, round, who decides, priority), and the reviewers of this round, each
 * with their status in words (never colour alone; review UX audit F14). The pane passes the one
 * primary action for the viewer's next move and the overflow menu.
 */

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { IconButton, MetaLine } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { ReviewDetail } from '@/types/reviews'

import { TONE_CLASS } from '../components/QueueRow'
import { dueChip, formatDateOnly, localDateString } from '../lib/queueChips'
import { intlLocale, relativeTime } from '../lib/reviewDates'
import {
  describeNextMove,
  displayName,
  isReviewOpen,
  nextMoveTone,
  type ReviewNextMove,
} from '../lib/reviewState'

interface ReviewHeaderProps {
  detail: ReviewDetail
  move: ReviewNextMove
  onBack: () => void
  /** The primary action for the viewer's next move, and the overflow menu. */
  actions?: ReactNode
}

const STATUS_TONE: Record<string, string> = {
  pending: 'text-ui-fg-secondary',
  approved: 'text-ui-success',
  changes_requested: 'text-ui-warning',
  rejected: 'text-ui-danger',
  cancelled: 'text-ui-fg-tertiary',
}

export function ReviewHeader({ detail, move, onBack, actions }: ReviewHeaderProps) {
  const { review, reviewers } = detail
  const open = isReviewOpen(review.status)
  const requester = displayName(review.requestedBy)
  const current = reviewers.filter((r) => r.roundNumber === review.currentRound)
  const due = open ? dueChip(review.dueDate, localDateString(), review.overdue) : null
  const dueText = review.dueDate
    ? due?.tone === 'overdue'
      ? t('reviewDetail.meta.overdue', { date: formatDateOnly(review.dueDate, intlLocale()) })
      : t('reviewDetail.meta.due', { date: formatDateOnly(review.dueDate, intlLocale()) })
    : null

  const facts = [
    requester
      ? t('reviewDetail.meta.requestedBy', {
          name: requester,
          time: relativeTime(review.requestedAt),
        })
      : null,
    dueText ? { text: dueText, danger: due?.tone === 'overdue' } : null,
    review.currentRound > 1 ? t('reviewDetail.meta.round', { round: review.currentRound }) : null,
    t(`reviewDetail.mode.${review.mode}`),
    open && review.priority !== 'normal'
      ? t('reviewDetail.meta.priority', { priority: t(`reviewQueue.priority.${review.priority}`) })
      : null,
  ]
    .filter((f): f is string | { text: string; danger: boolean } => !!f)
    .map((f) => (typeof f === 'string' ? { text: f, danger: false } : f))

  return (
    <div className="flex-shrink-0 border-b border-ui-border bg-ui-bg px-4 py-3 font-ui">
      <div className="flex items-start gap-2">
        <IconButton
          label={t('reviewDetail.back')}
          icon={<ArrowLeft size={16} />}
          onClick={onBack}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-[16px] font-semibold leading-7 text-ui-fg"
            title={review.title}
          >
            {review.title}
          </h2>
          <p className="text-[13px] leading-5 text-ui-fg-secondary">
            <MetaLine
              parts={[
                <span key="move" className={`font-medium ${TONE_CLASS[nextMoveTone(move)]}`}>
                  {describeNextMove(move)}
                </span>,
                ...facts.map((f, i) => (
                  <span key={i} className={f.danger ? 'text-ui-danger' : undefined}>
                    {f.text}
                  </span>
                )),
              ]}
            />
          </p>
          {current.length > 0 && (
            <p className="mt-0.5 text-[13px] leading-5">
              <span className="text-ui-fg-tertiary">{t('reviewDetail.reviewers')}: </span>
              <MetaLine
                parts={current.map((r, index) => (
                  <span key={`${r.user?.id ?? 'unknown'}-${index}`}>
                    <span className={r.withdrawnReason ? 'text-ui-fg-tertiary' : 'text-ui-fg'}>
                      {displayName(r.user) ?? t('reviewDetail.unknownUser')}
                    </span>{' '}
                    <span
                      className={r.withdrawnReason ? 'text-ui-fg-tertiary' : STATUS_TONE[r.status]}
                    >
                      {r.withdrawnReason
                        ? t(`reviewDetail.reviewerWithdrawn.${r.withdrawnReason}`)
                        : t(`reviewDetail.reviewerStatus.${r.status}`)}
                    </span>
                  </span>
                ))}
              />
            </p>
          )}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  )
}
