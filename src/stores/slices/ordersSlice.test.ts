import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'

const h = vi.hoisted(() => ({
  listOrders: vi.fn(),
  loadOrder: vi.fn(),
  resolveLineOutputs: vi.fn(),
}))

vi.mock('@/lib/orders/api', () => ({ listOrders: h.listOrders, loadOrder: h.loadOrder }))
vi.mock('@/lib/orders/outputs', () => ({ resolveLineOutputs: h.resolveLineOutputs }))

import { createOrdersRealtimeRefresh } from '@/lib/orders/realtimeRefresh'
import type { SupplyOrder, SupplyOrderLine } from '@/types/orders'

import { createOrdersSlice, keepActiveOrder, ordersToDrop, upsertOrder, type OrdersSlice } from './ordersSlice'
import type { PDMStoreState } from '../types'

vi.mock('@/stores/pdmStore', () => ({ usePDMStore: { getState: () => ({}) } }))

type Creator = StateCreator<PDMStoreState, [['zustand/persist', unknown]], [], OrdersSlice>

function order(id: string, sequence: number): SupplyOrder {
  return { id, sequence, orgId: 'org', orderNumber: `ORD-${sequence}`, status: 'draft', lineCount: 1 } as SupplyOrder
}

function line(id: string, orderId: string): SupplyOrderLine {
  return { id, orderId, sentOutputs: null } as SupplyOrderLine
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let store: PDMStoreState

function makeStore() {
  store = { organization: { id: 'org' } } as unknown as PDMStoreState
  const set: Parameters<Creator>[0] = (partial) => {
    const update = typeof partial === 'function' ? partial(store) : partial
    store = { ...store, ...update }
  }
  const get: Parameters<Creator>[1] = () => store
  store = { ...store, ...createOrdersSlice(set, get, {} as Parameters<Creator>[2]) }
}

beforeEach(() => {
  h.listOrders.mockReset()
  h.loadOrder.mockReset()
  h.resolveLineOutputs.mockReset()
  h.resolveLineOutputs.mockResolvedValue(new Map([['l1', [{ kind: 'step', status: 'ready', included: true }]]]))
  makeStore()
})

describe('ordersSlice', () => {
  it('loads the list, opens an order and resolves its outputs', async () => {
    h.listOrders.mockResolvedValue([order('a', 2), order('b', 1)])
    await store.loadOrders()
    expect(store.ordersLoaded).toBe(true)
    expect(store.orders.map((o) => o.id)).toEqual(['a', 'b'])

    h.loadOrder.mockResolvedValue({ order: { ...order('b', 1), title: 'New title' }, lines: [line('l1', 'b')] })
    await store.openOrder('b')
    expect(store.activeOrderId).toBe('b')
    expect(store.orderLines.b).toHaveLength(1)
    expect(store.orderOutputStates.b.l1[0].status).toBe('ready')
    expect(store.orders.find((o) => o.id === 'b')?.title).toBe('New title')
    expect(store.orderLoading.b).toBeUndefined()
  })

  it('keeps the open order in the list when the list leaves it out', async () => {
    h.loadOrder.mockResolvedValue({ order: { ...order('old', 1), status: 'closed' }, lines: [] })
    await store.openOrder('old')
    // An old closed order past the list's cap.
    h.listOrders.mockResolvedValue([order('a', 9)])
    await store.loadOrders()
    expect(store.orders.map((o) => o.id)).toEqual(['a', 'old'])
    expect(store.activeOrderId).toBe('old')
  })

  it('drops an order that is gone', async () => {
    h.listOrders.mockResolvedValue([order('a', 1)])
    await store.loadOrders()
    h.loadOrder.mockResolvedValue(null)
    await store.openOrder('a')
    expect(store.orders).toEqual([])
    expect(store.activeOrderId).toBeNull()
    expect(store.orderLines.a).toBeUndefined()
  })

  it('keeps a load from before a reset (sign-out, other organization) out of the new session', async () => {
    const list = deferred<SupplyOrder[]>()
    const one = deferred<{ order: SupplyOrder; lines: SupplyOrderLine[] }>()
    h.listOrders.mockReturnValue(list.promise)
    h.loadOrder.mockReturnValue(one.promise)
    const loading = store.loadOrders()
    const opening = store.openOrder('a')
    store.resetOrders()
    list.resolve([order('a', 1)])
    one.resolve({ order: order('a', 1), lines: [line('l1', 'a')] })
    await Promise.all([loading, opening])
    expect(store.orders).toEqual([])
    expect(store.ordersLoaded).toBe(false)
    expect(store.activeOrderId).toBeNull()
    expect(store.orderLines).toEqual({})
    expect(store.orderOutputStates).toEqual({})
  })

  it('takes the newest answer when one order is refreshed twice', async () => {
    const first = deferred<{ order: SupplyOrder; lines: SupplyOrderLine[] }>()
    h.loadOrder.mockReturnValueOnce(first.promise)
    h.loadOrder.mockResolvedValueOnce({ order: { ...order('a', 1), title: 'second' }, lines: [] })
    const a = store.refreshOrder('a')
    await store.refreshOrder('a')
    first.resolve({ order: { ...order('a', 1), title: 'first' }, lines: [line('l1', 'a')] })
    await a
    expect(store.orders[0].title).toBe('second')
    expect(store.orderLines.a).toEqual([])
  })

  it('records a load error per order', async () => {
    h.loadOrder.mockRejectedValue(new Error('offline'))
    await store.refreshOrder('a')
    expect(store.orderErrors.a).toBe('offline')
  })

  it('loads nothing without an organization', async () => {
    store = { ...store, organization: null }
    await store.loadOrders()
    expect(h.listOrders).not.toHaveBeenCalled()
    expect(store.orders).toEqual([])
  })
})

describe('helpers', () => {
  it('keeps the list newest first', () => {
    expect(upsertOrder([order('a', 3), order('b', 1)], order('c', 2)).map((o) => o.id)).toEqual(['a', 'c', 'b'])
    expect(upsertOrder([order('a', 3)], { ...order('a', 3), title: 'x' })).toHaveLength(1)
  })

  it('keeps only the active order the list left out', () => {
    expect(keepActiveOrder([order('a', 2)], [order('x', 1), order('y', 0)], 'x').map((o) => o.id)).toEqual(['a', 'x'])
    expect(keepActiveOrder([order('a', 2)], [order('x', 1)], null).map((o) => o.id)).toEqual(['a'])
    expect(keepActiveOrder([order('a', 2)], [], 'x').map((o) => o.id)).toEqual(['a'])
  })

  it('drops the least recently loaded orders past the cap, never the active one', () => {
    expect(ordersToDrop(['a', 'b', 'c'], 'd', null, 3)).toEqual(['a'])
    expect(ordersToDrop(['a', 'b', 'c'], 'd', 'a', 3)).toEqual(['b'])
    expect(ordersToDrop(['a', 'b'], 'a', null, 3)).toEqual([])
  })
})

describe('createOrdersRealtimeRefresh', () => {
  it('turns a burst of events into one list reload and one refresh per loaded order', () => {
    let pending: (() => void) | null = null
    const timers = {
      setTimeout: (cb: () => void) => {
        pending = cb
        return 1
      },
      clearTimeout: () => {
        pending = null
      },
      now: () => 0,
    }
    const loadOrders = vi.fn(async () => undefined)
    const refreshOrder = vi.fn(async () => undefined)
    const refresh = createOrdersRealtimeRefresh(
      () => ({ ordersLoaded: true, orderLines: { a: [] }, loadOrders, refreshOrder }),
      timers,
    )
    refresh.add('a')
    refresh.add('b')
    refresh.add('a')
    expect(loadOrders).not.toHaveBeenCalled()
    pending!()
    expect(loadOrders).toHaveBeenCalledTimes(1)
    expect(refreshOrder.mock.calls).toEqual([['a']])
  })
})
