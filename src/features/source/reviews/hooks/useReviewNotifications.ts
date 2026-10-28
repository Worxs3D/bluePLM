/**
 * Live review notifications for the signed-in user. The review RPCs insert a `notifications` row
 * in the same transaction as each request, decision, round, completion or cancellation; this
 * subscribes to the user's own rows, toasts review ones, and bumps `reviewQueueRefreshTick` so the
 * queue, the open review and the badge reload at once instead of on the next poll.
 *
 * Mounted once, from the activity bar's badge hook, for as long as the user is signed in.
 */

import { useEffect } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { subscribeToNotifications } from '@/lib/realtime'
import { usePDMStore } from '@/stores/pdmStore'

import { isReviewNotification, reviewToastType } from '../lib/notifications'

export function useReviewNotifications(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = subscribeToNotifications(userId, (row) => {
        if (!isReviewNotification(row)) return
        const { addToast, requestReviewQueueRefresh } = usePDMStore.getState()
        const text = row.message ? `${row.title}: ${row.message}` : row.title
        addToast(reviewToastType(row.type), text || t('reviewQueue.notification.fallback'))
        requestReviewQueueRefresh()
      })
    } catch (error) {
      log.warn('[Reviews]', 'Could not subscribe to review notifications', { error })
    }
    return () => unsubscribe?.()
  }, [userId])
}
