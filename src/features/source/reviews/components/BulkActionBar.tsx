/**
 * Bulk actions over the selected queue rows: approve with one shared comment (reviewer), change
 * priority or due date, and cancel (requester). Each runs one RPC per review, in order, and
 * reports how many went through; the server refuses anything not allowed, row by row.
 */

import { useState } from 'react'
import { Ban, CheckCheck, Loader2, X } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { approveAllRemaining, cancelReview, updateReviewMeta } from '@/lib/supabase/reviews'
import { submitReviewDecision } from '@/lib/workflows'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewPriority, ReviewQueueRow } from '@/types/reviews'

import { bulkEligibility } from '../lib/bulk'
import { localDateString } from '../lib/queueChips'

const PRIORITIES: ReviewPriority[] = ['low', 'normal', 'high', 'urgent']

interface BulkActionBarProps {
  selectedRows: ReviewQueueRow[]
  onClear: () => void
}

async function runEach(
  rows: readonly ReviewQueueRow[],
  action: (row: ReviewQueueRow) => Promise<void>,
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  for (const row of rows) {
    try {
      await action(row)
      ok++
    } catch (error) {
      failed++
      log.warn('[Reviews]', 'Bulk action failed for a review', { error, id: row.id })
    }
  }
  return { ok, failed }
}

export function BulkActionBar({ selectedRows, onClear }: BulkActionBarProps) {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const addToast = usePDMStore((s) => s.addToast)
  const refreshQueue = usePDMStore((s) => s.requestReviewQueueRefresh)
  const [busy, setBusy] = useState(false)
  const [approving, setApproving] = useState(false)
  const [comment, setComment] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [priority, setPriority] = useState<ReviewPriority | ''>('')
  const [dueDate, setDueDate] = useState('')

  const { approvable, mine } = bulkEligibility(selectedRows, userId)

  const finish = (result: { ok: number; failed: number }) => {
    addToast(
      result.failed > 0 ? 'warning' : 'success',
      t('reviewQueue.bulk.done', { ok: result.ok, failed: result.failed }),
    )
    refreshQueue()
    onClear()
  }

  const run = async (rows: ReviewQueueRow[], action: (row: ReviewQueueRow) => Promise<void>) => {
    setBusy(true)
    try {
      finish(await runEach(rows, action))
    } finally {
      setBusy(false)
    }
  }

  const approveAll = () =>
    run(approvable, async (row) => {
      const shared = comment.trim() || null
      if (row.kind === 'gate' && row.gate) {
        const { data, error } = await submitReviewDecision(
          row.gate.pendingReviewId,
          'approved',
          shared ?? undefined,
        )
        if (error || !data?.success) throw error ?? new Error(data?.error_message ?? 'gate')
        return
      }
      await approveAllRemaining(row.id, shared)
    }).then(() => {
      setApproving(false)
      setComment('')
    })

  const applyMeta = () =>
    run(mine, async (row) => {
      await updateReviewMeta(row.id, {
        ...(priority ? { priority } : {}),
        ...(dueDate ? { dueDate } : {}),
      })
    }).then(() => {
      setPriority('')
      setDueDate('')
    })

  const cancelAll = () => run(mine, async (row) => void (await cancelReview(row.id)))

  return (
    <div className="border-t border-plm-border bg-plm-sidebar px-2 py-2 space-y-1.5">
      <div className="flex items-center gap-1 text-[11px] text-plm-fg">
        <span className="font-medium">{t('reviewQueue.bulk.selected', { count: selectedRows.length })}</span>
        {busy && <Loader2 size={11} className="animate-spin text-plm-fg-muted" />}
        <button
          type="button"
          onClick={onClear}
          className="ml-auto p-0.5 rounded text-plm-fg-muted hover:text-plm-fg"
          title={t('reviewQueue.bulk.clear')}
        >
          <X size={12} />
        </button>
      </div>

      {approvable.length > 0 &&
        (approving ? (
          <div className="space-y-1">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              autoFocus
              placeholder={t('reviewQueue.bulk.sharedComment')}
              className="w-full px-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded focus:outline-none focus:border-plm-accent"
            />
            <div className="flex gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void approveAll()}
                className="flex-1 px-2 py-1 text-[11px] rounded bg-plm-success/20 text-plm-success hover:bg-plm-success/30 disabled:opacity-50"
              >
                {t('reviewQueue.bulk.approveConfirm', { count: approvable.length })}
              </button>
              <button
                type="button"
                onClick={() => setApproving(false)}
                className="px-2 py-1 text-[11px] rounded text-plm-fg-muted hover:bg-plm-highlight"
              >
                {t('reviewQueue.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setApproving(true)}
            className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-plm-success/15 text-plm-success hover:bg-plm-success/25 disabled:opacity-50"
          >
            <CheckCheck size={12} />
            {t('reviewQueue.bulk.approve', { count: approvable.length })}
          </button>
        ))}

      {mine.length > 0 && (
        <>
          <div className="flex items-center gap-1">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ReviewPriority | '')}
              className="flex-1 px-1 py-0.5 text-[11px] bg-plm-bg-light border border-plm-border rounded"
              aria-label={t('reviewQueue.bulk.priority')}
            >
              <option value="">{t('reviewQueue.bulk.priority')}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`reviewQueue.priority.${p}`)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              min={localDateString()}
              onChange={(e) => setDueDate(e.target.value)}
              className="flex-1 px-1 py-0.5 text-[11px] bg-plm-bg-light border border-plm-border rounded"
              aria-label={t('reviewQueue.bulk.dueDate')}
            />
            <button
              type="button"
              disabled={busy || (!priority && !dueDate)}
              onClick={() => void applyMeta()}
              className="px-2 py-0.5 text-[11px] rounded bg-plm-accent/15 text-plm-accent hover:bg-plm-accent/25 disabled:opacity-50"
            >
              {t('reviewQueue.bulk.apply', { count: mine.length })}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmCancel(true)}
            className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-plm-error/10 text-plm-error hover:bg-plm-error/20 disabled:opacity-50"
          >
            <Ban size={12} />
            {t('reviewQueue.bulk.cancelReviews', { count: mine.length })}
          </button>
        </>
      )}

      {approvable.length === 0 && mine.length === 0 && (
        <p className="text-[10px] text-plm-fg-muted">{t('reviewQueue.bulk.nothing')}</p>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('reviewQueue.bulk.cancelTitle')}
        message={t('reviewQueue.bulk.cancelMessage', { count: mine.length })}
        confirmText={t('reviewQueue.bulk.cancelConfirm')}
        cancelText={t('reviewQueue.cancel')}
        variant="danger"
        onConfirm={() => void cancelAll()}
      />
    </div>
  )
}
