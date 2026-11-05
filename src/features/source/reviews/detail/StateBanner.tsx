/**
 * The one state banner under the review header, only for the states that need one: the author's
 * "what to fix" after a kickback, a rejection, approved (and waiting to move, or released),
 * cancelled, and nobody left to decide (review UX audit F5, F23, 2.11). Everything else is said
 * by the header's next-move line.
 */

import type { ReactNode } from 'react'

import { Button, Callout } from '@/components/core/ui'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import type { ReviewDetail } from '@/types/reviews'

import { shortDate } from '../lib/reviewDates'
import { describeWhatToFix, type WhatToFix } from '../lib/reviewProgress'
import { displayName, isReviewOpen, type ReviewNextMove } from '../lib/reviewState'
import { tCount } from '../lib/plural'

interface StateBannerProps {
  detail: ReviewDetail
  move: ReviewNextMove
  fix: WhatToFix
  /** Released pinned versions. */
  released: number
  onResubmit: () => void
  onCancelAgain: () => void
  onMove: (() => void) | null
  moving: boolean
}

/** What reviewers said with their changes-requested decisions this round (up to three). */
function decisionFeedback(
  detail: ReviewDetail,
): { key: string; name: string; file: string; comment: string }[] {
  const out: { key: string; name: string; file: string; comment: string }[] = []
  for (const item of detail.items) {
    const round = item.rounds.find((r) => r.roundNumber === detail.review.currentRound)
    for (const d of round?.decisions ?? []) {
      if ((d.decision !== 'changes_requested' && d.decision !== 'rejected') || !d.comment) continue
      const user = detail.reviewers.find((r) => r.user?.id === d.reviewerId)?.user ?? null
      out.push({
        key: `${item.id}-${d.reviewerId}`,
        name: displayName(user) ?? t('reviewDetail.unknownUser'),
        file: displayFileName(item.file.fileName),
        comment: d.comment,
      })
    }
  }
  return out.slice(0, 3)
}

export function StateBanner({
  detail,
  move,
  fix,
  released,
  onResubmit,
  onCancelAgain,
  onMove,
  moving,
}: StateBannerProps) {
  const { review } = detail
  let tone: 'info' | 'success' | 'warning' | 'error' = 'info'
  let title: ReactNode = null
  let body: ReactNode = null
  let action: ReactNode = null

  switch (move.kind) {
    case 'your_move_changes': {
      tone = 'warning'
      const feedback = decisionFeedback(detail)
      body = (
        <>
          {describeWhatToFix(fix)}
          {feedback.map((f) => (
            <span key={f.key} className="mt-1 block text-ui-fg">
              {t('reviewDetail.banner.feedbackBy', { name: f.name, file: f.file })}{' '}
              <span className="text-ui-fg-secondary">“{f.comment}”</span>
            </span>
          ))}
        </>
      )
      action = (
        <Button variant="primary" size="sm" onClick={onResubmit}>
          {t('reviewDetail.resubmit.button')}
        </Button>
      )
      break
    }
    case 'your_move_rejected':
      tone = 'error'
      title = move.by
        ? t('reviewDetail.banner.rejectedBy', { name: move.by })
        : t('reviewDetail.banner.rejected')
      body = (
        <>
          {fix.rejection?.comment && <span className="text-ui-fg">“{fix.rejection.comment}” </span>}
          {t('reviewDetail.banner.rejectedHint')}
        </>
      )
      action = (
        <Button variant="primary" size="sm" onClick={onResubmit}>
          {t('reviewDetail.resubmit.button')}
        </Button>
      )
      break
    case 'nobody_left': {
      tone = 'warning'
      const gone = detail.reviewers
        .filter((r) => r.roundNumber === review.currentRound && r.withdrawnReason)
        .map(
          (r) =>
            `${displayName(r.user) ?? t('reviewDetail.unknownUser')} ${t(`reviewDetail.reviewerWithdrawn.${r.withdrawnReason}`)}`,
        )
      title = tCount('reviewDetail.banner.nobodyLeft', move.items)
      body = gone.join(' · ')
      if (detail.me.canCancel)
        action = (
          <Button variant="primary" size="sm" onClick={onCancelAgain}>
            {t('reviewDetail.cancel.againButton')}
          </Button>
        )
      break
    }
    case 'ready_to_move':
      tone = 'success'
      title = t('reviewDetail.banner.approved', { date: shortDate(review.completedAt) })
      body = tCount('reviewDetail.banner.waitToMove', move.files, {
        state: move.state ?? t('reviewDetail.unknownState'),
      })
      if (onMove)
        action = (
          <Button variant="primary" size="sm" loading={moving} onClick={onMove}>
            {move.state
              ? t('reviewDetail.workflow.movePackage', { state: move.state })
              : t('reviewDetail.workflow.movePackagePlain', { count: move.files })}
          </Button>
        )
      break
    case 'closed':
      if (move.outcome === 'approved') {
        tone = 'success'
        title = t('reviewDetail.banner.approved', { date: shortDate(review.completedAt) })
        const approvers = detail.reviewers
          .filter((r) => r.roundNumber === review.currentRound && r.status === 'approved')
          .map((r) => displayName(r.user))
          .filter((n): n is string => !!n)
        body =
          released > 0
            ? released >= detail.items.length
              ? t('reviewDetail.banner.releasedAll')
              : t('reviewDetail.banner.released', { count: released, total: detail.items.length })
            : approvers.length > 0
              ? t('reviewDetail.banner.approvedBy', { names: approvers.join(', ') })
              : null
      } else if (move.outcome === 'cancelled') {
        const by = displayName(review.cancelledBy)
        const date = shortDate(review.cancelledAt ?? review.completedAt)
        title = by
          ? t('reviewDetail.banner.cancelledBy', { name: by, date })
          : t('reviewDetail.banner.cancelled', { date })
        body = review.cancelReason
          ? t('reviewDetail.cancel.reason', { reason: review.cancelReason })
          : null
      } else if (move.outcome === 'rejected') {
        tone = 'error'
        title = t('reviewDetail.banner.rejectedClosed', { date: shortDate(review.completedAt) })
        body = fix.rejection?.comment ? `“${fix.rejection.comment}”` : null
      } else return null
      break
    default: {
      // Round 2 and later: what the author says changed, where every reviewer sees it (F2).
      const note = detail.rounds.find((r) => r.roundNumber === review.currentRound)?.note
      if (review.currentRound < 2 || !note || !isReviewOpen(review.status)) return null
      title = t('reviewDetail.banner.roundNote', { round: review.currentRound })
      body = <span className="whitespace-pre-wrap text-ui-fg">{note}</span>
    }
  }

  return (
    <div className="flex-shrink-0 border-b border-ui-border px-4 py-2.5">
      <Callout tone={tone} title={title} action={action}>
        {body}
      </Callout>
    </div>
  )
}
