/**
 * The toast after files were added to an order: how many lines were added and updated, and what
 * was skipped and why (the planner's reasons and the server's), in one sentence per part.
 */

import type { OrderLineSkipReason } from '@/types/orders'

/** Why the planner left a file out (`planOrderLinesForFiles`). */
export type PlannerSkipReason = 'not-checked-in' | 'folder' | 'unsupported'

export type SkipReasonKey =
  | 'NotCheckedIn'
  | 'Folder'
  | 'Unsupported'
  | 'NotFound'
  | 'NoVaultAccess'
  | 'NotADrawing'
  | 'WrongOrg'

const PLANNER_KEY: Record<PlannerSkipReason, SkipReasonKey> = {
  'not-checked-in': 'NotCheckedIn',
  folder: 'Folder',
  unsupported: 'Unsupported',
}

const SERVER_KEY: Record<OrderLineSkipReason, SkipReasonKey> = {
  NOT_FOUND: 'NotFound',
  NO_VAULT_ACCESS: 'NoVaultAccess',
  NOT_A_DRAWING: 'NotADrawing',
  WRONG_ORG: 'WrongOrg',
}

export interface AddResultInput {
  orderNumber: string
  added: number
  updated: number
  plannerSkipped: ReadonlyArray<{ reason: PlannerSkipReason }>
  serverSkipped: ReadonlyArray<{ reason: OrderLineSkipReason }>
}

/** One translatable part of the message: a key under `orders.` (flat) and its values. */
export interface MessagePart {
  key: string
  params: Record<string, string | number>
}

export interface AddResultMessage {
  tone: 'success' | 'warning' | 'info'
  parts: MessagePart[]
}

/** Skip reasons and how often each occurred, most frequent first, ties in first-seen order. */
export function skipReasonCounts(input: AddResultInput): Array<[SkipReasonKey, number]> {
  const counts = new Map<SkipReasonKey, number>()
  for (const s of input.plannerSkipped) {
    const k = PLANNER_KEY[s.reason]
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (const s of input.serverSkipped) {
    const k = SERVER_KEY[s.reason]
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * The parts of the toast. `success` when something was added or updated and nothing skipped,
 * `warning` when something was skipped, `info` when nothing changed and nothing was skipped
 * (every line was already there with the same version).
 */
export function addResultMessage(input: AddResultInput): AddResultMessage {
  const parts: MessagePart[] = []
  const order = input.orderNumber
  if (input.added > 0) {
    parts.push({
      key: input.added === 1 ? 'toastAddedOne' : 'toastAddedMany',
      params: { count: input.added, order },
    })
  }
  if (input.updated > 0) {
    parts.push({
      key: input.updated === 1 ? 'toastUpdatedOne' : 'toastUpdatedMany',
      params: { count: input.updated, order },
    })
  }
  const reasons = skipReasonCounts(input)
  for (const [reason, count] of reasons) {
    parts.push({
      key: count === 1 ? `skippedOne${reason}` : `skippedMany${reason}`,
      params: { count },
    })
  }
  if (parts.length === 0) parts.push({ key: 'toastNothingChanged', params: { order } })
  const tone = reasons.length > 0 ? 'warning' : input.added + input.updated > 0 ? 'success' : 'info'
  return { tone, parts }
}
