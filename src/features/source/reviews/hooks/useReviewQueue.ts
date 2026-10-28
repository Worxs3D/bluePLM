/**
 * One bucket of the review queue, paged from `list_review_queue`. The server filters, sorts
 * (overdue first, then priority, due date, age) and pages; this hook only keeps the pages the user
 * has scrolled through, and starts over when the bucket, team or search changes or when a review
 * write bumps `reviewQueueRefreshTick`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { listReviewQueue } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewQueueBucket, ReviewQueueRow } from '@/types/reviews'

import { describeReviewError } from '../lib/reviewErrors'

export const QUEUE_PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 250

export interface ReviewQueueState {
  rows: ReviewQueueRow[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

export function useReviewQueue(
  bucket: ReviewQueueBucket,
  teamId: string | null,
  search: string,
): ReviewQueueState {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const refreshTick = usePDMStore((s) => s.reviewQueueRefreshTick)
  const [rows, setRows] = useState<ReviewQueueRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [manualTick, setManualTick] = useState(0)
  /** Each load gets a generation; a response from an older one is dropped. */
  const generation = useRef(0)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [search])

  useEffect(() => {
    if (!userId) {
      setRows([])
      setCursor(null)
      return
    }
    const gen = ++generation.current
    setLoading(true)
    setError(null)
    listReviewQueue({
      bucket,
      teamId,
      search: debouncedSearch.trim() || null,
      limit: QUEUE_PAGE_SIZE,
    })
      .then((page) => {
        if (gen !== generation.current) return
        setRows(page.rows)
        setCursor(page.nextCursor)
      })
      .catch((error: unknown) => {
        if (gen !== generation.current) return
        log.warn('[Reviews]', 'Loading the review queue failed', { error, bucket })
        setError(describeReviewError(error))
        setRows([])
        setCursor(null)
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false)
      })
  }, [userId, bucket, teamId, debouncedSearch, refreshTick, manualTick])

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || loading) return
    const gen = generation.current
    setLoadingMore(true)
    listReviewQueue({
      bucket,
      teamId,
      search: debouncedSearch.trim() || null,
      limit: QUEUE_PAGE_SIZE,
      cursor,
    })
      .then((page) => {
        if (gen !== generation.current) return
        setRows((prev) => {
          const seen = new Set(prev.map((r) => `${r.kind}:${r.id}`))
          return [...prev, ...page.rows.filter((r) => !seen.has(`${r.kind}:${r.id}`))]
        })
        setCursor(page.nextCursor)
      })
      .catch((error: unknown) => {
        if (gen !== generation.current) return
        log.warn('[Reviews]', 'Loading more of the review queue failed', { error })
        setError(describeReviewError(error))
      })
      .finally(() => setLoadingMore(false))
  }, [cursor, loadingMore, loading, bucket, teamId, debouncedSearch])

  const refresh = useCallback(() => setManualTick((n) => n + 1), [])

  return { rows, loading, loadingMore, error, hasMore: !!cursor, loadMore, refresh }
}
