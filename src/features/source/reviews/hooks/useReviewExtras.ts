/**
 * What the open review shows beside its detail: thread counts per item (for the files column, the
 * what-to-fix banner and the decision comment prefill) and which pinned versions were released.
 * Both reload with the detail. A failure leaves them empty: the page shows less, never breaks.
 */

import { useEffect, useMemo, useState } from 'react'

import { log } from '@/lib/logger'
import {
  getReviewCommentRoots,
  getVersionReleases,
  type ReviewCommentRoot,
  type VersionRelease,
} from '@/lib/supabase/reviewExtras'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewDetail } from '@/types/reviews'

import { countCommentsByItem, type ItemCommentCount } from '../lib/reviewProgress'

export interface ReviewExtras {
  /** Current-round thread counts per item. */
  counts: Map<string, ItemCommentCount>
  /** Released pinned versions by file version id. */
  releases: Map<string, VersionRelease>
}

export function useReviewExtras(detail: ReviewDetail | null): ReviewExtras {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  // Comments change without the detail changing; the annotation list is the live signal.
  const annotationCount = usePDMStore((s) => s.annotations.length)
  const resolvedCount = usePDMStore((s) => s.annotations.filter((a) => a.resolved).length)
  const [roots, setRoots] = useState<ReviewCommentRoot[]>([])
  const [releases, setReleases] = useState<VersionRelease[]>([])
  const reviewId = detail?.review.id ?? null
  const versionKey = detail?.items.map((i) => i.version.fileVersionId).join(',') ?? ''

  useEffect(() => {
    if (!reviewId) return
    let cancelled = false
    getReviewCommentRoots(reviewId)
      .then((rows) => {
        if (!cancelled) setRoots(rows)
      })
      .catch((error: unknown) =>
        log.warn('[Reviews]', 'Counting review comments failed', { error, reviewId }),
      )
    return () => {
      cancelled = true
    }
  }, [reviewId, detail, annotationCount, resolvedCount])

  useEffect(() => {
    if (!versionKey) return
    let cancelled = false
    getVersionReleases(versionKey.split(','))
      .then((rows) => {
        if (!cancelled) setReleases(rows)
      })
      .catch((error: unknown) =>
        log.warn('[Reviews]', 'Reading version releases failed', { error }),
      )
    return () => {
      cancelled = true
    }
    // Every reload of the detail, not only a status change: moving an approved package into a
    // releasing state releases its versions while the review stays approved.
  }, [versionKey, detail])

  const round = detail?.review.currentRound ?? 1
  const counts = useMemo(() => countCommentsByItem(roots, round, userId), [roots, round, userId])
  const releaseMap = useMemo(() => new Map(releases.map((r) => [r.fileVersionId, r])), [releases])
  return { counts, releases: releaseMap }
}
