/**
 * Which selected queue rows a bulk action may touch. The server refuses anything else; this keeps
 * the buttons honest about how many rows they will act on.
 */

import type { ReviewQueueRow } from '@/types/reviews'
import { parseChecklistItems } from '@/types/workflow'

const OPEN = new Set(['open', 'changes_requested'])

export interface BulkEligibility {
  /**
   * Package reviews where I still owe items, plus gate reviews (they are only listed when mine)
   * that have no required checklist item.
   */
  approvable: ReviewQueueRow[]
  /**
   * Gates with required checklist items: they are approved one by one from the gate, where the
   * checklist is ticked. `complete_gate_review` does not check the checklist itself, so a bulk
   * approve would skip it.
   */
  needsChecklist: ReviewQueueRow[]
  /** Open package reviews I requested: priority, due date, cancel. */
  mine: ReviewQueueRow[]
}

export function bulkEligibility(
  rows: readonly ReviewQueueRow[],
  userId: string | null,
): BulkEligibility {
  const approvable: ReviewQueueRow[] = []
  const needsChecklist: ReviewQueueRow[] = []
  const mine: ReviewQueueRow[] = []
  for (const row of rows) {
    if (row.kind === 'gate') {
      if (!row.gate) continue
      const checklist = parseChecklistItems(row.gate.checklistItems)
      if (checklist.some((c) => c.required)) needsChecklist.push(row)
      else approvable.push(row)
      continue
    }
    if (row.status === 'open' && row.itemsOwedByMe > 0) approvable.push(row)
    if (userId && row.requestedBy?.id === userId && OPEN.has(row.status)) mine.push(row)
  }
  return { approvable, needsChecklist, mine }
}

/** Keep only selected ids that are still in the list (rows drop out as they are decided). */
export function pruneSelection(
  selected: ReadonlySet<string>,
  rows: readonly ReviewQueueRow[],
): Set<string> {
  const present = new Set(rows.map((r) => r.id))
  const next = new Set<string>()
  for (const id of selected) if (present.has(id)) next.add(id)
  return next
}

export interface BulkApproveSummary {
  /** Files the approvals decide (what the viewer owes in the selected package reviews). */
  drawings: number
  /** Package reviews among them. */
  reviews: number
  /** Workflow gates among them. */
  gates: number
  /** Of `drawings`, how many the viewer has not opened in this session. */
  unopened: number
}

/**
 * What "Approve…" is about to do, for its confirmation (review UX audit F9). `viewed` gives, per
 * review, how many of the files the viewer still owes they opened in this session
 * (`viewedItemCount`: only files owed when opened, and forgotten once decided), so it never
 * claims a file was looked at that was not.
 */
export function bulkApproveSummary(
  approvable: readonly ReviewQueueRow[],
  viewed: (reviewId: string) => number,
): BulkApproveSummary {
  let drawings = 0
  let reviews = 0
  let gates = 0
  let unopened = 0
  for (const row of approvable) {
    if (row.kind === 'gate') {
      gates++
      continue
    }
    reviews++
    drawings += row.itemsOwedByMe
    unopened += Math.max(0, row.itemsOwedByMe - viewed(row.id))
  }
  return { drawings, reviews, gates, unopened }
}
