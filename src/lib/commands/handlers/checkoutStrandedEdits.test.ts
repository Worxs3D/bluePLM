import { describe, expect, it, vi } from 'vitest'

import type { StrandedEditSource } from '@/lib/metadata/strandedEdits'

import { confirmDroppingStrandedEdits, describeStrandedEdit } from './checkoutStrandedEdits'

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

const OPERATION_ID = 'checkout-test'

function file(overrides: Partial<StrandedEditSource> = {}): StrandedEditSource {
  return {
    path: 'C:\\Vault\\ELEC\\A.SLDPRT',
    relativePath: 'ELEC/A.SLDPRT',
    pdmData: { id: 'file-a', checked_out_by: null },
    ...overrides,
  }
}

const stranded = file({ pendingMetadata: { part_number: 'BR-107599', description: '' } })

describe('confirmDroppingStrandedEdits', () => {
  it('asks nothing when no file carries stranded edits', async () => {
    const confirm = vi.fn()
    const result = await confirmDroppingStrandedEdits([file()], { confirm }, OPERATION_ID)
    expect(result.proceed).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('lists each stranded file with its values and lets the user stop the checkout', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const result = await confirmDroppingStrandedEdits([stranded, file()], { confirm }, OPERATION_ID)

    expect(result.proceed).toBe(false)
    expect(result.stranded).toHaveLength(1)
    expect(confirm).toHaveBeenCalledTimes(1)
    const [{ items, title, confirmText }] = confirm.mock.calls[0] as [
      { items: string[]; title: string; confirmText: string },
    ]
    expect(items).toEqual([describeStrandedEdit(result.stranded[0])])
    expect(items[0]).toContain('ELEC/A.SLDPRT')
    expect(items[0]).toContain('BR-107599')
    expect(title).toContain('1')
    expect(confirmText.length).toBeGreaterThan(0)
  })

  it('goes ahead only after an explicit confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const result = await confirmDroppingStrandedEdits([stranded], { confirm }, OPERATION_ID)
    expect(result.proceed).toBe(true)
  })

  it('refuses rather than dropping edits silently when it cannot ask', async () => {
    const result = await confirmDroppingStrandedEdits([stranded], {}, OPERATION_ID)
    expect(result.proceed).toBe(false)
    expect(result.stranded).toHaveLength(1)
  })
})

describe('describeStrandedEdit', () => {
  it('names the value, a cleared field and a configuration map', () => {
    const text = describeStrandedEdit({
      path: 'C:\\Vault\\ELEC\\A.SLDPRT',
      relativePath: 'ELEC/A.SLDPRT',
      fields: ['part_number', 'description', 'config_tabs'],
      pending: { part_number: 'BR-1', description: '', config_tabs: { Default: '01' } },
    })
    expect(text).toBe(
      'ELEC/A.SLDPRT: Item number "BR-1"; Description cleared; Configuration tab numbers in 1 configurations',
    )
  })
})
