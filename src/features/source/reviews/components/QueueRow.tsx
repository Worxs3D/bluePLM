/**
 * One row of the review queue, package or workflow gate: title (gates: "Gate · file"), due date on
 * the right, and one line saying whose move it is (`describeNextMove`), who asked and when. The
 * row is an option of the queue's listbox; its checkbox sits outside the activating element.
 */

import { memo, type KeyboardEvent } from 'react'
import { ShieldCheck } from 'lucide-react'

import { ListRow, MetaLine } from '@/components/core/ui'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import type { ReviewQueueBucket, ReviewQueueRow } from '@/types/reviews'

import {
  isReviewOpen,
  nextMoveForRow,
  describeNextMove,
  nextMoveTone,
  displayName,
} from '../lib/reviewState'
import { relativeTime } from '../lib/reviewDates'
import { DueText } from './DueText'

export const TONE_CLASS: Record<ReturnType<typeof nextMoveTone>, string> = {
  strong: 'text-ui-fg',
  neutral: 'text-ui-fg-secondary',
  warning: 'text-ui-warning',
  danger: 'text-ui-danger',
  success: 'text-ui-success',
}

interface QueueRowProps {
  row: ReviewQueueRow
  bucket: ReviewQueueBucket
  userId: string | null
  /** Open in the main area. */
  active: boolean
  checked: boolean
  /** Show every checkbox (something is selected). */
  checkboxesVisible: boolean
  optionId: string
  focusable: boolean
  onOpen: (row: ReviewQueueRow) => void
  onToggleChecked: (id: string) => void
  onFocusRow: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export const QueueRow = memo(function QueueRow({
  row,
  bucket,
  userId,
  active,
  checked,
  checkboxesVisible,
  optionId,
  focusable,
  onOpen,
  onToggleChecked,
  onFocusRow,
  onKeyDown,
}: QueueRowProps) {
  const move = nextMoveForRow(row, userId, bucket)
  const requester = displayName(row.requestedBy)
  const open = isReviewOpen(row.status) || row.kind === 'gate'
  const mine = !!userId && row.requestedBy?.id === userId
  const title = row.kind === 'gate' && row.gate ? displayFileName(row.gate.fileName) : row.title

  const parts: React.ReactNode[] = [
    <span key="move" className={TONE_CLASS[nextMoveTone(move)]}>
      {describeNextMove(move)}
    </span>,
  ]
  if (row.kind === 'gate' && row.gate?.gateName)
    parts.push(<span key="gate">{row.gate.gateName}</span>)
  if (requester && !mine && row.kind === 'package') parts.push(<span key="who">{requester}</span>)
  if (open && row.priority === 'urgent')
    parts.push(
      <span key="prio" className="text-ui-danger">
        {t('reviewQueue.priority.urgent')}
      </span>,
    )
  if (open && row.priority === 'high')
    parts.push(
      <span key="prio" className="text-ui-warning">
        {t('reviewQueue.priority.high')}
      </span>,
    )

  return (
    <div onFocus={onFocusRow}>
      <ListRow
        role="option"
        id={optionId}
        tabIndex={focusable ? 0 : -1}
        selected={active}
        onActivate={() => onOpen(row)}
        onKeyDown={onKeyDown}
        hint={
          row.kind === 'gate'
            ? row.gate?.filePath
            : row.requestedAt
              ? `${row.preview?.fileName ? displayFileName(row.preview.fileName) : row.title} · ${relativeTime(row.requestedAt)}`
              : row.preview?.fileName && displayFileName(row.preview.fileName)
        }
        leading={row.kind === 'gate' ? <ShieldCheck size={14} /> : undefined}
        title={title}
        trailing={open ? <DueText dueDate={row.dueDate} overdue={row.overdue} /> : undefined}
        secondary={<MetaLine parts={parts} />}
        checkbox={{
          checked,
          onChange: () => onToggleChecked(row.id),
          label: t('reviewQueue.select', { title }),
          visible: checkboxesVisible,
        }}
      />
    </div>
  )
})
