/**
 * Which review files the viewer opened in this session while they still owed a decision on them,
 * for the bulk-approve confirmation ("You have not opened 31 of them"). Session memory only: it is
 * not persisted, never leaves this window, and is cleared on sign-out and organization change
 * (`resetSessionState`). Losing it (a reload) only makes the confirmation more cautious.
 *
 * A file counts only while it is owed: one opened after it was decided is not counted, and one
 * decided here is forgotten, so "opened" is never subtracted from files that were not owed.
 */

const viewed = new Map<string, Set<string>>()

/** The viewer opened `itemId`, which they still owe in `reviewId`. */
export function markItemViewed(reviewId: string, itemId: string): void {
  const set = viewed.get(reviewId) ?? new Set<string>()
  set.add(itemId)
  viewed.set(reviewId, set)
}

/** The viewer decided these files: they are no longer owed, so no longer counted. */
export function forgetViewedItems(reviewId: string, itemIds: readonly string[]): void {
  const set = viewed.get(reviewId)
  if (!set) return
  for (const id of itemIds) set.delete(id)
  if (set.size === 0) viewed.delete(reviewId)
}

export function viewedItemCount(reviewId: string): number {
  return viewed.get(reviewId)?.size ?? 0
}

/** A new session (sign-out, another organization) starts with nothing opened. */
export function resetViewedItems(): void {
  viewed.clear()
}
