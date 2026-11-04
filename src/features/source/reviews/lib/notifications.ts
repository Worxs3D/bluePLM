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
