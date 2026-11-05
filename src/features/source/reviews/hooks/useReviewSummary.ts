/**
 * The two small queue reads behind the Reviews overview (main area, no review open) and the review
 * pane's empty state: what waits on the viewer, and their own requests with the ones that need
 * their action first. Reloads with `reviewQueueRefreshTick`, like the queue.
 *
 * Shared by the overview (B) and the review pane (A); every line it feeds is written with
 * `describeNextMove`, so the two show the same words.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { listReviewQueue } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewQueueRow } from '@/types/reviews'

import { describeReviewError } from '../lib/reviewErrors'
import { isViewersMove, nextMoveForRow } from '../lib/reviewState'

/** Enough rows to count what waits and to sort "your move" first among the requests. */
const SUMMARY_LIMIT = 50

export interface ReviewSummaryCounts {
  /** Files the viewer owes across the waiting package reviews (from the rows read). */
  drawings: number
  reviews: number
  gates: number
  overdue: number
  /** Requests whose next move is the viewer's (changes requested, rejected, nobody left). */
  needAction: number
  /** Requests waiting on reviewers. */
  waiting: number
}

export interface ReviewSummary {
  /** Waiting on the viewer, in the server's order (overdue first, priority, due, age). */
  awaiting: ReviewQueueRow[]
  /** The viewer's open requests, the ones that need their action first. */
  requested: ReviewQueueRow[]
  counts: ReviewSummaryCounts
  loading: boolean
  error: string | null
  /** True once both reads came back at least once. */
  loaded: boolean
  retry: () => void
}

export function summarizeRows(
  awaiting: readonly ReviewQueueRow[],
  requested: readonly ReviewQueueRow[],
  userId: string | null,
): { requested: ReviewQueueRow[]; counts: ReviewSummaryCounts } {
  let drawings = 0
  let reviews = 0
  let gates = 0
  let overdue = 0
  for (const row of awaiting) {
    if (row.kind === 'gate') gates++
    else {
      reviews++
      drawings += row.itemsOwedByMe
    }
    if (row.overdue) overdue++
  }
  const withMove = requested.map((row) => ({
    row,
    mine: isViewersMove(nextMoveForRow(row, userId, 'requested_by_me')),
  }))
  const sorted = [...withMove.filter((r) => r.mine), ...withMove.filter((r) => !r.mine)].map(
    (r) => r.row,
  )
  const needAction = withMove.filter((r) => r.mine).length
  const waiting = requested.filter((r) => r.status === 'open').length
  return { requested: sorted, counts: { drawings, reviews, gates, overdue, needAction, waiting } }
}

export function useReviewSummary(enabled = true): ReviewSummary {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const orgId = usePDMStore((s) => s.organization?.id ?? null)
  const refreshTick = usePDMStore((s) => s.reviewQueueRefreshTick)
  const [awaiting, setAwaiting] = useState<ReviewQueueRow[]>([])
  const [requestedRaw, setRequestedRaw] = useState<ReviewQueueRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualTick, setManualTick] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    if (!enabled || !userId || !orgId) return
    const gen = ++generation.current
    setLoading(true)
    Promise.all([
      listReviewQueue({ bucket: 'awaiting_me', limit: SUMMARY_LIMIT }),
      listReviewQueue({ bucket: 'requested_by_me', limit: SUMMARY_LIMIT }),
    ])
      .then(([a, r]) => {
        if (gen !== generation.current) return
        setAwaiting(a.rows)
        setRequestedRaw(r.rows)
        setError(null)
        setLoaded(true)
      })
      .catch((loadError: unknown) => {
        if (gen !== generation.current) return
        log.warn('[Reviews]', 'Loading the review summary failed', { error: loadError })
        setError(describeReviewError(loadError))
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false)
      })
  }, [enabled, userId, orgId, refreshTick, manualTick])

  const summary = useMemo(
    () => summarizeRows(awaiting, requestedRaw, userId),
    [awaiting, requestedRaw, userId],
  )
  const retry = useCallback(() => setManualTick((n) => n + 1), [])

  return {
    awaiting,
    requested: summary.requested,
    counts: summary.counts,
    loading,
    error,
    loaded,
    retry,
  }
}
