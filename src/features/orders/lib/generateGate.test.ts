import { describe, expect, it, vi } from 'vitest'

import { saveOrderOrgSettings } from '@/features/settings/organization/ordersSettingsSave'

import { canGenerateHere } from './generateGate'

describe('canGenerateHere (Generate missing vs Request missing)', () => {
  it('offers Generate only on the desktop with the service running and SOLIDWORKS installed', () => {
    expect(canGenerateHere(true, { running: true, swInstalled: true })).toBe(true)
  })

  it('requests before the first status check (running false, installed unknown)', () => {
    expect(canGenerateHere(true, { running: false })).toBe(false)
    expect(canGenerateHere(true, undefined)).toBe(false)
  })

  it('requests without SOLIDWORKS, with the service stopped, or on the web', () => {
    expect(canGenerateHere(true, { running: true, swInstalled: false })).toBe(false)
    expect(canGenerateHere(true, { running: true })).toBe(false)
    expect(canGenerateHere(true, { running: false, swInstalled: true })).toBe(false)
    expect(canGenerateHere(false, { running: true, swInstalled: true })).toBe(false)
  })
})

describe('saveOrderOrgSettings', () => {
  it('aborts on a failed re-read and writes nothing', async () => {
    const write = vi.fn()
    const result = await saveOrderOrgSettings(
      { number_prefix: 'PO-' },
      { read: async () => ({ data: null, error: { message: 'connection refused' } }), write },
    )
    expect(result).toEqual({ ok: false, reason: 'read_failed', message: 'connection refused' })
    expect(write).not.toHaveBeenCalled()
  })

  it('aborts when the row cannot be read', async () => {
    const write = vi.fn()
    const result = await saveOrderOrgSettings({ number_prefix: 'PO-' }, { read: async () => ({ data: null, error: null }), write })
    expect(result.ok).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('merges into the freshly read settings, keeping other keys and other line classes', async () => {
    const write = vi.fn(async () => ({ data: { settings: {} }, error: null }))
    const result = await saveOrderOrgSettings(
      { default_kinds: { model: ['step', 'stl'] } },
      {
        read: async () => ({
          data: {
            settings: {
              context_menu: { templates: [] },
              orders: { number_prefix: 'PO-', default_kinds: { drawing: ['pdf'] } },
            },
          },
          error: null,
        }),
        write,
      },
    )
    expect(result.ok).toBe(true)
    expect(write).toHaveBeenCalledWith({
      context_menu: { templates: [] },
      orders: { number_prefix: 'PO-', default_kinds: { drawing: ['pdf'], model: ['step', 'stl'] } },
    })
  })

  it('reports a refused write', async () => {
    const result = await saveOrderOrgSettings(
      { number_prefix: 'PO-' },
      { read: async () => ({ data: { settings: {} }, error: null }), write: async () => ({ data: null, error: { message: 'denied' } }) },
    )
    expect(result).toEqual({ ok: false, reason: 'write_failed', message: 'denied' })
  })
})
