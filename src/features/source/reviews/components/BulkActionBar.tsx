/**
 * Bulk actions over the selected queue rows: approve everything the viewer owes (behind a
 * confirmation that says how many files, in how many reviews, and how many of them the viewer has
 * not opened: review UX audit F9), and, on the viewer's own requests, priority, due date and
 * cancel. Each runs one RPC per review, in order; the server refuses anything not allowed, row by
 * row, and the result names what failed.
 */

import { useState } from 'react'
import { X } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { Button, IconButton, Select, TextArea, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { viewedItemCount } from '@/lib/reviewViewedItems'
import { approveAllRemaining, cancelReview, updateReviewMeta } from '@/lib/supabase/reviews'
import { submitReviewDecision } from '@/lib/workflows'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewPriority, ReviewQueueRow } from '@/types/reviews'

import { bulkApproveSummary, bulkEligibility } from '../lib/bulk'
import { localDateString } from '../lib/queueChips'
import { tCount } from '../lib/plural'

const PRIORITIES: ReviewPriority[] = ['low', 'normal', 'high', 'urgent']

interface BulkActionBarProps {
  selectedRows: ReviewQueueRow[]
  onClear: () => void
}

async function runEach(
  rows: readonly ReviewQueueRow[],
  action: (row: ReviewQueueRow) => Promise<void>,
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0
  const failed: string[] = []
  for (const row of rows) {
    try {
      await action(row)
      ok++
    } catch (error) {
      failed.push(row.title)
      log.warn('[Reviews]', 'Bulk action failed for a review', {
        error,
        id: row.id,
        title: row.title,
      })
    }
  }
  return { ok, failed }
}

export function BulkActionBar({ selectedRows, onClear }: BulkActionBarProps) {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const addToast = usePDMStore((s) => s.addToast)
  const refreshQueue = usePDMStore((s) => s.requestReviewQueueRefresh)
  const [busy, setBusy] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [priority, setPriority] = useState<ReviewPriority | ''>('')
  const [dueDate, setDueDate] = useState('')

  const { approvable, needsChecklist, mine } = bulkEligibility(selectedRows, userId)
  const summary = bulkApproveSummary(approvable, viewedItemCount)

  const run = async (rows: ReviewQueueRow[], action: (row: ReviewQueueRow) => Promise<void>) => {
    setBusy(true)
    try {
      const result = await runEach(rows, action)
      addToast(
        result.failed.length > 0 ? 'warning' : 'success',
        t('reviewQueue.bulk.done', { ok: result.ok, failed: result.failed.length }) +
          (result.failed.length > 0 ? ` ${result.failed.slice(0, 3).join(', ')}` : ''),
      )
      refreshQueue()
      onClear()
    } finally {
      setBusy(false)
    }
  }

  const approveAll = () => {
    const shared = comment.trim() || null
    void run(approvable, async (row) => {
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
    }).then(() => setComment(''))
  }

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

  const parts = [
    summary.reviews > 0
      ? `${tCount('reviewQueue.overview.files', summary.drawings)} ${tCount('reviewQueue.overview.inReviews', summary.reviews)}`
      : null,
    summary.gates > 0 ? t('reviewQueue.bulk.approveGates', { count: summary.gates }) : null,
  ].filter((p): p is string => !!p)

  return (
    <div className="flex-shrink-0 space-y-2 border-t border-ui-border bg-ui-bg px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ui-fg">
          {t('reviewQueue.bulk.selected', { count: selectedRows.length })}
        </span>
        <IconButton
          className="ml-auto"
          size="sm"
          label={t('reviewQueue.bulk.clear')}
          icon={<X size={14} />}
          onClick={onClear}
        />
      </div>

      {approvable.length > 0 && (
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          loading={busy}
          onClick={() => setApproveOpen(true)}
        >
          {t('reviewQueue.bulk.approve')}
        </Button>
      )}

      {mine.length > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ReviewPriority | '')}
              aria-label={t('reviewQueue.bulk.priority')}
              className="min-w-0 flex-1"
            >
              <option value="">{t('reviewQueue.bulk.priorityPlaceholder')}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`reviewQueue.priority.${p}`)}
                </option>
              ))}
            </Select>
            <TextInput
              type="date"
              value={dueDate}
              min={localDateString()}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label={t('reviewQueue.bulk.dueDate')}
              className="min-w-0 flex-1"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="flex-1"
              disabled={busy || (!priority && !dueDate)}
              onClick={() => void applyMeta()}
            >
              {t('reviewQueue.bulk.apply', { count: mine.length })}
            </Button>
            <Button
              size="sm"
              variant="danger-subtle"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              {t('reviewQueue.bulk.cancelReviews', { count: mine.length })}
            </Button>
          </div>
        </>
      )}

      {needsChecklist.length > 0 && (
        <p className="text-[12px] text-ui-fg-secondary">
          {tCount('reviewQueue.bulk.skipsChecklist', needsChecklist.length)}
        </p>
      )}

      {approvable.length === 0 && mine.length === 0 && needsChecklist.length === 0 && (
        <p className="text-[12px] text-ui-fg-secondary">{t('reviewQueue.bulk.nothing')}</p>
      )}

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={t('reviewQueue.bulk.approveTitle')}
        message={
          <div className="space-y-1">
            <p className="text-ui-fg">{parts.join(' · ')}</p>
            <p>
              {summary.reviews === 0
                ? t('reviewQueue.bulk.approveGatesOnly')
                : summary.unopened >= summary.drawings
                  ? t('reviewQueue.bulk.approveNoneOpened')
                  : summary.unopened > 0
                    ? t('reviewQueue.bulk.approveUnopened', { count: summary.unopened })
                    : t('reviewQueue.bulk.approveAllOpened')}
            </p>
            {needsChecklist.length > 0 && (
              <p>{tCount('reviewQueue.bulk.skipsChecklist', needsChecklist.length)}</p>
            )}
          </div>
        }
        confirmText={t('reviewQueue.bulk.approveConfirm')}
        cancelText={t('reviewQueue.cancel')}
        onConfirm={approveAll}
      >
        <label className="block text-[13px] text-ui-fg-secondary">
          {t('reviewQueue.bulk.sharedComment')}
          <TextArea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="mt-1"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('reviewQueue.bulk.cancelTitle')}
        message={t('reviewQueue.bulk.cancelMessage', { count: mine.length })}
        confirmText={t('reviewQueue.bulk.cancelConfirm')}
        cancelText={t('reviewQueue.cancel')}
        variant="danger"
        onConfirm={() => void run(mine, async (row) => void (await cancelReview(row.id)))}
      />
    </div>
  )
}
