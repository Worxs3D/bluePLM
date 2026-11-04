/**
 * Comment threads on a drawing: their numbers (the pin drawn on the PDF and shown in the list),
 * the Open / Resolved / All filter, which earlier review rounds to show under the current one, and
 * who may resolve a thread. Pure, so the comment sidebar's rules are tested without the pane.
 */

import type { FileAnnotation } from '@/types/database'
import type { ReviewItemDetail } from '@/types/reviews'

export type CommentFilter = 'open' | 'resolved' | 'all'

/** Threads in reading order: page, then top to bottom, then left to right, then oldest first. */
export function sortThreads(threads: readonly FileAnnotation[]): FileAnnotation[] {
  return [...threads].sort((a, b) => {
    const page = (a.page_number ?? 0) - (b.page_number ?? 0)
    if (page !== 0) return page
    const y = (a.position?.y ?? 0) - (b.position?.y ?? 0)
    if (Math.abs(y) > 0.5) return y
    const x = (a.position?.x ?? 0) - (b.position?.x ?? 0)
    if (x !== 0) return x
    return a.created_at.localeCompare(b.created_at)
  })
}

/**
 * Pin numbers, 1-based, in the order the threads were started, over every root thread (open and
 * resolved). A thread keeps its number when the filter changes, when it is resolved and when
 * someone adds a comment above it on the sheet, so "see 3" means the same thread to everyone.
 * Replies have none.
 */
export function numberThreads(threads: readonly FileAnnotation[]): Map<string, number> {
  const numbers = new Map<string, number>()
  ;[...threads]
    .filter((a) => !a.parent_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .forEach((a, index) => numbers.set(a.id, index + 1))
  return numbers
}

export function filterThreads(
  threads: readonly FileAnnotation[],
  filter: CommentFilter,
): FileAnnotation[] {
  const roots = threads.filter((a) => !a.parent_id)
  const kept =
    filter === 'all'
      ? roots
      : roots.filter((a) => (filter === 'resolved' ? a.resolved : !a.resolved))
  return sortThreads(kept)
}

export function threadCounts(threads: readonly FileAnnotation[]): {
  open: number
  resolved: number
} {
  let open = 0
  let resolved = 0
  for (const a of threads) {
    if (a.parent_id) continue
    if (a.resolved) resolved++
    else open++
  }
  return { open, resolved }
}

export interface EarlierRound {
  round: number
  /** The version that round reviewed: its comments were made on that version's PDF. */
  version: number | null
}

/**
 * The item's rounds before `shownRound`, newest first, for the "From round N" groups (F4). A round
 * the item was carried forward through has no comments of its own and is left out.
 */
export function earlierRounds(item: ReviewItemDetail, shownRound: number): EarlierRound[] {
  return item.rounds
    .filter((r) => r.roundNumber < shownRound && !r.carriedForward)
    .sort((a, b) => b.roundNumber - a.roundNumber)
    .map((r) => ({ round: r.roundNumber, version: r.version }))
}

export interface ResolveContext {
  userId: string | null
  /**
   * The database lets the people below resolve others' comments (schema 512,
   * `file_comment_set_resolved`). Without it only a comment's author can, so Resolve is offered on
   * the viewer's own comments only and never fails.
   */
  sharedResolve: boolean
  /** The comment belongs to a review the viewer requested or reviews. */
  reviewParticipant: boolean
  isAdmin: boolean
  /** Outside a review: the viewer may edit files in the vault (`module:explorer edit`). */
  canEditFiles: boolean
  inReview: boolean
}

/**
 * Whether Resolve / Reopen is offered on a thread, mirroring `file_comment_set_resolved` (512):
 * the author and an admin always; in a review, its requester and reviewers; outside one, explorer
 * edit. A review comment seen outside its review (the file's own comments) is resolved by its
 * author or an admin only: the viewer's review roles are not known there, and explorer edit does
 * not cover review comments.
 */
export function canResolveThread(thread: FileAnnotation, ctx: ResolveContext): boolean {
  if (!ctx.userId) return false
  if (thread.user_id === ctx.userId) return true
  if (!ctx.sharedResolve) return false
  if (ctx.isAdmin) return true
  if (ctx.inReview) return ctx.reviewParticipant
  return !thread.review_id && ctx.canEditFiles
}
