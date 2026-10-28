/**
 * Small status, priority and due-date chips shared by the queue rows and the review header.
 */

import { AlertTriangle, CalendarClock, Flag } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { ReviewOutcome, ReviewPriority } from '@/types/reviews'

import { formatDateOnly, type DueChip } from '../lib/queueChips'

const CHIP = 'inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-medium'

const STATUS_CLASS: Record<ReviewOutcome, string> = {
  open: 'bg-plm-info/15 text-plm-info',
  approved: 'bg-plm-success/15 text-plm-success',
  changes_requested: 'bg-plm-warning/15 text-plm-warning',
  rejected: 'bg-plm-error/15 text-plm-error',
  cancelled: 'bg-plm-fg-muted/15 text-plm-fg-muted',
}

export function StatusChip({ status }: { status: ReviewOutcome }) {
  return <span className={`${CHIP} ${STATUS_CLASS[status]}`}>{t(`reviewQueue.status.${status}`)}</span>
}

const PRIORITY_CLASS: Record<ReviewPriority, string> = {
  low: 'bg-plm-fg-muted/10 text-plm-fg-muted',
  normal: 'bg-plm-fg-muted/10 text-plm-fg-muted',
  high: 'bg-plm-warning/15 text-plm-warning',
  urgent: 'bg-plm-error/20 text-plm-error',
}

export function PriorityChip({ priority }: { priority: ReviewPriority }) {
  return (
    <span className={`${CHIP} ${PRIORITY_CLASS[priority]}`}>
      <Flag size={9} />
      {t(`reviewQueue.priority.${priority}`)}
    </span>
  )
}

const DUE_CLASS: Record<DueChip['tone'], string> = {
  overdue: 'bg-plm-error/20 text-plm-error',
  today: 'bg-plm-warning/20 text-plm-warning',
  soon: 'bg-plm-warning/10 text-plm-warning',
  later: 'bg-plm-fg-muted/10 text-plm-fg-muted',
}

export function DueDateChip({ chip, dueDate }: { chip: DueChip; dueDate: string }) {
  const label =
    chip.tone === 'overdue'
      ? t('reviewQueue.due.overdue', { count: -chip.days })
      : chip.tone === 'today'
        ? t('reviewQueue.due.today')
        : t('reviewQueue.due.inDays', { count: chip.days })
  return (
    <span className={`${CHIP} ${DUE_CLASS[chip.tone]}`} title={formatDateOnly(dueDate)}>
      {chip.tone === 'overdue' ? <AlertTriangle size={9} /> : <CalendarClock size={9} />}
      {label}
    </span>
  )
}
