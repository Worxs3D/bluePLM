import { describe, expect, it } from 'vitest'

import {
  coalesceNotifications,
  isReviewNotification,
  reviewNotificationTarget,
  reviewToastType,
  type ReviewToastRow,
} from './notifications'

const REVIEW = '6a000000-0000-4000-8000-000000000001'
const ITEM = '6b000000-0000-4000-8000-000000000001'
const THREAD = '7a000000-0000-4000-8000-000000000001'

const row = (extra: Partial<ReviewToastRow> = {}): ReviewToastRow => ({
  type: 'review_comment',
  title: 'Sam Rivera commented on PMP-2001.SLDDRW',
  message: 'Bore has no tolerance. H7?',
  entity_type: 'review',
  entity_id: REVIEW,
  action_url: `review/${REVIEW}/item/${ITEM}/comment/${THREAD}`,
  ...extra,
})

describe('review_comment notifications (schema 514)', () => {
  it('are review notifications with an info toast, counted in a burst like any other', () => {
    expect(isReviewNotification(row())).toBe(true)
    expect(reviewToastType('review_comment')).toBe('info')
    expect(coalesceNotifications([row(), row(), row(), row()])).toEqual({ kind: 'summary', count: 4 })
  })

  it('open the review on the comment’s file and thread', () => {
    expect(reviewNotificationTarget(row())).toEqual({ reviewId: REVIEW, itemId: ITEM, commentId: THREAD })
    expect(reviewNotificationTarget(row({ action_url: `review/${REVIEW}/comment/${THREAD}` }))).toEqual({
      reviewId: REVIEW,
      itemId: null,
      commentId: THREAD,
    })
  })

  it('fall back to the review alone on a missing, foreign or malformed target', () => {
    const plain = { reviewId: REVIEW, itemId: null, commentId: null }
    expect(reviewNotificationTarget(row({ action_url: null }))).toEqual(plain)
    expect(reviewNotificationTarget(row({ action_url: undefined }))).toEqual(plain)
    expect(reviewNotificationTarget(row({ action_url: 'https://example.test/x' }))).toEqual(plain)
    // Another review's id in the path is not followed.
    const other = '6a000000-0000-4000-8000-000000000002'
    expect(reviewNotificationTarget(row({ action_url: `review/${other}/item/${ITEM}/comment/${THREAD}` }))).toEqual(plain)
    // Only comment rows carry a target.
    expect(reviewNotificationTarget(row({ type: 'review_decision' }))).toEqual(plain)
  })

  it('open nothing without a review', () => {
    expect(reviewNotificationTarget(row({ entity_type: 'eco' }))).toBeNull()
    expect(reviewNotificationTarget(row({ entity_id: null }))).toBeNull()
  })
})
