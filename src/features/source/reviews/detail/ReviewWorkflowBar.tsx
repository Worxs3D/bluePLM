/**
 * The review's place in the file workflow (schema 110): how many files sit in a review stage,
 * where an approval takes them, what this review already moved, and, for the requester or an
 * administrator, the two moves: the approved files now (only where the organization moves files one
 * by one), or the whole package once it is approved.
 * Hidden when workflows are off or no file of the review is in a review stage.
 *
 * `useReviewWorkflow` holds the status and the move, so the pane can also put "Move to Released"
 * in the header and the approved banner.
 */

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/core/ui'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { advanceReviewedFiles, getReviewWorkflowStatus } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewDetail, ReviewWorkflowStatus } from '@/types/reviews'

import { describeReviewError } from '../lib/reviewErrors'
import { tCount } from '../lib/plural'
import { summarizeReviewStage, type ReviewStageSummary } from '../lib/reviewStage'

export interface ReviewWorkflow {
  status: ReviewWorkflowStatus | null
  summary: ReviewStageSummary | null
  canMove: boolean
  busy: boolean
  move: (onlyApproved: boolean) => Promise<void>
}

export function useReviewWorkflow(detail: ReviewDetail, onChanged: () => void): ReviewWorkflow {
  const addToast = usePDMStore((s) => s.addToast)
  const [status, setStatus] = useState<ReviewWorkflowStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const reviewId = detail.review.id

  const load = useCallback(async () => {
    try {
      setStatus(await getReviewWorkflowStatus(reviewId))
    } catch (error) {
      // The bar is an addition to the review; a failure here must not get in its way.
      log.warn('[Reviews]', 'Loading the review workflow status failed', { error, reviewId })
      setStatus(null)
    }
  }, [reviewId])

  // Reload whenever the review itself changed (a decision, a resubmit, a settle).
  const itemOutcomes = detail.items.map((i) => i.outcome).join(',')
  useEffect(() => {
    void load()
  }, [load, detail.review.status, itemOutcomes])

  const summary = status ? summarizeReviewStage(status, detail.review.status) : null

  const move = async (onlyApproved: boolean) => {
    setBusy(true)
    try {
      const result = await advanceReviewedFiles(reviewId, onlyApproved)
      const state = summary?.nextStates.length === 1 ? summary.nextStates[0] : null
      if (result.moved > 0)
        addToast(
          'success',
          state
            ? tCount('reviewDetail.workflow.movedCount', result.moved, { state })
            : t('reviewDetail.workflow.moved', { count: result.moved }),
        )
      const stuck = result.skipped.filter((s) => s.reason !== 'not_approved')
      if (stuck.length > 0) {
        addToast(
          'warning',
          t('reviewDetail.workflow.notMoved', {
            count: stuck.length,
            files: stuck
              .slice(0, 5)
              .map((s) => `${displayFileName(s.fileName)} (${t(`reviewDetail.workflowReason.${s.reason}`)})`)
              .join(', '),
          }),
        )
      }
      await load()
      onChanged()
    } catch (error) {
      addToast('error', describeReviewError(error))
    } finally {
      setBusy(false)
    }
  }

  return { status, summary, canMove: detail.me.isRequester || detail.me.isAdmin, busy, move }
}

export function ReviewWorkflowBar({ workflow }: { workflow: ReviewWorkflow }) {
  const { status, summary, canMove, busy, move } = workflow
  if (!status || !summary || !summary.relevant) return null
  // The approved banner already says the files wait for this viewer and offers the move.
  if (summary.packageReady && canMove && summary.moved.length === 0) return null

  const next = summary.nextStates.join(', ')
  // "3 files in In Review, next Released"; several stages at once fall back to the plain count.
  const stage = summary.stages.length === 1 ? summary.stages[0] : null
  const waiting =
    summary.inStage === 0
      ? null
      : stage
        ? next
          ? tCount('reviewDetail.workflow.inStageNext', summary.inStage, { stage, state: next })
          : tCount('reviewDetail.workflow.inStage', summary.inStage, { stage })
        : next
          ? t('reviewDetail.workflow.waitingTo', { count: summary.inStage, state: next })
          : t('reviewDetail.workflow.waiting', { count: summary.inStage })
  const parts = [
    waiting,
    ...summary.moved.map((m) =>
      tCount('reviewDetail.workflow.movedCount', m.count, { state: m.state }),
    ),
  ].filter((p): p is string => !!p)
  // What happens next to the files still in a review stage, in the organization's own terms.
  const policy =
    summary.inStage > 0
      ? status.onApproval === 'advance'
        ? status.packagePolicy === 'approved_only'
          ? t('reviewDetail.workflow.autoEach')
          : t('reviewDetail.workflow.autoPackage')
        : summary.heldForPackage
          ? t('reviewDetail.workflow.heldTogether')
          : canMove
            ? t('reviewDetail.workflow.heldYou')
            : t('reviewDetail.workflow.held')
      : null

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ui-border px-4 py-2 font-ui text-[13px]">
      <span className="min-w-0 flex-1">
        <span className="text-ui-fg-tertiary">{t('reviewDetail.workflow.label')}: </span>
        <span className="text-ui-fg">{parts.join(' · ')}.</span>
        {policy && <span className="text-ui-fg-secondary"> {policy}</span>}
      </span>
      {canMove && summary.partialMoveAllowed && (
        <Button
          size="sm"
          loading={busy}
          title={t('reviewDetail.workflow.moveApprovedHint')}
          onClick={() => void move(true)}
        >
          {t('reviewDetail.workflow.moveApproved', { count: summary.approvedWaiting })}
        </Button>
      )}
    </div>
  )
}
