/**
 * The open review's detail (`get_review_detail`): header, items with every round's decisions,
 * rounds, reviewers and what the viewer may do. Reloads when a review write bumps
 * `reviewQueueRefreshTick`, which is also what a Realtime notification about a review does.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { getReviewDetail } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewDetail } from '@/types/reviews'

import { describeReviewError } from '../lib/reviewErrors'

export interface ReviewDetailState {
  detail: ReviewDetail | null
  loading: boolean
  error: string | null
  reload: () => Promise<ReviewDetail | null>
}

export function useReviewDetail(reviewId: string | null): ReviewDetailState {
  const refreshTick = usePDMStore((s) => s.reviewQueueRefreshTick)
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async (): Promise<ReviewDetail | null> => {
    if (!reviewId) return null
    const gen = ++generation.current
    setLoading(true)
    try {
      const next = await getReviewDetail(reviewId)
      if (gen !== generation.current) return null
      setDetail(next)
      setError(null)
      return next
    } catch (error) {
      if (gen !== generation.current) return null
      log.warn('[Reviews]', 'Loading the review failed', { error, reviewId })
      setError(describeReviewError(error))
      return null
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [reviewId])

  // A different review: drop the old one at once so its items are never shown under the new header.
  useEffect(() => {
    setDetail(null)
    setError(null)
  }, [reviewId])

  useEffect(() => {
    void load()
  }, [load, refreshTick])

  return { detail, loading, error, reload: load }
}
