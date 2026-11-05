import { describe, expect, it } from 'vitest'

import type { SupplyOrder } from '@/types/orders'

import { groupFileOrders } from './fileOrders'
import { toHiddenLineVaults } from './hiddenLines'
import { DRAWING_LINE_KINDS, DRAWING_ONLY_LINE_KINDS, MODEL_LINE_KINDS } from './plan'
import {
  applyDefaultKinds,
  DEFAULT_ORDER_NUMBER_PREFIX,
  formatOrderNumber,
  normalizeOrderPrefix,
  orderSettingsFromOrg,
} from './settings'

describe('orderSettingsFromOrg', () => {
  it('gives the built-in defaults for no settings', () => {
    const s = orderSettingsFromOrg(undefined)
    expect(s.numberPrefix).toBe(DEFAULT_ORDER_NUMBER_PREFIX)
    expect(s.defaultKinds).toEqual({
      model_with_drawing: [...DRAWING_LINE_KINDS],
      model: [...MODEL_LINE_KINDS],
      drawing: [...DRAWING_ONLY_LINE_KINDS],
    })
  })

  it('keeps only kinds a class of line can have, in chip order, and an empty choice', () => {
    const s = orderSettingsFromOrg({
      orders: {
        number_prefix: '  PO-  ',
        default_kinds: {
          model_with_drawing: ['step', 'pdf', 'dxf'],
          model: ['pdf', 'stl', 'step', 'bogus' as never],
          drawing: [],
        },
      },
    })
    expect(s.numberPrefix).toBe('PO-')
    expect(s.defaultKinds.model_with_drawing).toEqual(['pdf', 'step', 'dxf'])
    expect(s.defaultKinds.model).toEqual(['step', 'stl'])
    expect(s.defaultKinds.drawing).toEqual([])
  })

  it('reads untrusted JSON without throwing', () => {
    const s = orderSettingsFromOrg({ orders: { number_prefix: 42 as never, default_kinds: 'x' as never } })
    expect(s.numberPrefix).toBe(DEFAULT_ORDER_NUMBER_PREFIX)
    expect(s.defaultKinds.model).toEqual([...MODEL_LINE_KINDS])
  })
})

describe('order numbers', () => {
  it('pads to four digits and trims the prefix as the server does', () => {
    expect(formatOrderNumber('ORD-', 7)).toBe('ORD-0007')
    expect(formatOrderNumber(' PO ', 12345)).toBe('PO12345')
    expect(formatOrderNumber('', 1)).toBe('ORD-0001')
    expect(normalizeOrderPrefix('x'.repeat(50))).toHaveLength(40)
  })
})

describe('applyDefaultKinds', () => {
  const settings = orderSettingsFromOrg({
    orders: { default_kinds: { model_with_drawing: ['pdf', 'step', 'dxf'], model: ['step', 'stl'], drawing: ['pdf', 'source'] } },
  })

  it('replaces each class’s built-in kinds with the organization’s', () => {
    const out = applyDefaultKinds(
      [
        { fileVersionId: 'a', drawingVersionId: 'd', outputKinds: [...DRAWING_LINE_KINDS] },
        { fileVersionId: 'b', outputKinds: [...MODEL_LINE_KINDS] },
        { fileVersionId: 'c', outputKinds: [...DRAWING_ONLY_LINE_KINDS] },
      ],
      settings,
    )
    expect(out.map((l) => l.outputKinds)).toEqual([['pdf', 'step', 'dxf'], ['step', 'stl'], ['pdf', 'source']])
  })

  it('leaves kinds a caller set on purpose alone', () => {
    const line = { fileVersionId: 'a', outputKinds: ['iges' as const] }
    expect(applyDefaultKinds([line], settings)[0]).toBe(line)
  })
})

const order = (id: string, sequence: number): SupplyOrder => ({
  id,
  orgId: 'o',
  sequence,
  orderNumber: `ORD-${sequence}`,
  title: id,
  purpose: 'purchase',
  status: 'draft',
  supplierId: null,
  supplierName: null,
  dueDate: null,
  notes: null,
  lineCount: 1,
  createdBy: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedBy: null,
  updatedAt: null,
  sentBy: null,
  sentAt: null,
  receivedAt: null,
  closedAt: null,
  cancelledAt: null,
})

describe('groupFileOrders', () => {
  it('groups pins per order, newest order first, with distinct versions', () => {
    const out = groupFileOrders(
      [
        { orderId: 'a', version: 3, asDrawing: false },
        { orderId: 'a', version: 5, asDrawing: false },
        { orderId: 'a', version: 3, asDrawing: true },
        { orderId: 'b', version: null, asDrawing: false },
        { orderId: 'gone', version: 1, asDrawing: false },
      ],
      [order('a', 1), order('b', 2)],
    )
    expect(out.map((e) => e.order.id)).toEqual(['b', 'a'])
    expect(out[1]).toMatchObject({ versions: [5, 3], asDrawing: true })
    expect(out[0].versions).toEqual([])
  })
})

describe('toHiddenLineVaults', () => {
  it('maps rows, drops odd ones and sorts by count', () => {
    expect(
      toHiddenLineVaults([
        { vault_id: 'v1', vault_name: 'Archive', count: 1 },
        { vault_id: 'v2', vault_name: 'Electronics', count: '3' },
        { vault_id: '', vault_name: 'x', count: 2 },
        { vault_id: 'v3', vault_name: null, count: 0 },
        'junk',
      ]),
    ).toEqual([
      { vaultId: 'v2', vaultName: 'Electronics', count: 3 },
      { vaultId: 'v1', vaultName: 'Archive', count: 1 },
    ])
    expect(toHiddenLineVaults(null)).toEqual([])
  })
})
