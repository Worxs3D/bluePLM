/**
 * The open review's small dialogs: cancel (or cancel and request again), change priority, change
 * due date. They replace the inline selects the header used to carry (review UX audit 2.7).
 */

import { useEffect, useState } from 'react'

import { Dialog } from '@/components/core/Dialog'
import { Button, SegmentedControl, TextArea, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { cancelReview, updateReviewMeta } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewPriority } from '@/types/reviews'

import { localDateString } from '../lib/queueChips'
import { describeReviewError } from '../lib/reviewErrors'

const PRIORITIES: ReviewPriority[] = ['low', 'normal', 'high', 'urgent']

export function CancelReviewDialog({
  open,
  reviewId,
  again,
  onClose,
  onDone,
}: {
  open: boolean
  reviewId: string
  /** "Cancel and request again": the caller puts the files in a new draft after. */
  again: boolean
  onClose: () => void
  onDone: () => void
}) {
  const addToast = usePDMStore((s) => s.addToast)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const confirm = async () => {
    setBusy(true)
    try {
      await cancelReview(reviewId, reason.trim() || null)
      addToast('success', t('reviewDetail.cancel.done'))
      onDone()
    } catch (error) {
      addToast('error', describeReviewError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={again ? t('reviewDetail.cancel.againTitle') : t('reviewDetail.cancel.title')}
      description={again ? t('reviewDetail.cancel.againMessage') : t('reviewDetail.cancel.message')}
      footer={
        <>
          <Button onClick={onClose}>{t('reviewDetail.cancel.keep')}</Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {again ? t('reviewDetail.cancel.againConfirm') : t('reviewDetail.cancel.confirm')}
          </Button>
        </>
      }
    >
      <TextArea
        rows={2}
        value={reason}
        autoFocus
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void confirm()
          }
        }}
        placeholder={t('reviewDetail.cancel.reasonPlaceholder')}
      />
    </Dialog>
  )
}

export function MetaDialog({
  open,
  kind,
  reviewId,
  priority,
  dueDate,
  onClose,
  onDone,
}: {
  open: boolean
  kind: 'priority' | 'due'
  reviewId: string
  priority: ReviewPriority
  dueDate: string | null
  onClose: () => void
  onDone: () => void
}) {
  const addToast = usePDMStore((s) => s.addToast)
  const [nextPriority, setNextPriority] = useState(priority)
  const [nextDue, setNextDue] = useState(dueDate ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setNextPriority(priority)
    setNextDue(dueDate ?? '')
  }, [open, priority, dueDate])

  const save = async () => {
    setBusy(true)
    try {
      await updateReviewMeta(
        reviewId,
        kind === 'priority' ? { priority: nextPriority } : { dueDate: nextDue || null },
      )
      onDone()
    } catch (error) {
      addToast('error', describeReviewError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        kind === 'priority'
          ? t('reviewDetail.editMeta.priorityTitle')
          : t('reviewDetail.editMeta.dueTitle')
      }
      footer={
        <>
          <Button onClick={onClose}>{t('reviewQueue.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('reviewDetail.editMeta.save')}
          </Button>
        </>
      }
    >
      {kind === 'priority' ? (
        <SegmentedControl<ReviewPriority>
          aria-label={t('reviewDetail.editMeta.priorityTitle')}
          value={nextPriority}
          onChange={setNextPriority}
          options={PRIORITIES.map((p) => ({ value: p, label: t(`reviewQueue.priority.${p}`) }))}
        />
      ) : (
        <div className="flex items-center gap-2">
          <TextInput
            type="date"
            value={nextDue}
            min={localDateString()}
            aria-label={t('reviewDetail.editMeta.dueLabel')}
            onChange={(e) => setNextDue(e.target.value)}
            className="max-w-[200px]"
          />
          <Button variant="ghost" size="sm" onClick={() => setNextDue('')} disabled={!nextDue}>
            {t('reviewDetail.editMeta.noDue')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}
