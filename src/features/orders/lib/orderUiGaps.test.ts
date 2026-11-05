/** 5.13.0 UI helpers: requested chips, the missing split, hidden-line text, dropped files. */
import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { LineOutputState, SupplyOrderLine } from '@/types/orders'

import { filesForDraggedPaths, parseDraggedPaths } from './fileDrop'
import { hiddenLinesText } from './hiddenLines'
import { lineOutputChips, splitMissing } from './outputChips'

const line = (id: string, kinds: SupplyOrderLine['outputKinds']): SupplyOrderLine =>
  ({ id, outputKinds: kinds, sentOutputs: null, missingKinds: null, fileId: 'f', fileVersionId: 'v' }) as SupplyOrderLine

const requested = (kind: LineOutputState['kind'], id: string, by: string): LineOutputState => ({
  kind,
  status: 'requested',
  included: true,
  request: { id, status: 'pending', requestedBy: by, requestedAt: '2026-11-04T00:00:00Z' },
})

describe('requested outputs', () => {
  it('shows a requested chip with its request', () => {
    const chips = lineOutputChips(line('a', ['step']), [requested('step', 'r1', 'u1')], true)
    expect(chips.find((c) => c.kind === 'step')).toMatchObject({ state: 'requested', requestId: 'r1', requestedBy: 'u1' })
  })

  it('splits missing into requested and not, with the ids this user may cancel', () => {
    const states = {
      a: [requested('step', 'r1', 'u1'), { kind: 'pdf', status: 'missing', included: true } as LineOutputState],
      b: [requested('step', 'r2', 'u2'), { kind: 'source', status: 'missing', included: true } as LineOutputState],
    }
    const split = splitMissing([line('a', ['pdf', 'step']), line('b', ['step', 'source'])], states, (by) => by === 'u1')
    expect(split).toEqual({ unrequested: 1, requested: 2, requestIds: ['r1'] })
  })
})

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key

describe('hiddenLinesText', () => {
  it('gives the count alone without the summary', () => {
    expect(hiddenLinesText(2, null, t)).toBe('orders.hiddenLinesMany(count=2)')
  })

  it('names one vault, or several, and says who to ask', () => {
    expect(hiddenLinesText(1, [{ vaultId: 'v', vaultName: 'Electronics', count: 1 }], t)).toBe(
      'orders.hiddenLinesInVaultOne(vault=Electronics) orders.hiddenLinesAsk',
    )
    const many = hiddenLinesText(
      7,
      [
        { vaultId: 'a', vaultName: 'A', count: 3 },
        { vaultId: 'b', vaultName: 'B', count: 2 },
        { vaultId: 'c', vaultName: null, count: 1 },
        { vaultId: 'd', vaultName: 'D', count: 1 },
      ],
      t,
    )
    expect(many).toContain('orders.hiddenLinesInVaults(count=7,vaults=orders.hiddenVaultsAndMore(')
    expect(many).toContain('vault=orders.hiddenVaultUnnamed')
    expect(many.endsWith('orders.hiddenLinesAsk')).toBe(true)
  })
})

describe('dropped files', () => {
  const file = (relativePath: string, extra: Partial<LocalFile> = {}): LocalFile =>
    ({
      name: relativePath.split('/').pop() ?? relativePath,
      path: `C:\\Vault\\${relativePath.replace(/\//g, '\\')}`,
      relativePath,
      extension: `.${relativePath.split('.').pop()}`,
      isDirectory: false,
      pdmData: { id: relativePath },
      ...extra,
    }) as LocalFile

  it('reads the drag data defensively', () => {
    expect(parseDraggedPaths('["a","",3]')).toEqual(['a'])
    expect(parseDraggedPaths('not json')).toEqual([])
    expect(parseDraggedPaths('')).toEqual([])
  })

  it('matches relative and absolute paths in any case, and keeps what can be ordered', () => {
    const files = [
      file('Pump/PMP-2000.SLDASM'),
      file('Pump/New.SLDPRT', { pdmData: undefined }),
      file('Pump', { isDirectory: true }),
    ]
    const { found, orderable } = filesForDraggedPaths(
      ['pump/pmp-2000.sldasm', 'C:/Vault/Pump/New.SLDPRT', 'Pump', 'Pump/PMP-2000.SLDASM', 'missing'],
      files,
    )
    expect(found.map((f) => f.relativePath)).toEqual(['Pump/PMP-2000.SLDASM', 'Pump/New.SLDPRT', 'Pump'])
    expect(orderable.map((f) => f.relativePath)).toEqual(['Pump/PMP-2000.SLDASM'])
  })
})
