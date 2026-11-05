/**
 * What the Supplier Portal shows of the organization's orders: its quote orders only (RFQs
 * became quote orders in 5.13.0). Counts cover the open statuses, because the store holds every
 * open order but only the most recent closed and cancelled ones (`listOrders`).
 */

import type { SupplyOrder } from '@/types/orders'

/** How many quote orders the portal lists. */
export const RECENT_QUOTE_LIMIT = 5

export interface QuoteSummary {
  /** Drafts not yet sent. */
  draft: number
  /** Sent, waiting for the supplier's quote. */
  sent: number
  /** Quote received, not yet closed. */
  received: number
  /** The newest quote orders that are not cancelled, newest first, at most `limit`. */
  recent: SupplyOrder[]
}

export function quoteSummary(
  orders: readonly SupplyOrder[],
  limit: number = RECENT_QUOTE_LIMIT,
): QuoteSummary {
  const quotes = orders.filter((o) => o.purpose === 'quote')
  const count = (status: SupplyOrder['status']) => quotes.filter((o) => o.status === status).length
  return {
    draft: count('draft'),
    sent: count('sent'),
    received: count('received'),
    recent: quotes
      .filter((o) => o.status !== 'cancelled')
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, limit),
  }
}
