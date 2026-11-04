/**
 * The undo window for review decisions (review UX audit F1). The server never lets a reviewer
 * change a decision in a round, so a decision is not sent the moment it is made: it waits here,
 * with an Undo toast, for `UNDO_WINDOW_MS`, and is sent when the window ends, when the reviewer
 * makes another decision (the earlier one goes first), or when the review closes or changes on
 * screen (flushed, never dropped).
 *
 * A crash or reload inside the window loses the queued decision and leaves the item owed, which is
 * the safe side: the reviewer is asked again, nothing is approved that was not sent.
 *
 * Pure: the hook (`usePendingDecisions`) owns the timers and the RPCs.
 */

import type { ItemDecisionInput, ReviewDecision } from '@/types/reviews'

export const UNDO_WINDOW_MS = 5000

export interface PendingDecision {
  /** Unique per queued decision. */
  id: string
  reviewId: string
  /** `item`: one file; `all`: "Approve remaining" for every file still owed. */
  scope: 'item' | 'all'
  /** The files this decision covers (one for `item`, every owed one for `all`). */
  itemIds: string[]
  decision: ReviewDecision
  comment: string | null
  /** Epoch ms when it was queued. */
  queuedAt: number
}

export interface QueueStep {
  queue: PendingDecision[]
  /** Decisions to send now, in order. */
  toSend: PendingDecision[]
}

/** Queue a decision. Anything already waiting is sent first (one undoable decision at a time). */
export function enqueueDecision(
  queue: readonly PendingDecision[],
  entry: PendingDecision,
): QueueStep {
  return { queue: [entry], toSend: [...queue] }
}

/** Undo: take a decision back out, if it has not been sent yet. */
export function cancelDecision(
  queue: readonly PendingDecision[],
  id: string,
): { queue: PendingDecision[]; cancelled: PendingDecision | null } {
  const cancelled = queue.find((e) => e.id === id) ?? null
  return { queue: queue.filter((e) => e.id !== id), cancelled }
}

/** Decisions whose window has ended by `now`. */
export function expireDecisions(
  queue: readonly PendingDecision[],
  now: number,
  windowMs: number = UNDO_WINDOW_MS,
): QueueStep {
  const toSend = queue.filter((e) => now - e.queuedAt >= windowMs)
  return { queue: queue.filter((e) => now - e.queuedAt < windowMs), toSend }
}

/** Everything, now (the review changes on screen or the pane unmounts). */
export function flushDecisions(queue: readonly PendingDecision[]): QueueStep {
  return { queue: [], toSend: [...queue] }
}

/** Items shown as "sending" in the list. */
export function pendingItemIds(queue: readonly PendingDecision[]): Set<string> {
  const ids = new Set<string>()
  for (const e of queue) for (const id of e.itemIds) ids.add(id)
  return ids
}

/**
 * What the viewer still owes once the queued decisions go through, in the order the server gave.
 * Items in flight (`sending`) count as decided too, so the view moves on while they are sent.
 */
export function effectiveOwed(
  owedIds: readonly string[],
  queue: readonly PendingDecision[],
  sending: ReadonlySet<string> = new Set(),
): string[] {
  const pending = pendingItemIds(queue)
  return owedIds.filter((id) => !pending.has(id) && !sending.has(id))
}

/**
 * What a queued decision sends: exactly the files it was made on. "Approve remaining" lists the
 * files the viewer saw as owed when they pressed it, never the server's owed set at send time,
 * which may include a file whose queued decision failed or one added during the window. A comment
 * makes them `approved_with_comments`, as `review_approve_all_remaining` does.
 */
export function decisionsToSend(entry: PendingDecision): ItemDecisionInput[] {
  const comment = entry.comment?.trim() || null
  const decision: ReviewDecision =
    entry.scope === 'all' ? (comment ? 'approved_with_comments' : 'approved') : entry.decision
  return entry.itemIds.map((itemId) => ({ itemId, decision, comment }))
}

/** An undone decision, reopened in the decision bar of the file it was made on. */
export interface DecisionRestore {
  /** The file the decision was made on; any other file ignores it. */
  itemId: string
  decision: ReviewDecision | 'approve_all'
  comment: string | null
  /** A new value re-opens the box even for the same decision. */
  tick: number
}

export function restoreFromUndo(entry: PendingDecision, tick: number): DecisionRestore {
  return {
    itemId: entry.itemIds[0],
    decision: entry.scope === 'all' ? 'approve_all' : entry.decision,
    comment: entry.comment,
    tick,
  }
}

/**
 * Whether the bar of `itemId` reopens `restore`: only on the file the undo went back to (for
 * "Approve remaining", the first of its files), and not for a plain Approve (nothing to reopen).
 */
export function restoreApplies(restore: DecisionRestore | null, itemId: string): boolean {
  if (!restore || restore.itemId !== itemId) return false
  return !(restore.decision === 'approved' && !restore.comment)
}

/**
 * Items still shown as being sent: an id leaves `sending` only once a reload no longer lists it as
 * owed (or its send failed), so the file never looks owed again between the RPC and the reload.
 */
export function settleSending(
  sending: ReadonlySet<string>,
  owedOnServer: ReadonlySet<string>,
  sent: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>()
  for (const id of sending) if (!(sent.has(id) && !owedOnServer.has(id))) next.add(id)
  return next
}
