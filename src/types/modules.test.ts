import { describe, expect, it } from 'vitest'

import { insertModuleAfter, runMigrations } from '@/stores/migrations'

import {
  buildCombinedOrderList,
  DEFAULT_CUSTOM_GROUPS,
  DEFAULT_DIVIDERS,
  DEFAULT_MODULE_ORDER,
  DEFAULT_MODULE_PARENT_MAP,
  MODULES,
  MODULES_MOVED_TO_EXTENSIONS,
  mergeModuleLayout,
  mergeModuleOrder,
  type ModuleId,
} from './modules'

describe('mergeModuleLayout', () => {
  type P = { id: string; position: number }
  const ids = (list: string[]) => list as ModuleId[]

  it('keeps a new module on its neighbour side of a divider', () => {
    const merged = mergeModuleLayout(
      { moduleOrder: ids(['a', 'b', 'c']), dividers: [{ id: 'd', position: 1 }] as P[], customGroups: [] as P[] },
      ids(['a', 'b', 'new', 'c']),
    )
    expect(merged.moduleOrder).toEqual(['a', 'b', 'new', 'c'])
    expect(merged.dividers).toEqual([{ id: 'd', position: 2 }])
  })

  it('stays out of the group that starts after its neighbour', () => {
    const merged = mergeModuleLayout(
      { moduleOrder: ids(['a', 'b', 'c']), dividers: [] as P[], customGroups: [{ id: 'g', position: 2 }] as P[] },
      ids(['a', 'b', 'new', 'c']),
    )
    expect(merged.moduleOrder).toEqual(['a', 'b', 'new', 'c'])
    expect(merged.customGroups).toEqual([{ id: 'g', position: 3 }])
  })

  it('joins the group of the neighbour it is placed before', () => {
    const merged = mergeModuleLayout(
      {
        moduleOrder: ids(['b', 'c']),
        dividers: [{ id: 'd', position: 0 }] as P[],
        customGroups: [{ id: 'g', position: 0 }] as P[],
      },
      ids(['new', 'b', 'c']),
    )
    expect(merged.moduleOrder).toEqual(['new', 'b', 'c'])
    expect(merged.customGroups).toEqual([{ id: 'g', position: 0 }])
    expect(merged.dividers).toEqual([{ id: 'd', position: 1 }])
  })

  it('puts Orders above the default divider in an org layout saved before 5.11', () => {
    const before = DEFAULT_MODULE_ORDER.filter((id) => id !== 'orders')
    const merged = mergeModuleLayout({
      moduleOrder: before,
      dividers: [{ id: 'divider-1', enabled: true, position: before.indexOf('items') }],
      customGroups: [...DEFAULT_CUSTOM_GROUPS],
    })
    expect(merged.moduleOrder).toEqual([...DEFAULT_MODULE_ORDER])
    expect(merged.dividers).toEqual([...DEFAULT_DIVIDERS])
    expect(merged.customGroups).toEqual([...DEFAULT_CUSTOM_GROUPS])
  })
})

describe('mergeModuleOrder', () => {
  it('leaves an order that already has every module untouched', () => {
    expect(mergeModuleOrder([...DEFAULT_MODULE_ORDER])).toEqual([...DEFAULT_MODULE_ORDER])
  })

  it('returns the defaults when nothing has been saved yet', () => {
    expect(mergeModuleOrder([])).toEqual([...DEFAULT_MODULE_ORDER])
  })

  it('restores a missing module next to its default neighbour rather than appending', () => {
    const defaults = ['a', 'b', 'c', 'settings'] as unknown as ModuleId[]
    const saved = ['a', 'c', 'settings'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toEqual(['a', 'b', 'c', 'settings'])
  })

  it('follows the section the user moved rather than the default position', () => {
    const defaults = ['a', 'b', 'new', 'c'] as unknown as ModuleId[]
    const saved = ['c', 'b', 'a'] as unknown as ModuleId[]

    // 'new' sits after 'b' in the defaults, so it follows 'b' to its new home.
    expect(mergeModuleOrder(saved, defaults)).toEqual(['c', 'b', 'new', 'a'])
  })

  it('keeps consecutive new modules in their default relative order', () => {
    const defaults = ['a', 'x', 'y', 'z', 'b'] as unknown as ModuleId[]
    const saved = ['a', 'b'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toEqual(['a', 'x', 'y', 'z', 'b'])
  })

  it('anchors forwards when nothing before the new module is present', () => {
    const defaults = ['a', 'b', 'c'] as unknown as ModuleId[]
    const saved = ['c'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toEqual(['a', 'b', 'c'])
  })

  it('preserves entries that are no longer in the defaults', () => {
    const defaults = ['a', 'b'] as unknown as ModuleId[]
    const saved = ['a', 'retired'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toContain('retired')
  })

  it('keeps Customers where an order saved while it was core had it', () => {
    // Customers is now the blueplm.customers extension, registered under the
    // same id; the saved position is what places its workspace.
    expect(DEFAULT_MODULE_ORDER).not.toContain('customers')
    expect(MODULES.some((m) => (m.id as string) === 'customers')).toBe(false)
    expect(MODULES_MOVED_TO_EXTENSIONS).toContain('customers')

    const itemsAt = DEFAULT_MODULE_ORDER.indexOf('items')
    const saved = [
      ...DEFAULT_MODULE_ORDER.slice(0, itemsAt + 1),
      'customers',
      ...DEFAULT_MODULE_ORDER.slice(itemsAt + 1),
    ] as ModuleId[]

    const merged = mergeModuleOrder(saved)

    expect(merged).toEqual(saved)
    expect(merged.indexOf('customers' as ModuleId)).toBe(itemsAt + 1)
  })
})

describe('the Orders module (5.11.0)', () => {
  it('is a default-on, top-level Supply Chain module that also runs on the web', () => {
    const orders = MODULES.find((m) => m.id === 'orders')
    expect(orders).toMatchObject({
      group: 'supply-chain',
      icon: 'ShoppingCart',
      defaultEnabled: true,
      implemented: true,
    })
    expect(orders?.desktopOnly).toBeFalsy()
    expect(DEFAULT_MODULE_PARENT_MAP.orders).toBeNull()
  })

  it('sits right after the Item Browser, before the divider to Integrations', () => {
    const itemsAt = DEFAULT_MODULE_ORDER.indexOf('items')
    expect(DEFAULT_MODULE_ORDER[itemsAt + 1]).toBe('orders')
    const ids = buildCombinedOrderList(
      DEFAULT_MODULE_ORDER,
      DEFAULT_DIVIDERS,
      DEFAULT_CUSTOM_GROUPS,
    ).map((i) => i.id)
    const at = ids.indexOf('items')
    expect(ids.slice(at, at + 4)).toEqual(['items', 'orders', 'divider-1', 'google-drive'])
  })

  it('keeps the rest of the default sidebar as it was before Orders', () => {
    const before = buildCombinedOrderList(
      DEFAULT_MODULE_ORDER.filter((id) => id !== 'orders'),
      DEFAULT_DIVIDERS.map((d) => ({ ...d, position: d.position - 1 })),
      DEFAULT_CUSTOM_GROUPS,
    ).map((i) => i.id)
    const after = buildCombinedOrderList(DEFAULT_MODULE_ORDER, DEFAULT_DIVIDERS, DEFAULT_CUSTOM_GROUPS)
      .map((i) => i.id)
      .filter((id) => id !== 'orders')
    expect(after).toEqual(before)
  })
})

describe('store migration 14: Orders in a saved sidebar', () => {
  const saved = {
    moduleConfig: {
      moduleOrder: ['explorer', 'items', 'google-drive', 'settings'],
      dividers: [
        { id: 'divider-1', enabled: true, position: 1 },
        { id: 'divider-0', enabled: true, position: 0 },
      ],
      customGroups: [
        { id: 'group-a', position: 0 },
        { id: 'group-b', position: 2 },
      ],
    },
  }

  it('puts Orders after the Item Browser and keeps dividers and group headers in place', () => {
    const out = insertModuleAfter(saved, 'orders', 'items')
    const config = out.moduleConfig as typeof saved.moduleConfig
    expect(config.moduleOrder).toEqual(['explorer', 'items', 'orders', 'google-drive', 'settings'])
    // The divider after the Item Browser now follows Orders; the one after Explorer stays.
    expect(config.dividers).toEqual([
      { id: 'divider-1', enabled: true, position: 2 },
      { id: 'divider-0', enabled: true, position: 0 },
    ])
    // A header before Google Drive stays before it.
    expect(config.customGroups).toEqual([
      { id: 'group-a', position: 0 },
      { id: 'group-b', position: 3 },
    ])
  })

  it('leaves an order that already has Orders, or has no Item Browser, alone', () => {
    const has = { moduleConfig: { moduleOrder: ['items', 'orders'] } }
    expect(insertModuleAfter(has, 'orders', 'items')).toBe(has)
    const noItems = { moduleConfig: { moduleOrder: ['explorer'] } }
    expect(insertModuleAfter(noItems, 'orders', 'items')).toBe(noItems)
    expect(insertModuleAfter({}, 'orders', 'items')).toEqual({})
  })

  it('runs for state saved at version 13', () => {
    const out = runMigrations(saved, 13)
    expect((out.moduleConfig as typeof saved.moduleConfig).moduleOrder).toContain('orders')
    expect(out._storeVersion).toBe(14)
  })
})
