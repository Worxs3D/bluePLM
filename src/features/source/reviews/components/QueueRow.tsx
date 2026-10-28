/**
 * One package review in the queue: title, first file at its pinned version, chips and progress.
 * Clicking opens it in the main area.
 */

import { memo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Package } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { ReviewQueueRow } from '@/types/reviews'

import { queueRowChips } from '../lib/queueChips'
import { DueDateChip, PriorityChip, StatusChip } from './QueueChips'

interface QueueRowProps {
  row: ReviewQueueRow
  today: string
  active: boolean
  selected: boolean
  onOpen: (id: string) => void
  onToggleSelected: (id: string) => void
}

export const QueueRow = memo(function QueueRow({
  row,
  today,
  active,
  selected,
  onOpen,
  onToggleSelected,
}: QueueRowProps) {
  const chips = queueRowChips(row, today)
  const requester = row.requestedBy?.fullName || row.requestedBy?.email
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(row.id)
      }}
      className={`rounded-md border p-2 cursor-pointer text-left transition-colors ${
        active
          ? 'border-plm-accent bg-plm-accent/10'
          : 'border-plm-border bg-plm-bg-light hover:border-plm-border-light'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelected(row.id)}
          className="w-3 h-3"
          aria-label={t('reviewQueue.select')}
        />
        <Package size={12} className="text-plm-accent flex-shrink-0" />
        <span className="text-xs font-medium text-plm-fg truncate">{row.title}</span>
        {row.itemsOwedByMe > 0 && (
          <span className="ml-auto px-1.5 rounded-full bg-plm-accent/20 text-plm-accent text-[10px] font-semibold tabular-nums">
            {row.itemsOwedByMe}
          </span>
        )}
      </div>

      {row.preview && (
        <p className="mt-0.5 text-[10px] text-plm-fg-muted truncate">
          {row.preview.fileName}
          {row.preview.version != null && ` · v${row.preview.version}`}
          {row.preview.revision && ` · ${t('reviewQueue.rev', { revision: row.preview.revision })}`}
          {row.itemCount > 1 && ` ${t('reviewQueue.moreItems', { count: row.itemCount - 1 })}`}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <StatusChip status={row.status} />
        {chips.priority && <PriorityChip priority={chips.priority} />}
        {chips.due && row.dueDate && <DueDateChip chip={chips.due} dueDate={row.dueDate} />}
        {chips.progress && (
          <span className="text-[10px] text-plm-fg-muted tabular-nums">
            {t('reviewQueue.progress', {
              decided: chips.progress.decided,
              total: chips.progress.total,
            })}
          </span>
        )}
        {row.round != null && row.round > 1 && (
          <span className="text-[10px] text-plm-fg-muted">
            {t('reviewQueue.round', { round: row.round })}
          </span>
        )}
      </div>

      {(requester || row.requestedAt) && (
        <p className="mt-0.5 text-[10px] text-plm-fg-muted/80 truncate">
          {requester && t('reviewQueue.requestedBy', { name: requester })}
          {row.requestedAt &&
            ` · ${formatDistanceToNow(new Date(row.requestedAt), { addSuffix: true })}`}
        </p>
      )}
    </div>
  )
})
