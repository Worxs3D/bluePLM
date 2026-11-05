/**
 * The Reviews view's main area: an open workflow gate, an open review, or the overview.
 */

import { usePDMStore } from '@/stores/pdmStore'

import { ReviewsOverview } from './ReviewsOverview'
import { GateReviewDetail } from './detail/GateReviewDetail'
import { ReviewDetailPane } from './detail/ReviewDetailPane'

export function ReviewsMain() {
  const activeReviewId = usePDMStore((s) => s.activeReviewId)
  const activeGateId = usePDMStore((s) => s.activeGateReviewId)
  if (activeGateId) return <GateReviewDetail key={activeGateId} gateId={activeGateId} />
  if (activeReviewId) return <ReviewDetailPane />
  return <ReviewsOverview />
}
