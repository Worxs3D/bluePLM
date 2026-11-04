import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  // A plain throw, not a spy's: vitest reports an error thrown by a vi.fn() implementation.
  throwNext: null as Error | null,
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => {
      if (h.throwNext) throw h.throwNext
      return h.rpc(...args)
    },
  }),
}))
// Quiet: the refusal paths log a warning.
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { ORDER_STATUS_TRANSITIONS } from '@/types/orders'

import {
  addLinesJson,
  addOrderLines,
  headerPatchJson,
  linePatchJson,
  missingFromDetail,
  orderErrorCode,
  setOrderStatus,
  updateOrder,
} from './api'
import { readAllPages } from './paging'
import { toSupplyOrder, toSupplyOrderLine } from './rows'
import { deletable, headerEditable, linesEditable, nextAllowedStatuses } from './status'

beforeEach(() => {
  h.rpc.mockReset()
  h.throwNext = null
})

describe('rows', () => {
  it('maps an order row and tolerates odd values', () => {
    const order = toSupplyOrder({
      id: 'o',
      org_id: 'org',
      sequence: '12',
      order_number: 'ORD-0012',
      title: 'T',
      purpose: 'quote',
      status: 'weird',
      line_count: 3,
      created_at: 'c',
    })
    expect(order).toMatchObject({ sequence: 12, orderNumber: 'ORD-0012', purpose: 'quote', status: 'draft', lineCount: 3 })
    expect(order.supplierName).toBeNull()
  })

  it('maps a line, keeping only known kinds and valid sent outputs', () => {
    const line = toSupplyOrderLine({
      id: 'l',
      output_kinds: ['step', 'pdf', 'exe'],
      sent_outputs: [
        { kind: 'step', storage_hash: 'h', file_size: '9', file_name: 'a.step' },
        { kind: 'bogus', storage_hash: 'x' },
        { kind: 'pdf' },
      ],
      missing_kinds: ['dxf'],
      quantity: null,
      version: 3,
      drawing_version: null,
    })
    expect(line.outputKinds).toEqual(['pdf', 'step'])
    expect(line.sentOutputs).toEqual([{ kind: 'step', storageHash: 'h', fileSize: 9, fileName: 'a.step' }])
    expect(line.missingKinds).toEqual(['dxf'])
    expect(line.quantity).toBe(1)
    expect(line.drawingVersion).toBeNull()
    expect(toSupplyOrderLine({ sent_outputs: null }).sentOutputs).toBeNull()
  })
})

describe('readAllPages', () => {
  it('reads every row, even from a server that caps pages below the size asked for', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }))
    const asked: Array<[number, number]> = []
    const query = async (from: number, to: number) => {
      asked.push([from, to])
      // The server's max-rows is 2, whatever range is asked for.
      return { data: rows.slice(from, Math.min(to + 1, from + 2)), error: null }
    }
    expect((await readAllPages(query, 5)).map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(asked[0]).toEqual([0, 4])
    expect(asked[asked.length - 1][0]).toBe(7)
  })

  it('throws on a query error', async () => {
    await expect(readAllPages(async () => ({ data: null, error: { message: 'denied' } }))).rejects.toThrow('denied')
  })
})

describe('patches', () => {
  it('sends only the keys given, null clears', () => {
    expect(headerPatchJson({ title: 'x', supplierId: null })).toEqual({ title: 'x', supplier_id: null })
    expect(linePatchJson({ quantity: 2, drawingVersionId: null })).toEqual({ quantity: 2, drawing_version_id: null })
    expect(addLinesJson([{ fileVersionId: 'v', outputKinds: ['step'] }])).toEqual([
      { file_version_id: 'v', output_kinds: ['step'] },
    ])
  })
})

describe('RPC results', () => {
  it('maps a refusal hint to its code, anything else to UNKNOWN', () => {
    expect(orderErrorCode({ hint: 'NOT_DRAFT' })).toBe('NOT_DRAFT')
    expect(orderErrorCode({ hint: 'SOMETHING' })).toBe('UNKNOWN')
    expect(orderErrorCode(null)).toBe('UNKNOWN')
  })

  it('returns the order of a successful write', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, order: { id: 'o', status: 'draft', sequence: 1 } }, error: null })
    const result = await updateOrder('o', { title: 'New' })
    expect(h.rpc).toHaveBeenCalledWith('supply_order_update', { p_order_id: 'o', p_patch: { title: 'New' } })
    expect(result.ok && result.order.id).toBe('o')
  })

  it('returns a refusal, with the missing outputs a send names', async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'missing',
        code: 'P0001',
        hint: 'MISSING_OUTPUTS',
        details: JSON.stringify([{ line_id: 'l1', kinds: ['pdf', 'nope'] }]),
      },
    })
    const result = await setOrderStatus('o', 'sent')
    expect(h.rpc).toHaveBeenCalledWith('supply_order_set_status', { p_order_id: 'o', p_status: 'sent', p_allow_missing: false })
    expect(result).toEqual({ ok: false, code: 'MISSING_OUTPUTS', message: 'missing', missing: [{ lineId: 'l1', kinds: ['pdf'] }] })
  })

  it('never throws: a thrown client error is UNKNOWN', async () => {
    h.throwNext = new Error('network')
    expect(await addOrderLines('o', [])).toEqual({ ok: false, code: 'UNKNOWN', message: 'network' })
  })

  it('maps add_lines counts and skip reasons', async () => {
    h.rpc.mockResolvedValue({
      data: { ok: true, added: 2, updated: 1, skipped: [{ file_version_id: 'v', reason: 'NO_VAULT_ACCESS' }] },
      error: null,
    })
    expect(await addOrderLines('o', [{ fileVersionId: 'v' }])).toEqual({
      ok: true,
      added: 2,
      updated: 1,
      skipped: [{ fileVersionId: 'v', reason: 'NO_VAULT_ACCESS' }],
    })
  })

  it('reads no missing list from a detail that is not one', () => {
    expect(missingFromDetail('plain text')).toBeUndefined()
    expect(missingFromDetail(null)).toBeUndefined()
  })
})

describe('status rules', () => {
  it('follows the transition table, and does not offer sending an empty order', () => {
    expect(nextAllowedStatuses({ status: 'draft', lineCount: 2 })).toEqual(['sent', 'cancelled'])
    expect(nextAllowedStatuses({ status: 'draft', lineCount: 0 })).toEqual(['cancelled'])
    expect(nextAllowedStatuses({ status: 'sent', lineCount: 1 })).toEqual(['received', 'draft', 'cancelled'])
    expect(nextAllowedStatuses({ status: 'closed', lineCount: 1 })).toEqual([])
    expect(nextAllowedStatuses({ status: 'cancelled', lineCount: 1 })).toEqual(['draft'])
    expect(ORDER_STATUS_TRANSITIONS.received).toEqual(['closed', 'cancelled'])
  })

  it('says what can be edited and deleted', () => {
    expect(linesEditable({ status: 'draft' })).toBe(true)
    expect(linesEditable({ status: 'sent' })).toBe(false)
    expect(headerEditable({ status: 'received' })).toBe(true)
    expect(headerEditable({ status: 'closed' })).toBe(false)
    expect(deletable({ status: 'cancelled' })).toBe(true)
    expect(deletable({ status: 'sent' })).toBe(false)
  })
})
