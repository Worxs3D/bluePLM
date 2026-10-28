/**
 * Which selected queue rows a bulk action may touch. The server refuses anything else; this keeps
 * the buttons honest about how many rows they will act on.
 */

import type { ReviewQueueRow } from '@/types/reviews'

const OPEN = new Set(['open', 'changes_requested'])

export interface BulkEligibility {
  /** Package reviews where I still owe items, plus gate reviews (they are only listed when mine). */
  approvable: ReviewQueueRow[]
  /** Open package reviews I requested: priority, due date, cancel. */
  mine: ReviewQueueRow[]
}

export function bulkEligibility(rows: readonly ReviewQueueRow[], userId: string | null): BulkEligibility {
  const approvable: ReviewQueueRow[] = []
  const mine: ReviewQueueRow[] = []
  for (const row of rows) {
    if (row.kind === 'gate') {
      if (row.gate) approvable.push(row)
      continue
    }
    if (row.status === 'open' && row.itemsOwedByMe > 0) approvable.push(row)
    if (userId && row.requestedBy?.id === userId && OPEN.has(row.status)) mine.push(row)
  }
  return { approvable, mine }
}

/** Keep only selected ids that are still in the list (rows drop out as they are decided). */
export function pruneSelection(selected: ReadonlySet<string>, rows: readonly ReviewQueueRow[]): Set<string> {
  const present = new Set(rows.map((r) => r.id))
  const next = new Set<string>()
  for (const id of selected) if (present.has(id)) next.add(id)
  return next
}
