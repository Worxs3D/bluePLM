import { describe, expect, it } from 'vitest'

import type { LineOutputState, SupplyOrder, SupplyOrderLine } from '@/types/orders'

import { addResultMessage, skipReasonCounts } from './addResultMessage'
import { shortDate } from './format'
import { hasAssembly, orderableFiles } from './menuTargets'
import { defaultOrderTitle, filterOrders, recentDraftOrders } from './orderList'
import {
  isPurgedLine,
  lineOutputChips,
  livingLines,
  missingCount,
  missingOutputs,
  toggleOutputKind,
} from './outputChips'
import { parseQuantity } from './quantity'
import { canDeleteOrder, orderStatusActions } from './statusActions'

function order(over: Partial<SupplyOrder> = {}): SupplyOrder {
  return {
    id: 'o1',
    orgId: 'org',
    sequence: 1,
    orderNumber: 'ORD-0001',
    title: 'Brackets',
    purpose: 'purchase',
    status: 'draft',
    supplierId: null,
    supplierName: null,
    dueDate: null,
    notes: null,
    lineCount: 0,
    createdBy: 'u1',
    createdAt: '2026-11-01T10:00:00Z',
    updatedBy: null,
    updatedAt: null,
    sentBy: null,
    sentAt: null,
    receivedAt: null,
    closedAt: null,
    cancelledAt: null,
    ...over,
  }
}

function line(over: Partial<SupplyOrderLine> = {}): SupplyOrderLine {
  return {
    id: 'l1',
    orderId: 'o1',
    orgId: 'org',
    position: 1,
    fileId: 'f1',
    fileVersionId: 'v1',
    vaultId: 'vault',
    configuration: null,
    drawingFileId: null,
    drawingVersionId: null,
    drawingVaultId: null,
    quantity: 1,
    outputKinds: ['pdf', 'step'],
    notes: null,
    fileName: 'bracket.sldprt',
    partNumber: 'P-100',
    description: null,
    revision: 'A',
    version: 3,
    drawingFileName: null,
    drawingVersion: null,
    sentOutputs: null,
    missingKinds: null,
    addedBy: null,
    addedAt: '2026-11-01T10:00:00Z',
    updatedAt: null,
    ...over,
  }
}

const state = (kind: LineOutputState['kind'], status: LineOutputState['status'], included = true): LineOutputState => ({
  kind,
  status,
  included,
})

describe('filterOrders', () => {
  const orders = [
    order({ id: 'a', status: 'draft', title: 'Brackets', supplierName: 'Acme Machining' }),
    order({ id: 'b', status: 'closed', orderNumber: 'ORD-0002', title: 'Housings' }),
    order({ id: 'c', status: 'cancelled', orderNumber: 'ORD-0003', title: 'Brackets v2' }),
    order({ id: 'd', status: 'received', orderNumber: 'ORD-0004', title: 'Shafts' }),
  ]

  it('shows only draft, sent and received orders under Open', () => {
    expect(filterOrders(orders, 'open', '').map((o) => o.id)).toEqual(['a', 'd'])
    expect(filterOrders(orders, 'all', '').map((o) => o.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('matches every word in number, title or supplier, ignoring case', () => {
    expect(filterOrders(orders, 'all', 'brackets').map((o) => o.id)).toEqual(['a', 'c'])
    expect(filterOrders(orders, 'all', 'acme BRACK').map((o) => o.id)).toEqual(['a'])
    expect(filterOrders(orders, 'all', '0002').map((o) => o.id)).toEqual(['b'])
    expect(filterOrders(orders, 'open', 'housings')).toEqual([])
  })
})

describe('recentDraftOrders', () => {
  it('keeps drafts only, most recently changed first, at most five', () => {
    const list = [
      order({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      order({ id: 'sent', status: 'sent', updatedAt: '2026-12-01T00:00:00Z' }),
      order({ id: 'new', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z' }),
      ...['1', '2', '3', '4'].map((n) =>
        order({ id: `d${n}`, createdAt: `2026-10-0${n}T00:00:00Z` }),
      ),
    ]
    const ids = recentDraftOrders(list).map((o) => o.id)
    expect(ids).toEqual(['new', 'd4', 'd3', 'd2', 'd1'])
  })
})

describe('defaultOrderTitle', () => {
  const format = (key: 'one' | 'many', p: { first: string; count: number }) =>
    key === 'one' ? p.first : `${p.first} +${p.count}`

  it('uses the part number, else the name without its extension', () => {
    expect(defaultOrderTitle([{ partNumber: 'P-1', name: 'a.sldprt' }], format)).toBe('P-1')
    expect(defaultOrderTitle([{ partNumber: ' ', name: 'a.b.sldprt' }], format)).toBe('a.b')
    expect(
      defaultOrderTitle([{ name: 'a.sldasm' }, { name: 'b.sldprt' }, { name: 'c.slddrw' }], format),
    ).toBe('a +2')
    expect(defaultOrderTitle([], format)).toBeNull()
  })
})

describe('orderStatusActions', () => {
  const ids = (status: SupplyOrder['status'], allowed: SupplyOrder['status'][]) =>
    orderStatusActions(status, allowed).map((a) => `${a.id}:${a.placement}:${a.primary ? 'p' : '-'}`)

  it('offers Mark sent as the one primary in a draft, Cancel in the menu', () => {
    expect(ids('draft', ['sent', 'cancelled'])).toEqual(['send:bar:p', 'cancel:overflow:-'])
  })

  it('offers Mark received, Reopen and Cancel for a sent order', () => {
    expect(ids('sent', ['received', 'draft', 'cancelled'])).toEqual([
      'receive:bar:p',
      'reopen:bar:-',
      'cancel:overflow:-',
    ])
  })

  it('offers Close for a received order and Restore for a cancelled one', () => {
    expect(ids('received', ['closed', 'cancelled'])).toEqual(['close:bar:p', 'cancel:overflow:-'])
    expect(ids('cancelled', ['draft'])).toEqual(['restore:bar:p'])
    expect(ids('closed', [])).toEqual([])
  })

  it('leaves out Send when the server rules leave it out (an empty draft)', () => {
    expect(ids('draft', ['cancelled'])).toEqual(['cancel:overflow:-'])
  })

  it('marks Cancel as danger and moves to the target given', () => {
    const cancel = orderStatusActions('sent', ['cancelled'])[0]
    expect(cancel).toMatchObject({ id: 'cancel', target: 'cancelled', danger: true })
  })
})

describe('canDeleteOrder', () => {
  it('allows the creator or an admin, on drafts and cancelled orders only', () => {
    expect(canDeleteOrder(order(), 'u1', false)).toBe(true)
    expect(canDeleteOrder(order(), 'u2', false)).toBe(false)
    expect(canDeleteOrder(order(), 'u2', true)).toBe(true)
    expect(canDeleteOrder(order({ status: 'cancelled' }), 'u1', false)).toBe(true)
    expect(canDeleteOrder(order({ status: 'sent' }), 'u1', true)).toBe(false)
    expect(canDeleteOrder(order({ createdBy: null }), null, false)).toBe(false)
  })
})

describe('lineOutputChips', () => {
  it('shows included kinds by state and offers the other possible kinds in a draft', () => {
    const states = [
      state('pdf', 'ready'),
      state('step', 'missing'),
      state('iges', 'missing', false),
      state('stl', 'missing', false),
      state('dxf', 'unsupported', false),
      state('source', 'ready', false),
    ]
    const chips = lineOutputChips(line(), states, true)
    expect(chips.map((c) => `${c.kind}:${c.state}:${c.toggleable}`)).toEqual([
      'pdf:ready:true',
      'step:missing:true',
      'iges:excluded:true',
      'stl:excluded:true',
      'source:excluded:true',
    ])
  })

  it('shows only included kinds, read-only, when not editable', () => {
    const chips = lineOutputChips(line(), [state('pdf', 'ready')], false)
    expect(chips.map((c) => `${c.kind}:${c.state}:${c.toggleable}`)).toEqual([
      'pdf:ready:false',
      'step:checking:false',
    ])
  })

  it('reads a sent line from what was recorded, never the current states', () => {
    const sent = line({
      sentOutputs: [{ kind: 'pdf', storageHash: 'h', fileSize: 1, fileName: 'P-100.pdf' }],
      missingKinds: ['step'],
    })
    const chips = lineOutputChips(sent, [state('pdf', 'missing'), state('step', 'ready')], true)
    expect(chips).toEqual([
      { kind: 'pdf', state: 'ready', toggleable: false, fileName: 'P-100.pdf' },
      { kind: 'step', state: 'missing', toggleable: false, fileName: null },
    ])
  })

  it('marks an included kind the line cannot have as unsupported', () => {
    const chips = lineOutputChips(line({ outputKinds: ['dxf'] }), [state('dxf', 'unsupported')], false)
    expect(chips[0].state).toBe('unsupported')
  })
})

describe('toggleOutputKind', () => {
  it('adds and removes a kind, keeping the chip order', () => {
    expect(toggleOutputKind(['step'], 'pdf')).toEqual(['pdf', 'step'])
    expect(toggleOutputKind(['pdf', 'step'], 'pdf')).toEqual(['step'])
    expect(toggleOutputKind([], 'source')).toEqual(['source'])
  })
})

describe('missingOutputs', () => {
  it('lists included kinds without a ready output, counting unknown states as missing', () => {
    const a = line({ id: 'a', outputKinds: ['pdf', 'step'] })
    const b = line({ id: 'b', outputKinds: ['step'] })
    const c = line({ id: 'c', outputKinds: ['step'] })
    const missing = missingOutputs([a, b, c], {
      a: [state('pdf', 'ready'), state('step', 'missing')],
      b: [state('step', 'ready')],
    })
    expect(missing.map((m) => [m.line.id, m.kinds])).toEqual([
      ['a', ['step']],
      ['c', ['step']],
    ])
    expect(missingCount(missing)).toBe(2)
    expect(missingOutputs([b], { b: [state('step', 'ready')] })).toEqual([])
  })
})

describe('addResultMessage', () => {
  it('says what was added and updated', () => {
    expect(
      addResultMessage({ orderNumber: 'ORD-1', added: 2, updated: 1, plannerSkipped: [], serverSkipped: [] }),
    ).toEqual({
      tone: 'success',
      parts: [
        { key: 'toastAddedMany', params: { count: 2, order: 'ORD-1' } },
        { key: 'toastUpdatedOne', params: { count: 1, order: 'ORD-1' } },
      ],
    })
  })

  it('warns with each skip reason, most frequent first', () => {
    const message = addResultMessage({
      orderNumber: 'ORD-1',
      added: 1,
      updated: 0,
      plannerSkipped: [{ reason: 'folder' }, { reason: 'not-checked-in' }, { reason: 'not-checked-in' }],
      serverSkipped: [{ reason: 'NO_VAULT_ACCESS' }],
    })
    expect(message.tone).toBe('warning')
    expect(message.parts.map((p) => p.key)).toEqual([
      'toastAddedOne',
      'skippedManyNotCheckedIn',
      'skippedOneFolder',
      'skippedOneNoVaultAccess',
    ])
  })

  it('says nothing changed when every line was already there', () => {
    expect(
      addResultMessage({ orderNumber: 'ORD-1', added: 0, updated: 0, plannerSkipped: [], serverSkipped: [] }),
    ).toEqual({ tone: 'info', parts: [{ key: 'toastNothingChanged', params: { order: 'ORD-1' } }] })
  })

  it('counts server and planner reasons together', () => {
    expect(
      skipReasonCounts({
        orderNumber: '',
        added: 0,
        updated: 0,
        plannerSkipped: [{ reason: 'unsupported' }],
        serverSkipped: [{ reason: 'NOT_FOUND' }, { reason: 'NOT_FOUND' }, { reason: 'WRONG_ORG' }],
      }),
    ).toEqual([
      ['NotFound', 2],
      ['Unsupported', 1],
      ['WrongOrg', 1],
    ])
  })
})

describe('orderableFiles and hasAssembly', () => {
  const f = (over: Record<string, unknown>) =>
    ({ isDirectory: false, extension: '.sldprt', diffStatus: undefined, pdmData: { id: 'x' }, ...over }) as never

  it('keeps synced files and drops folders, local-only files and move stubs', () => {
    const files = [
      f({}),
      f({ isDirectory: true }),
      f({ pdmData: undefined }),
      f({ diffStatus: 'moved_away' }),
      f({ diffStatus: 'deleted_remote' }),
      f({ diffStatus: 'modified' }),
    ]
    expect(orderableFiles(files)).toHaveLength(2)
  })

  it('finds an assembly in any case', () => {
    expect(hasAssembly([{ extension: '.SLDASM' }])).toBe(true)
    expect(hasAssembly([{ extension: '.sldprt' }, { extension: '.slddrw' }])).toBe(false)
  })
})

describe('parseQuantity', () => {
  it('accepts whole numbers of at least 1', () => {
    expect(parseQuantity('3')).toBe(3)
    expect(parseQuantity(' 12 ')).toBe(12)
    expect(parseQuantity('0')).toBeNull()
    expect(parseQuantity('1.5')).toBeNull()
    expect(parseQuantity('-2')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('9'.repeat(20))).toBeNull()
  })
})

describe('isPurgedLine and livingLines', () => {
  it('treats a line without its file or version as purged, kept out of Generate and Update', () => {
    const purged = line({ id: 'p', fileId: null, fileVersionId: null })
    const half = line({ id: 'h', fileVersionId: null })
    const alive = line({ id: 'a' })
    expect(isPurgedLine(purged)).toBe(true)
    expect(isPurgedLine(half)).toBe(true)
    expect(isPurgedLine(alive)).toBe(false)
    expect(livingLines([purged, half, alive]).map((l) => l.id)).toEqual(['a'])
  })
})

describe('shortDate', () => {
  const now = new Date('2026-11-04T12:00:00Z')
  it('leaves out the year in the current year and keeps it otherwise', () => {
    expect(shortDate('2026-11-02', 'en-GB', now)).toBe('2 Nov')
    expect(shortDate('2025-11-02T08:00:00Z', 'en-GB', now)).toBe('2 Nov 2025')
    expect(shortDate(null, 'en-GB', now)).toBeNull()
    expect(shortDate('not a date', 'en-GB', now)).toBeNull()
  })
})
