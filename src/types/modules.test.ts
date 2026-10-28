import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MODULE_ORDER,
  MODULES,
  MODULES_MOVED_TO_EXTENSIONS,
  mergeModuleOrder,
  type ModuleId,
} from './modules'

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
