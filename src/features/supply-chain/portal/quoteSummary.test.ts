import { describe, expect, it } from 'vitest'

import type { OrderPurpose, OrderStatus, SupplyOrder } from '@/types/orders'

import { quoteSummary } from './quoteSummary'

function order(sequence: number, purpose: OrderPurpose, status: OrderStatus): SupplyOrder {
  return {
    id: `o${sequence}`,
    orgId: 'org',
    sequence,
    orderNumber: `ORD-${sequence}`,
    title: `Order ${sequence}`,
    purpose,
    status,
    supplierId: null,
    supplierName: null,
    dueDate: null,
    notes: null,
    lineCount: 0,
    createdBy: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedBy: null,
    updatedAt: null,
    sentBy: null,
    sentAt: null,
    receivedAt: null,
    closedAt: null,
    cancelledAt: null,
  }
}

describe('quoteSummary', () => {
  it('counts open quote orders by status and ignores purchase orders', () => {
    const summary = quoteSummary([
      order(1, 'quote', 'draft'),
      order(2, 'quote', 'draft'),
      order(3, 'quote', 'sent'),
      order(4, 'quote', 'received'),
      order(5, 'quote', 'closed'),
      order(6, 'purchase', 'draft'),
      order(7, 'purchase', 'sent'),
    ])
    expect(summary).toMatchObject({ draft: 2, sent: 1, received: 1 })
  })

  it('lists the newest quote orders that are not cancelled, at most the limit', () => {
    const summary = quoteSummary(
      [
        order(1, 'quote', 'closed'),
        order(4, 'quote', 'cancelled'),
        order(3, 'purchase', 'draft'),
        order(2, 'quote', 'draft'),
        order(5, 'quote', 'sent'),
      ],
      2,
    )
    expect(summary.recent.map((o) => o.sequence)).toEqual([5, 2])
  })

  it('is empty with no quote orders', () => {
    expect(quoteSummary([order(1, 'purchase', 'draft')])).toEqual({
      draft: 0,
      sent: 0,
      received: 0,
      recent: [],
    })
  })
})
