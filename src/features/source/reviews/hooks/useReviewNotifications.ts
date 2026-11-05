/**
 * Live review notifications for the signed-in user. The review RPCs insert a `notifications` row
 * in the same transaction as each request, decision, round, completion or cancellation, and a
 * review comment inserts one for its requester and reviewers (schema 514, at most one per review per
 * hour each; Open goes to the comment's file); this
 * subscribes to the user's own rows, toasts review ones with an "Open" button that opens the
 * review (review UX audit F25), and bumps `reviewQueueRefreshTick` so the queue, the open review
 * and the badge reload at once instead of on the next poll.
 *
 * A burst (a bulk approval, a big resubmit) is coalesced: more than three in a short window become
 * one "4 review updates" toast with "Open reviews".
 *
 * Mounted once, from the activity bar's badge hook, for as long as the user is signed in.
 */

import { useEffect } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { subscribeToNotifications } from '@/lib/realtime'
import { usePDMStore } from '@/stores/pdmStore'

import {
  coalesceNotifications,
  isReviewNotification,
  reviewNotificationTarget,
  reviewToastType,
  type ReviewToastRow,
} from '../lib/notifications'

/** Wait this long after the last notification before toasting, to catch a burst. */
const BURST_QUIET_MS = 1200
/** ...but never longer than this after the first. */
const BURST_MAX_MS = 5000

export function useReviewNotifications(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return
    let unsubscribe: (() => void) | null = null
    let buffer: ReviewToastRow[] = []
    let quiet: ReturnType<typeof setTimeout> | null = null
    let firstAt = 0

    const flush = () => {
      quiet = null
      const rows = buffer
      buffer = []
      const { addToast, openReview, setActiveView } = usePDMStore.getState()
      const plan = coalesceNotifications(rows)
      if (plan.kind === 'summary') {
        addToast('info', t('reviewQueue.notification.many', { count: plan.count }), undefined, {
          label: t('reviewQueue.notification.openReviews'),
          onClick: () => setActiveView('reviews'),
        })
        return
      }
      for (const row of plan.rows) {
        const text = row.message ? `${row.title}: ${row.message}` : row.title
        const target = reviewNotificationTarget(row)
        addToast(
          reviewToastType(row.type),
          text || t('reviewQueue.notification.fallback'),
          undefined,
          target
            ? {
                label: t('reviewQueue.notification.open'),
                // A comment opens on its file; the comment list focuses its thread once loaded.
                onClick: () => openReview(target.reviewId, target.itemId, target.commentId),
              }
            : undefined,
        )
      }
    }

    try {
      unsubscribe = subscribeToNotifications(userId, (row) => {
        if (!isReviewNotification(row)) return
        usePDMStore.getState().requestReviewQueueRefresh()
        const now = Date.now()
        if (buffer.length === 0) firstAt = now
        buffer.push(row)
        if (quiet) clearTimeout(quiet)
        quiet = setTimeout(
          flush,
          Math.max(0, Math.min(BURST_QUIET_MS, firstAt + BURST_MAX_MS - now)),
        )
      })
    } catch (error) {
      log.warn('[Reviews]', 'Could not subscribe to review notifications', { error })
    }
    return () => {
      if (quiet) clearTimeout(quiet)
      unsubscribe?.()
    }
  }, [userId])
}
