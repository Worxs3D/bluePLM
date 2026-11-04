/**
 * Realtime refresh of orders: a burst of `supply_order` / `supply_order_line` events (one save can
 * touch many lines) becomes one reload of the list and one refresh of each loaded order it named.
 * The list reloads only when it was loaded; an order only when its lines are in the store.
 */

import { createTrailingBatcher, type BatcherTimers, type TrailingBatcher } from '@/lib/trailingBatcher'
import { usePDMStore } from '@/stores/pdmStore'
import type { PDMStoreState } from '@/stores/types'

/** Quiet time before a refresh, and the longest a steady stream can postpone it. */
export const ORDERS_REFRESH_QUIET_MS = 400
export const ORDERS_REFRESH_MAX_WAIT_MS = 2000

type OrdersStore = Pick<PDMStoreState, 'ordersLoaded' | 'orderLines' | 'loadOrders' | 'refreshOrder'>

export interface OrdersRealtimeRefresh {
  /** An event of the order with this id. */
  add: (orderId: string) => void
  /** Drop what is pending (the subscription is going away). */
  cancel: () => void
}

export function createOrdersRealtimeRefresh(
  getState: () => OrdersStore = () => usePDMStore.getState(),
  timers?: BatcherTimers,
): OrdersRealtimeRefresh {
  const batcher: TrailingBatcher = createTrailingBatcher({
    quietMs: ORDERS_REFRESH_QUIET_MS,
    maxWaitMs: ORDERS_REFRESH_MAX_WAIT_MS,
    timers,
    onFlush: (ids) => {
      const state = getState()
      if (state.ordersLoaded) void state.loadOrders()
      for (const id of ids) if (state.orderLines[id]) void state.refreshOrder(id)
    },
  })
  return { add: (orderId) => batcher.add(orderId), cancel: () => batcher.cancel() }
}
