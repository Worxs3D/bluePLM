/**
 * Whose move a review is, in one place. Every "who owes what" line in the queue, the review pane's
 * lists, the overview and the detail header comes from `nextMoveForRow` / `nextMoveForDetail` and
 * `describeNextMove`, so the surfaces cannot disagree (review UX audit F14, spec 2.0).
 *
 * Pure: the queue row or detail and the viewer in, a small tagged value out. The server decides
 * again on every write; this only decides what to say and which action to offer first.
 */

import { t } from '@/lib/i18n'
import type {
  ReviewDetail,
  ReviewOutcome,
  ReviewQueueBucket,
  ReviewQueueRow,
  ReviewUser,
} from '@/types/reviews'

import { tCount } from './plural'
import { shortDate } from './reviewDates'
import type { ReviewStageSummary } from './reviewStage'

export type ReviewNextMove =
  /** The viewer owes decisions on `owed` of the review's `total` files. */
  | { kind: 'you_decide'; owed: number; total: number }
  /** A workflow gate waiting on the viewer. */
  | { kind: 'gate'; from: string | null; to: string | null }
  /** Open, and other reviewers still owe decisions. `people` is null when not known (a pre-514 queue row). */
  | { kind: 'waiting_on'; people: number | null; decided: number; total: number }
  /** The viewer requested it and reviewers asked for changes. `items` is null when not known. */
  | { kind: 'your_move_changes'; items: number | null }
  /** The viewer requested it and it was rejected; they can resubmit or cancel. */
  | { kind: 'your_move_rejected'; by: string | null }
  /** Changes were requested and the requester (someone else) has to resubmit. */
  | { kind: 'waiting_on_author'; author: string | null }
  /** Open, files still undecided, and every reviewer who owed them was withdrawn. */
  | { kind: 'nobody_left'; items: number }
  /** Approved, and files wait in a review stage for the viewer to move them. */
  | { kind: 'ready_to_move'; files: number; state: string | null }
  | { kind: 'closed'; outcome: ReviewOutcome; at: string | null }

export type NextMoveTone = 'strong' | 'neutral' | 'warning' | 'danger' | 'success'

const OPEN: ReadonlySet<ReviewOutcome> = new Set<ReviewOutcome>(['open', 'changes_requested'])

export function isReviewOpen(status: ReviewOutcome): boolean {
  return OPEN.has(status)
}

export function displayName(user: ReviewUser | null | undefined): string | null {
  if (!user) return null
  return user.fullName || user.email || null
}

/**
 * The next move for a queue row, seen by `userId`. Queue rows carry counts, not reviewers. A
 * rejected review can still be resubmitted, but the queue cannot tell that from a finished one:
 * in the "My requests" bucket (`bucket`) the requester's rejected row is their move, elsewhere it
 * is history.
 */
export function nextMoveForRow(
  row: ReviewQueueRow,
  userId: string | null,
  bucket?: ReviewQueueBucket,
): ReviewNextMove {
  if (row.kind === 'gate') {
    return {
      kind: 'gate',
      from: row.gate?.fromStateName ?? null,
      to: row.gate?.toStateName ?? null,
    }
  }
  const mine = !!userId && row.requestedBy?.id === userId
  switch (row.status) {
    case 'open': {
      if (row.itemsOwedByMe > 0)
        return { kind: 'you_decide', owed: row.itemsOwedByMe, total: row.itemCount }
      // Schema 514 counts the round's reviewers; the same rule as nextMoveForDetail.
      const undecided = Math.max(0, row.itemCount - row.itemsDecided)
      if (undecided > 0 && row.reviewersOwing === 0 && (row.reviewersWithdrawn ?? 0) > 0) {
        return { kind: 'nobody_left', items: undecided }
      }
      return {
        kind: 'waiting_on',
        people: row.reviewersOwing,
        decided: row.itemsDecided,
        total: row.itemCount,
      }
    }
    case 'changes_requested':
      return mine
        ? { kind: 'your_move_changes', items: null }
        : { kind: 'waiting_on_author', author: displayName(row.requestedBy) }
    case 'rejected':
      if (mine && bucket === 'requested_by_me') return { kind: 'your_move_rejected', by: null }
      return { kind: 'closed', outcome: row.status, at: row.completedAt }
    default:
      return { kind: 'closed', outcome: row.status, at: row.completedAt }
  }
}

/** The next move for the open review, seen by the viewer the detail was read for. */
export function nextMoveForDetail(
  detail: ReviewDetail,
  stage?: ReviewStageSummary | null,
): ReviewNextMove {
  const { review, items, me } = detail
  const total = items.length
  const decided = items.filter((i) => i.outcome !== 'pending').length
  const canMove = me.isRequester || me.isAdmin

  switch (review.status) {
    case 'open': {
      if (me.owedItemIds.length > 0)
        return { kind: 'you_decide', owed: me.owedItemIds.length, total }
      const current = detail.reviewers.filter((r) => r.roundNumber === review.currentRound)
      const stillOwing = current.filter((r) => r.status === 'pending' && !r.withdrawnReason)
      const undecided = items.filter((i) => i.outcome === 'pending').length
      if (undecided > 0 && stillOwing.length === 0 && current.some((r) => r.withdrawnReason)) {
        return { kind: 'nobody_left', items: undecided }
      }
      return { kind: 'waiting_on', people: stillOwing.length, decided, total }
    }
    case 'changes_requested': {
      if (me.isRequester || me.canResubmit) {
        const items = detail.items.filter(
          (i) => i.outcome === 'changes_requested' || i.outcome === 'rejected',
        )
        return { kind: 'your_move_changes', items: items.length }
      }
      return { kind: 'waiting_on_author', author: displayName(review.requestedBy) }
    }
    case 'rejected': {
      if (me.canResubmit) return { kind: 'your_move_rejected', by: firstRejecter(detail) }
      return { kind: 'closed', outcome: 'rejected', at: review.completedAt }
    }
    case 'approved': {
      if (canMove && stage && (stage.packageReady || stage.approvedWaiting > 0)) {
        return {
          kind: 'ready_to_move',
          files: stage.packageReady ? stage.inStage : stage.approvedWaiting,
          state: stage.nextStates.length === 1 ? stage.nextStates[0] : null,
        }
      }
      return { kind: 'closed', outcome: 'approved', at: review.completedAt }
    }
    case 'cancelled':
      return { kind: 'closed', outcome: 'cancelled', at: review.cancelledAt ?? review.completedAt }
  }
}

/** Who rejected first in the current round, for "Rejected by Kim Li". */
function firstRejecter(detail: ReviewDetail): string | null {
  const users = new Map<string, ReviewUser>()
  for (const r of detail.reviewers) if (r.user) users.set(r.user.id, r.user)
  let first: { at: string; id: string } | null = null
  for (const item of detail.items) {
    const round = item.rounds.find((r) => r.roundNumber === detail.review.currentRound)
    for (const d of round?.decisions ?? []) {
      if (d.decision !== 'rejected') continue
      if (!first || d.decidedAt < first.at) first = { at: d.decidedAt, id: d.reviewerId }
    }
  }
  return first ? displayName(users.get(first.id)) : null
}

/** The one line that says whose move it is. */
export function describeNextMove(move: ReviewNextMove): string {
  switch (move.kind) {
    case 'you_decide':
      return t('reviewQueue.move.youDecide', { owed: move.owed, total: move.total })
    case 'gate':
      return move.from && move.to
        ? t('reviewQueue.move.gate', { from: move.from, to: move.to })
        : t('reviewQueue.move.gatePlain')
    case 'waiting_on':
      if (move.people === 1)
        return t('reviewQueue.move.waitingOnOne', { decided: move.decided, total: move.total })
      return move.people
        ? t('reviewQueue.move.waitingOn', {
            people: move.people,
            decided: move.decided,
            total: move.total,
          })
        : t('reviewQueue.move.waitingOnReviewers', { decided: move.decided, total: move.total })
    case 'your_move_changes':
      return move.items
        ? tCount('reviewQueue.move.yourMoveChanges', move.items)
        : t('reviewQueue.move.yourMoveChangesPlain')
    case 'your_move_rejected':
      return move.by
        ? t('reviewQueue.move.yourMoveRejectedBy', { name: move.by })
        : t('reviewQueue.move.yourMoveRejected')
    case 'waiting_on_author':
      return move.author
        ? t('reviewQueue.move.waitingOnAuthor', { name: move.author })
        : t('reviewQueue.move.waitingOnAuthorPlain')
    case 'nobody_left':
      return t('reviewQueue.move.nobodyLeft')
    case 'ready_to_move':
      return move.state
        ? t('reviewQueue.move.readyToMove', { state: move.state })
        : t('reviewQueue.move.readyToMovePlain', { count: move.files })
    case 'closed': {
      const date = shortDate(move.at)
      return date
        ? t(`reviewQueue.closed.${move.outcome}`, { date })
        : t(`reviewQueue.status.${move.outcome}`)
    }
  }
}

/** How loud the line is: the viewer's own moves stand out, a stuck review is red. */
export function nextMoveTone(move: ReviewNextMove): NextMoveTone {
  switch (move.kind) {
    case 'you_decide':
    case 'gate':
      return 'strong'
    case 'your_move_changes':
    case 'your_move_rejected':
    case 'ready_to_move':
      return 'warning'
    case 'nobody_left':
      return 'danger'
    case 'closed':
      return move.outcome === 'approved'
        ? 'success'
        : move.outcome === 'rejected'
          ? 'danger'
          : 'neutral'
    default:
      return 'neutral'
  }
}

/** Whether the move is the viewer's: these sort first in "My requests". */
export function isViewersMove(move: ReviewNextMove): boolean {
  return (
    move.kind === 'you_decide' ||
    move.kind === 'gate' ||
    move.kind === 'your_move_changes' ||
    move.kind === 'your_move_rejected' ||
    move.kind === 'nobody_left' ||
    move.kind === 'ready_to_move'
  )
}

/**
 * The queue row after `currentId` in list order (wrapping), for "Next review". Null when the list
 * has nothing else. A current id not in the list (it was just finished and dropped out) gives the
 * first row.
 */
export function nextRowAfter<T extends { id: string }>(
  rows: readonly T[],
  currentId: string | null,
): T | null {
  const others = rows.filter((r) => r.id !== currentId)
  if (others.length === 0) return null
  const index = currentId ? rows.findIndex((r) => r.id === currentId) : -1
  if (index < 0) return others[0]
  for (let i = 1; i <= rows.length; i++) {
    const row = rows[(index + i) % rows.length]
    if (row.id !== currentId) return row
  }
  return null
}
