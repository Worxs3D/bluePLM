/**
 * The two short queue reads behind the review pane's empty state: the first rows of "Waiting on
 * me" and of "My requests". Reloaded whenever a review write bumps `reviewQueueRefreshTick`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { listReviewQueue } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewQueueRow } from '@/types/reviews'

import { PANE_LIST_ROWS, PANE_REQUESTS_FETCH } from '../lib/paneLists'

export interface PaneQueue {
  awaiting: ReviewQueueRow[]
  /** More than one page exists beyond what is shown. */
  awaitingMore: boolean
  requested: ReviewQueueRow[]
  requestedMore: boolean
  loading: boolean
  error: string | null
  reload: () => void
}

export function usePaneQueue(enabled: boolean): PaneQueue {
  const tick = usePDMStore((s) => s.reviewQueueRefreshTick)
  const [manual, setManual] = useState(0)
  const [state, setState] = useState<Omit<PaneQueue, 'reload'>>({
    awaiting: [],
    awaitingMore: false,
    requested: [],
    requestedMore: false,
    loading: true,
    error: null,
  })
  const seq = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const mine = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    void (async () => {
      try {
        const [awaiting, requested] = await Promise.all([
          listReviewQueue({ bucket: 'awaiting_me', limit: PANE_LIST_ROWS }),
          listReviewQueue({ bucket: 'requested_by_me', limit: PANE_REQUESTS_FETCH }),
        ])
        if (mine !== seq.current) return
        setState({
          awaiting: awaiting.rows,
          awaitingMore: awaiting.nextCursor !== null,
          requested: requested.rows,
          requestedMore: requested.nextCursor !== null || requested.rows.length > PANE_LIST_ROWS,
          loading: false,
          error: null,
        })
      } catch (error) {
        if (mine !== seq.current) return
        log.warn('[ReviewPackage]', 'Loading the review lists failed', { error })
        setState((s) => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    })()
  }, [enabled, tick, manual])

  const reload = useCallback(() => setManual((n) => n + 1), [])
  return { ...state, reload }
}
