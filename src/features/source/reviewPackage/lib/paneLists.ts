/**
 * The review pane's two short lists when no draft is open: "Waiting on you" and "Your requests".
 * The next-move line itself comes from `reviews/lib/reviewState.ts` (the only "who owes what"
 * copy); this decides the order and the due text.
 */

import { dueChip, type DueChip } from '@/features/source/reviews/lib/queueChips'
import { isViewersMove, nextMoveForRow } from '@/features/source/reviews/lib/reviewState'
import { t } from '@/lib/i18n'
import type { ReviewQueueRow } from '@/types/reviews'

/** How many rows each list shows. */
export const PANE_LIST_ROWS = 3
/** "Your requests" reads more than it shows, so the requester's own moves can sort to the top. */
export const PANE_REQUESTS_FETCH = 10

/** The requester's rows whose move is theirs first (server order kept within each group). */
export function sortRequestsForPane(rows: readonly ReviewQueueRow[], userId: string | null): ReviewQueueRow[] {
  const mine: ReviewQueueRow[] = []
  const rest: ReviewQueueRow[] = []
  for (const row of rows) {
    if (isViewersMove(nextMoveForRow(row, userId, 'requested_by_me'))) mine.push(row)
    else rest.push(row)
  }
  return [...mine, ...rest]
}

/** The due text of an open row ("Due today", "Overdue by 2 days"), or null when it has none. */
export function dueText(chip: DueChip | null): string | null {
  if (!chip) return null
  switch (chip.tone) {
    case 'overdue':
      return chip.days === -1
        ? t('reviewQueue.due.overdueOne')
        : t('reviewQueue.due.overdue', { count: -chip.days })
    case 'today':
      return t('reviewQueue.due.today')
    case 'soon':
      return chip.days === 1 ? t('reviewQueue.due.tomorrow') : t('reviewQueue.due.inDays', { count: chip.days })
    case 'later':
      return t('reviewQueue.due.inDays', { count: chip.days })
  }
}

/** The row's due chip when it is still open (closed rows have no due date to meet). */
export function rowDue(row: ReviewQueueRow, today: string): DueChip | null {
  if (row.status !== 'open' && row.status !== 'changes_requested') return null
  return dueChip(row.dueDate, today, row.overdue)
}
