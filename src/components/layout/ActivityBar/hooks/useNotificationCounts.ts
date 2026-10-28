import { useEffect } from 'react'

import { useReviewNotifications } from '@/features/source/reviews/hooks/useReviewNotifications'
import { log } from '@/lib/logger'
import { getReviewBadgeCount } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'

/** A fallback poll; Realtime notifications and the app's own review writes refresh it at once. */
const BADGE_POLL_MS = 5 * 60_000

/**
 * The Reviews badge: what is awaiting me, package items and workflow gates alike
 * (`get_review_badge_count`). Reloads whenever a review write or a Realtime review notification
 * bumps `reviewQueueRefreshTick`.
 */
export function useNotificationCounts() {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const organizationId = usePDMStore((s) => s.organization?.id ?? null)
  const pendingReviewCount = usePDMStore((s) => s.pendingReviewCount)
  const setPendingReviewCount = usePDMStore((s) => s.setPendingReviewCount)
  const refreshTick = usePDMStore((s) => s.reviewQueueRefreshTick)

  useReviewNotifications(organizationId ? userId : null)

  useEffect(() => {
    if (!userId || !organizationId) return
    let cancelled = false

    const loadCount = async () => {
      try {
        const count = await getReviewBadgeCount()
        if (!cancelled) setPendingReviewCount(count)
      } catch (error) {
        log.warn('[Reviews]', 'Loading the review badge failed', { error })
      }
    }

    void loadCount()
    const interval = setInterval(loadCount, BADGE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [userId, organizationId, refreshTick, setPendingReviewCount])

  return { pendingReviewCount, totalBadge: pendingReviewCount }
}
