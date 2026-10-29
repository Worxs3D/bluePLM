/**
 * The open review's header: who asked, the message, due date, priority, round and mode, who is
 * reviewing, and the requester's actions (edit priority / due date, resubmit, cancel), plus
 * "Download package for SOLIDWORKS" for anyone who can see the review.
 */

import { useState } from 'react'
import { ArrowLeft, Ban, FolderDown, Loader2, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { Dialog } from '@/components/core/Dialog'
import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { chooseReviewPackageDestination } from '@/lib/reviewPackage'
import { cancelReview, updateReviewMeta } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewDetail, ReviewPriority } from '@/types/reviews'

import { DueDateChip, PriorityChip, StatusChip } from '../components/QueueChips'
import { dueChip, formatDateOnly, localDateString } from '../lib/queueChips'
import { describeReviewError } from '../lib/reviewErrors'

const PRIORITIES: ReviewPriority[] = ['low', 'normal', 'high', 'urgent']

const REVIEWER_STATUS_CLASS: Record<string, string> = {
  pending: 'text-plm-info',
  approved: 'text-plm-success',
  changes_requested: 'text-plm-warning',
  rejected: 'text-plm-error',
  cancelled: 'text-plm-fg-muted',
}

interface ReviewHeaderProps {
  detail: ReviewDetail
  onBack: () => void
  onResubmit: () => void
  onChanged: () => void
}

export function ReviewHeader({ detail, onBack, onResubmit, onChanged }: ReviewHeaderProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const { review, me, reviewers } = detail
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [downloading, setDownloading] = useState(false)

  const open = review.status === 'open' || review.status === 'changes_requested'
  const chip = open ? dueChip(review.dueDate, localDateString(), review.overdue) : null
  const requester = review.requestedBy?.fullName || review.requestedBy?.email
  const currentReviewers = reviewers.filter((r) => r.roundNumber === review.currentRound)

  const updateMeta = async (patch: { priority?: ReviewPriority; dueDate?: string | null }) => {
    setBusy(true)
    try {
      await updateReviewMeta(review.id, patch)
      onChanged()
    } catch (error) {
      addToast('error', describeReviewError(error))
    } finally {
      setBusy(false)
    }
  }

  const doCancel = async () => {
    setBusy(true)
    try {
      await cancelReview(review.id, reason.trim() || null)
      addToast('success', t('reviewDetail.cancel.done'))
      setCancelOpen(false)
      setReason('')
      onChanged()
    } catch (error) {
      addToast('error', describeReviewError(error))
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    const destination = await chooseReviewPackageDestination()
    if (!destination) return
    setDownloading(true)
    try {
      await executeCommand('download-review-package', { reviewId: review.id, destination })
    } finally {
      setDownloading(false)
    }
  }

  const ACTION = 'flex items-center gap-1 px-2 py-1 text-[11px] rounded disabled:opacity-50'

  return (
    <div className="border-b border-plm-border bg-plm-sidebar px-3 py-2 space-y-1.5 flex-shrink-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight"
          title={t('reviewDetail.back')}
        >
          <ArrowLeft size={14} />
        </button>
        <h2 className="text-sm font-medium text-plm-fg truncate">{review.title}</h2>
        <StatusChip status={review.status} />
        {review.priority !== 'normal' && <PriorityChip priority={review.priority} />}
        {chip && review.dueDate && <DueDateChip chip={chip} dueDate={review.dueDate} />}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className={`${ACTION} bg-plm-bg-light text-plm-fg hover:bg-plm-highlight border border-plm-border`}
            title={t('reviewDetail.download.hint')}
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <FolderDown size={12} />}
            {t('reviewDetail.download.button')}
          </button>
          {me.canResubmit && (
            <button
              type="button"
              onClick={onResubmit}
              className={`${ACTION} bg-plm-accent/15 text-plm-accent hover:bg-plm-accent/25`}
            >
              <RotateCcw size={12} />
              {t('reviewDetail.resubmit.button')}
            </button>
          )}
          {me.canCancel && open && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className={`${ACTION} bg-plm-error/10 text-plm-error hover:bg-plm-error/20`}
            >
              <Ban size={12} />
              {t('reviewDetail.cancel.button')}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-plm-fg-muted">
        {requester && <span>{t('reviewQueue.requestedBy', { name: requester })}</span>}
        {review.requestedAt && (
          <span>{formatDistanceToNow(new Date(review.requestedAt), { addSuffix: true })}</span>
        )}
        <span>{t('reviewQueue.round', { round: review.currentRound })}</span>
        <span>{t(`reviewDetail.mode.${review.mode}`)}</span>
        {review.dueDate && (
          <span>{t('reviewDetail.dueOn', { date: formatDateOnly(review.dueDate) })}</span>
        )}
        {me.canEditMeta && open && (
          <span className="flex items-center gap-1">
            <select
              value={review.priority}
              disabled={busy}
              onChange={(e) => void updateMeta({ priority: e.target.value as ReviewPriority })}
              className="px-1 py-0.5 text-[11px] bg-plm-bg-light border border-plm-border rounded"
              aria-label={t('reviewBuilder.meta.priority')}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`reviewQueue.priority.${p}`)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={review.dueDate ?? ''}
              min={localDateString()}
              disabled={busy}
              onChange={(e) => void updateMeta({ dueDate: e.target.value || null })}
              className="px-1 py-0.5 text-[11px] bg-plm-bg-light border border-plm-border rounded"
              aria-label={t('reviewBuilder.meta.dueDate')}
            />
          </span>
        )}
      </div>

      {review.message && (
        <p className="text-xs text-plm-fg whitespace-pre-wrap border-l-2 border-plm-accent/40 pl-2">
          {review.message}
        </p>
      )}
      {review.status === 'cancelled' && review.cancelReason && (
        <p className="text-[11px] text-plm-fg-muted">
          {t('reviewDetail.cancel.reason', { reason: review.cancelReason })}
        </p>
      )}

      {currentReviewers.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
          {currentReviewers.map((r, index) => (
            <span key={`${r.user?.id ?? 'unknown'}-${index}`} className={REVIEWER_STATUS_CLASS[r.status]}>
              {r.user?.fullName || r.user?.email || t('reviewDetail.unknownUser')} ·{' '}
              {r.withdrawnReason
                ? t(`reviewDetail.reviewerWithdrawn.${r.withdrawnReason}`)
                : t(`reviewDetail.reviewerStatus.${r.status}`)}
            </span>
          ))}
        </div>
      )}

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('reviewDetail.cancel.title')}>
        <div className="space-y-3">
          <p className="text-sm text-plm-fg-muted">{t('reviewDetail.cancel.message')}</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('reviewDetail.cancel.reasonPlaceholder')}
            className="w-full px-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="px-3 py-1.5 text-xs rounded text-plm-fg-muted hover:bg-plm-highlight"
            >
              {t('reviewDetail.cancel.keep')}
            </button>
            <button
              type="button"
              onClick={() => void doCancel()}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded bg-plm-error text-white hover:bg-plm-error/90 disabled:opacity-50"
            >
              {t('reviewDetail.cancel.confirm')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
