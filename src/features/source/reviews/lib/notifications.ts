/**
 * How a review notification row is shown as a toast. Pure, so it is tested without Realtime.
 */

import type { ToastType } from '@/stores/types'

/** Notifications that ask something of the user get a warning-coloured toast. */
const ACTION_TYPES: ReadonlySet<string> = new Set([
  'review_request',
  'review_round',
  'review_kicked_back',
  'review_overdue',
  // A reviewer left the organization or lost vault access (schema 108); with nobody left to
  // decide, the requester has to cancel and request again.
  'review_reviewer_removed',
])

export function reviewToastType(type: string): ToastType {
  if (type === 'review_rejected') return 'error'
  if (type === 'review_approved' || type === 'review_completed') return 'success'
  return ACTION_TYPES.has(type) ? 'warning' : 'info'
}

export function isReviewNotification(row: { entity_type: string | null; type: string }): boolean {
  return row.entity_type === 'review' || row.type.startsWith('review_')
}

/** The fields of a notification row a review toast uses. */
export interface ReviewToastRow {
  type: string
  title: string
  message: string | null
  entity_type: string | null
  entity_id: string | null
  /** Where in the review it happened; set on `review_comment` rows (schema 514). */
  action_url?: string | null
}

/** Where a review notification's Open goes: the review, and for a comment its file and thread. */
export interface ReviewNotificationTarget {
  reviewId: string
  itemId: string | null
  commentId: string | null
}

/**
 * `review/<review>[/item/<review item>]/comment/<thread>`, as trg_file_comment_notify_review() writes
 * it. The ids are only matched against loaded rows, so any slash-free segment is taken.
 */
const COMMENT_URL = /^review\/([^/]+)(?:\/item\/([^/]+))?\/comment\/([^/]+)$/

/**
 * The review a notification opens, or null when it names none. A comment notification also names
 * the review item (the file) and the thread; anything else in `action_url` is ignored, so a row
 * from another writer still opens its review.
 */
export function reviewNotificationTarget(row: ReviewToastRow): ReviewNotificationTarget | null {
  const reviewId = row.entity_type === 'review' ? row.entity_id : null
  if (!reviewId) return null
  const match = row.type === 'review_comment' && row.action_url ? COMMENT_URL.exec(row.action_url) : null
  if (!match || match[1].toLowerCase() !== reviewId.toLowerCase()) {
    return { reviewId, itemId: null, commentId: null }
  }
  return { reviewId, itemId: match[2] ?? null, commentId: match[3] }
}

/** More than this many in one burst become one summary toast. */
export const COALESCE_OVER = 3

/** One toast per row, or one summary for a burst. */
export function coalesceNotifications<T extends ReviewToastRow>(
  rows: readonly T[],
): { kind: 'each'; rows: T[] } | { kind: 'summary'; count: number } {
  return rows.length > COALESCE_OVER
    ? { kind: 'summary', count: rows.length }
    : { kind: 'each', rows: [...rows] }
}
