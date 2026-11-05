/**
 * Orders Slice (5.11.0, schema 513)
 *
 * The organization's orders, the lines of the orders opened in this session and the state of
 * each line's outputs. Session state only, never persisted. Writes go through `@/lib/orders` and
 * then `refreshOrder` / `loadOrders`; realtime changes of `supply_order*` call the same, debounced
 * (`src/lib/orders/realtimeRefresh.ts`).
 *
 * `resetOrders` runs on sign-out and on an organization change (`userSlice`), and a load that was
 * in flight across a reset is dropped, so one organization's orders never show in another.
 * Bounded: lines and output states are kept for at most `MAX_OPEN_ORDERS` orders (the least
 * recently opened go first, never the active one).
 */

import { StateCreator } from 'zustand'

import { listOrders, loadOrder } from '../../lib/orders/api'
import { resolveLineOutputs } from '../../lib/orders/outputs'
import type { LineOutputState, SupplyOrder, SupplyOrderLine } from '../../types/orders'
import type { PDMStoreState } from '../types'

/** Orders whose lines and output states stay loaded at once. */
export const MAX_OPEN_ORDERS = 20

export interface OrdersSlice {
  /** The organization's orders, newest first (`listOrders`). */
  orders: SupplyOrder[]
  ordersLoaded: boolean
  ordersLoading: boolean
  ordersError: string | null
  /** The order the main view shows. */
  activeOrderId: string | null
  /** Lines of each loaded order (the ones this user can see), in position order. */
  orderLines: Record<string, SupplyOrderLine[]>
  /** Output states of each loaded order's lines, by line id. */
  orderOutputStates: Record<string, Record<string, LineOutputState[]>>
  /** Orders being loaded or refreshed. */
  orderLoading: Record<string, boolean>
  /** The last load error of an order, until it loads again. */
  orderErrors: Record<string, string>

  loadOrders: () => Promise<void>
  /** Make `id` the active order and load it. */
  openOrder: (id: string) => Promise<void>
  /** Read the order and its lines again, then their output states. A gone order is dropped. */
  refreshOrder: (id: string) => Promise<void>
  /** Read the output states of a loaded order's lines again (after Generate missing). */
  refreshOrderOutputs: (id: string) => Promise<void>
  setActiveOrderId: (id: string | null) => void
  resetOrders: () => void
}

const INITIAL: Pick<
  OrdersSlice,
  | 'orders'
  | 'ordersLoaded'
  | 'ordersLoading'
  | 'ordersError'
  | 'activeOrderId'
  | 'orderLines'
  | 'orderOutputStates'
  | 'orderLoading'
  | 'orderErrors'
> = {
  orders: [],
  ordersLoaded: false,
  ordersLoading: false,
  ordersError: null,
  activeOrderId: null,
  orderLines: {},
  orderOutputStates: {},
  orderLoading: {},
  orderErrors: {},
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

/** The list with `order` replaced or added, newest (highest sequence) first. Pure. */
export function upsertOrder(orders: readonly SupplyOrder[], order: SupplyOrder): SupplyOrder[] {
  const next = orders.filter((o) => o.id !== order.id)
  next.push(order)
  return next.sort((a, b) => b.sequence - a.sequence)
}

/**
 * The loaded list, with the active order kept when the list leaves it out (an old closed order
 * past the list's cap): the open order must not look gone while it exists. Its own refresh
 * (`refreshOrder`) is what drops it when it really is gone. Pure.
 */
export function keepActiveOrder(
  loaded: SupplyOrder[],
  previous: readonly SupplyOrder[],
  activeOrderId: string | null,
): SupplyOrder[] {
  if (!activeOrderId || loaded.some((o) => o.id === activeOrderId)) return loaded
  const active = previous.find((o) => o.id === activeOrderId)
  return active ? upsertOrder(loaded, active) : loaded
}

/**
 * The loaded orders after `id` is (re)loaded: `id` moves to the end (most recent), and the oldest
 * go past `max`, never `keep` (the active order). Returns the ids to drop. Pure.
 */
export function ordersToDrop(loadedIds: readonly string[], id: string, keep: string | null, max = MAX_OPEN_ORDERS): string[] {
  const order = [...loadedIds.filter((x) => x !== id), id]
  const drop: string[] = []
  for (const candidate of order) {
    if (order.length - drop.length <= max) break
    if (candidate !== id && candidate !== keep) drop.push(candidate)
  }
  return drop
}

export const createOrdersSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  OrdersSlice
> = (set, get) => {
  // Raised by resetOrders: a load started before it lands nowhere.
  let generation = 0
  // The newest request per order (and for the list): an older answer is dropped.
  let listRequest = 0
  const orderRequest = new Map<string, number>()
  const statesRequest = new Map<string, number>()
  // Loaded order ids, least recently loaded first.
  let loadedOrder: string[] = []

  const dropOrder = (id: string) =>
    set((s) => ({
      orders: s.orders.filter((o) => o.id !== id),
      orderLines: without(s.orderLines, id),
      orderOutputStates: without(s.orderOutputStates, id),
      orderErrors: without(s.orderErrors, id),
      activeOrderId: s.activeOrderId === id ? null : s.activeOrderId,
    }))

  /** Resolve the output states of `lines`; an older resolve of the same order is dropped. */
  const resolveStates = async (id: string, lines: SupplyOrderLine[]) => {
    const gen = generation
    const request = (statesRequest.get(id) ?? 0) + 1
    statesRequest.set(id, request)
    try {
      const states = await resolveLineOutputs(lines)
      if (gen !== generation || statesRequest.get(id) !== request || !get().orderLines[id]) return
      set((s) => ({ orderOutputStates: { ...s.orderOutputStates, [id]: Object.fromEntries(states) } }))
    } catch (error) {
      if (gen !== generation || statesRequest.get(id) !== request) return
      set((s) => ({ orderErrors: { ...s.orderErrors, [id]: errorText(error) } }))
    }
  }

  return {
    ...INITIAL,

    loadOrders: async () => {
      const orgId = get().organization?.id
      if (!orgId) {
        set({ orders: [], ordersLoaded: false, ordersLoading: false, ordersError: null })
        return
      }
      const gen = generation
      const request = ++listRequest
      set({ ordersLoading: true })
      try {
        const orders = await listOrders(orgId)
        if (gen !== generation || request !== listRequest) return
        set((s) => ({
          orders: keepActiveOrder(orders, s.orders, s.activeOrderId),
          ordersLoaded: true,
          ordersLoading: false,
          ordersError: null,
        }))
      } catch (error) {
        if (gen !== generation || request !== listRequest) return
        set({ ordersLoading: false, ordersError: errorText(error) })
      }
    },

    openOrder: async (id) => {
      set({ activeOrderId: id })
      await get().refreshOrder(id)
    },

    refreshOrder: async (id) => {
      const gen = generation
      const request = (orderRequest.get(id) ?? 0) + 1
      orderRequest.set(id, request)
      set((s) => ({ orderLoading: { ...s.orderLoading, [id]: true } }))
      const current = () => gen === generation && orderRequest.get(id) === request
      try {
        const loaded = await loadOrder(id)
        if (!current()) return
        if (!loaded) {
          loadedOrder = loadedOrder.filter((x) => x !== id)
          orderRequest.delete(id)
          statesRequest.delete(id)
          dropOrder(id)
          set((s) => ({ orderLoading: without(s.orderLoading, id) }))
          return
        }
        const drop = ordersToDrop(loadedOrder, id, get().activeOrderId)
        loadedOrder = [...loadedOrder.filter((x) => x !== id && !drop.includes(x)), id]
        for (const gone of drop) {
          orderRequest.delete(gone)
          statesRequest.delete(gone)
        }
        set((s) => {
          let lines = { ...s.orderLines, [id]: loaded.lines }
          let states = s.orderOutputStates
          for (const gone of drop) {
            lines = without(lines, gone)
            states = without(states, gone)
          }
          return {
            orders: upsertOrder(s.orders, loaded.order),
            orderLines: lines,
            orderOutputStates: states,
            orderErrors: without(s.orderErrors, id),
          }
        })
        await resolveStates(id, loaded.lines)
      } catch (error) {
        if (!current()) return
        set((s) => ({ orderErrors: { ...s.orderErrors, [id]: errorText(error) } }))
      } finally {
        if (current()) set((s) => ({ orderLoading: without(s.orderLoading, id) }))
      }
    },

    refreshOrderOutputs: async (id) => {
      const lines = get().orderLines[id]
      if (lines) await resolveStates(id, lines)
    },

    setActiveOrderId: (id) => set({ activeOrderId: id }),

    resetOrders: () => {
      generation++
      listRequest = 0
      orderRequest.clear()
      statesRequest.clear()
      loadedOrder = []
      set({ ...INITIAL })
    },
  }
}
