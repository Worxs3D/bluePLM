/**
 * Pure helpers for the order list: the sidebar's filter and search, the context menu's recent
 * drafts, and the default title of an order made from files.
 */

import { OPEN_ORDER_STATUSES, type SupplyOrder } from '@/types/orders'

/** The sidebar's status filter: Open (draft, sent, received) or All. */
export type OrderListFilter = 'open' | 'all'

/** How many drafts the context menu's Orders submenu offers. */
export const RECENT_DRAFT_LIMIT = 5

/**
 * The orders the sidebar shows, in the given order (the list arrives newest first). The search
 * matches the order number, title and supplier name, case-insensitively, every word anywhere.
 */
export function filterOrders(
  orders: readonly SupplyOrder[],
  filter: OrderListFilter,
  query: string,
): SupplyOrder[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return orders.filter((order) => {
    if (filter === 'open' && !OPEN_ORDER_STATUSES.includes(order.status)) return false
    if (words.length === 0) return true
    const haystack = [order.orderNumber, order.title, order.supplierName ?? '']
      .join(' ')
      .toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

/** When an order last changed: its update time, else its creation time. */
function touchedAt(order: SupplyOrder): string {
  return order.updatedAt ?? order.createdAt
}

/** The drafts most recently changed, newest first, at most `limit`. */
export function recentDraftOrders(
  orders: readonly SupplyOrder[],
  limit: number = RECENT_DRAFT_LIMIT,
): SupplyOrder[] {
  return orders
    .filter((o) => o.status === 'draft')
    .sort((a, b) => (touchedAt(a) < touchedAt(b) ? 1 : touchedAt(a) > touchedAt(b) ? -1 : 0))
    .slice(0, limit)
}

/** What a file contributes to an order's default title: its part number, else its name. */
export interface TitleSource {
  partNumber?: string | null
  name: string
}

/**
 * The title of an order made from files: the first file's part number (or name without its
 * extension), and how many more there are. `format` turns the "and N more" key into text.
 */
export function defaultOrderTitle(
  files: readonly TitleSource[],
  format: (key: 'one' | 'many', params: { first: string; count: number }) => string,
): string | null {
  if (files.length === 0) return null
  const first = files[0]
  const label = first.partNumber?.trim() || first.name.replace(/\.[^.]+$/, '')
  return files.length === 1
    ? format('one', { first: label, count: 1 })
    : format('many', { first: label, count: files.length - 1 })
}
