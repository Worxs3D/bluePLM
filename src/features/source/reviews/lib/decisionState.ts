/**
 * What the decision bar shows for the current item: the buttons, or one line saying why not
 * (review UX audit F14). Before this the buttons were only greyed out, with no reason.
 *
 * Pure: derived from the item's current-round decisions and the viewer context the server sent.
 */

import { t } from '@/lib/i18n'
import type { ReviewDecision, ReviewDetail, ReviewItemDetail, ReviewUser } from '@/types/reviews'

import { shortDate } from './reviewDates'
import { displayName, isReviewOpen } from './reviewState'

export type DecisionBarState =
  | { kind: 'decide' }
  /** Queued in the undo window or in flight. */
  | { kind: 'sending'; decision: ReviewDecision }
  | { kind: 'decided_by_me'; decision: ReviewDecision; at: string }
  /** Mode `any`: someone else's decision stands for this item. */
  | { kind: 'decided_by_other'; name: string | null; decision: ReviewDecision; at: string }
  /** Approved in an earlier round and not reviewed again. */
  | { kind: 'carried_forward'; round: number | null }
  /** A reviewer of the review who does not owe this item (another reviewer's item in `all` mode). */
  | { kind: 'not_owed' }
  | { kind: 'not_reviewer' }
  | { kind: 'closed' }

export function decisionBarState(
  detail: ReviewDetail,
  item: ReviewItemDetail,
  pending: { decision: ReviewDecision } | null,
): DecisionBarState {
  if (pending) return { kind: 'sending', decision: pending.decision }
  if (!isReviewOpen(detail.review.status)) return { kind: 'closed' }
  if (detail.me.canRespond && detail.me.owedItemIds.includes(item.id)) return { kind: 'decide' }

  const current = item.rounds.find((r) => r.roundNumber === detail.review.currentRound)
  // Carried forward: marked so in this round, or approved earlier with no entry in this round.
  if (
    current?.carriedForward ||
    (!current && item.outcome === 'approved' && detail.review.currentRound > 1)
  ) {
    const approvedIn = [...item.rounds]
      .filter((r) => r.roundNumber < detail.review.currentRound && r.outcome === 'approved')
      .sort((a, b) => b.roundNumber - a.roundNumber)[0]
    return { kind: 'carried_forward', round: approvedIn?.roundNumber ?? null }
  }

  const decisions = current?.decisions ?? []
  const mine = decisions.find((d) => d.reviewerId === detail.me.userId)
  if (mine) return { kind: 'decided_by_me', decision: mine.decision, at: mine.decidedAt }

  if (detail.review.mode === 'any' && decisions.length > 0) {
    const first = [...decisions].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))[0]
    const user = detail.reviewers.find((r) => r.user?.id === first.reviewerId)?.user ?? null
    return {
      kind: 'decided_by_other',
      name: displayName(user),
      decision: first.decision,
      at: first.decidedAt,
    }
  }

  if (!detail.me.isReviewer) return { kind: 'not_reviewer' }
  return { kind: 'not_owed' }
}

/** The line shown in place of the buttons. Null when the buttons show. */
export function describeDecisionBarState(state: DecisionBarState): string | null {
  switch (state.kind) {
    case 'decide':
      return null
    case 'sending':
      return t('reviewDetail.bar.sending', { decision: t(`reviewDetail.sent.${state.decision}`) })
    case 'decided_by_me':
      return t('reviewDetail.bar.decidedByMe', {
        decision: t(`reviewDetail.decided.${state.decision}`),
        date: shortDate(state.at),
      })
    case 'decided_by_other':
      return t('reviewDetail.bar.decidedByOther', {
        name: state.name ?? t('reviewDetail.unknownUser'),
        decision: t(`reviewDetail.decided.${state.decision}`),
      })
    case 'carried_forward':
      return state.round
        ? t('reviewDetail.bar.carriedForward', { round: state.round })
        : t('reviewDetail.bar.carriedForwardPlain')
    case 'not_owed':
      return t('reviewDetail.bar.notOwed')
    case 'not_reviewer':
      return t('reviewDetail.bar.notReviewer')
    case 'closed':
      return t('reviewDetail.bar.closed')
  }
}

/** Every user the detail names (reviewers and requester), by id. */
export function reviewUsersById(detail: ReviewDetail): Map<string, ReviewUser> {
  const map = new Map<string, ReviewUser>()
  for (const r of detail.reviewers) if (r.user) map.set(r.user.id, r.user)
  if (detail.review.requestedBy) map.set(detail.review.requestedBy.id, detail.review.requestedBy)
  if (detail.review.cancelledBy) map.set(detail.review.cancelledBy.id, detail.review.cancelledBy)
  return map
}

/**
 * The comment a "Request changes" or "Reject" starts with when the reviewer already left comments
 * on the drawing this round (F19): it satisfies the server's comment rule and points at them.
 */
export function prefilledDecisionComment(decision: ReviewDecision, myOpenComments: number): string {
  if (myOpenComments <= 0) return ''
  if (
    decision !== 'changes_requested' &&
    decision !== 'rejected' &&
    decision !== 'approved_with_comments'
  ) {
    return ''
  }
  return myOpenComments === 1
    ? t('reviewDetail.decision.seeCommentOne')
    : t('reviewDetail.decision.seeComments', { count: myOpenComments })
}
