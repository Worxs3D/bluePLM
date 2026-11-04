/**
 * Order status rules, as `supply_order_set_status` and the edit RPCs apply them. Pure.
 */

import { ORDER_STATUS_TRANSITIONS, type OrderStatus, type SupplyOrder } from '@/types/orders'

/**
 * The statuses `order` can move to next. Sending an order with no lines is left out (the server
 * refuses it, `EMPTY_ORDER`).
 */
export function nextAllowedStatuses(order: Pick<SupplyOrder, 'status' | 'lineCount'>): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[order.status].filter((s) => !(s === 'sent' && order.lineCount === 0))
}

/** Lines and their kinds can change only in a draft. */
export function linesEditable(order: Pick<SupplyOrder, 'status'>): boolean {
  return order.status === 'draft'
}

/** The header (title, supplier, due date, notes, purpose) can change unless closed or cancelled. */
export function headerEditable(order: Pick<SupplyOrder, 'status'>): boolean {
  return order.status !== 'closed' && order.status !== 'cancelled'
}

/** Delete is offered for drafts and cancelled orders (the creator's or an administrator's). */
export function deletable(order: Pick<SupplyOrder, 'status'>): boolean {
  return order.status === 'draft' || order.status === 'cancelled'
}
