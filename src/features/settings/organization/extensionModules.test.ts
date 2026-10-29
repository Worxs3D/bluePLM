import { describe, expect, it } from 'vitest'

import { getDefaultModuleConfig } from '@/types/modules'
import {
  isExtensionWorkspaceId,
  isExtensionWorkspaceVisible,
  placeExtensionModules,
} from '@/lib/nativeExtensions/registry'

import {
  getExtensionModulePlacement,
  isExtensionModuleEnabled,
  setExtensionModuleEnabled,
  setExtensionModulePlacement,
} from './extensionModules'

describe('extension module toggle', () => {
  it('treats an extension with no saved value as enabled', () => {
    expect(isExtensionModuleEnabled(getDefaultModuleConfig(), 'customers')).toBe(true)
  })

  it("turns a saved customers: false (core's old default) back on, and the sidebar follows", () => {
    const base = getDefaultModuleConfig()
    const saved = setExtensionModuleEnabled(base, 'customers', false)
    expect(isExtensionModuleEnabled(saved, 'customers')).toBe(false)

    const allow = () => true
    const ws = { id: 'customers', permission: 'module:customers' }
    const enabledOf = (c: typeof base) =>
      c.enabledModules as Readonly<Record<string, boolean | undefined>>
    expect(isExtensionWorkspaceVisible(ws, new Set(), enabledOf(saved), allow)).toBe(false)

    const turnedOn = setExtensionModuleEnabled(saved, 'customers', true)
    expect(isExtensionModuleEnabled(turnedOn, 'customers')).toBe(true)
    expect(isExtensionWorkspaceVisible(ws, new Set(), enabledOf(turnedOn), allow)).toBe(true)
  })

  it('leaves core modules untouched', () => {
    const base = getDefaultModuleConfig()
    const next = setExtensionModuleEnabled(base, 'customers', false)
    expect(next.enabledModules.explorer).toBe(base.enabledModules.explorer)
    expect(next.moduleOrder).toEqual(base.moduleOrder)
  })
})

describe('extension module placement', () => {
  const base = getDefaultModuleConfig()
  const [first, second] = base.moduleOrder

  it('is placed by group until a position is chosen', () => {
    expect(getExtensionModulePlacement(base, 'customers')).toBe('default')
  })

  it('saves a position after a module, and the sidebar follows it', () => {
    const next = setExtensionModulePlacement(base, 'customers', { after: second })
    expect(getExtensionModulePlacement(next, 'customers')).toEqual({ after: second })
    expect((next.moduleOrder as string[]).filter((id) => id !== 'customers')).toEqual(base.moduleOrder)

    const core = base.moduleOrder.map((id) => ({ id, group: null }))
    const placed = placeExtensionModules(
      core,
      [{ id: 'customers', group: 'supply-chain' }],
      next.moduleOrder,
    )
    expect(placed.indexOf('customers')).toBe(placed.indexOf(second) + 1)
  })

  it('moves to the top and back to the group default', () => {
    const top = setExtensionModulePlacement(base, 'customers', 'top')
    expect(top.moduleOrder[0]).toBe('customers')
    expect(getExtensionModulePlacement(top, 'customers')).toBe('top')
    const back = setExtensionModulePlacement(top, 'customers', 'default')
    expect(back.moduleOrder).toEqual(base.moduleOrder)
    expect(back.dividers).toEqual(base.dividers)
    expect(back.customGroups).toEqual(base.customGroups)
  })

  it('keeps every divider after the same module', () => {
    const next = setExtensionModulePlacement(base, 'customers', { after: first })
    const dividerAnchor = (c: typeof base) =>
      c.dividers.map((d) => [d.id, c.moduleOrder[d.position]])
    expect(dividerAnchor(next)).toEqual(dividerAnchor(base))
  })

  it('appends when the anchor is not in the order', () => {
    const next = setExtensionModulePlacement(base, 'customers', { after: 'gone' })
    expect(next.moduleOrder[next.moduleOrder.length - 1]).toBe('customers')
  })
})

describe('isExtensionWorkspaceId', () => {
  it('accepts workspace-shaped ids and rejects core and group ids', () => {
    expect(isExtensionWorkspaceId('customers')).toBe(true)
    expect(isExtensionWorkspaceId('explorer')).toBe(false)
    expect(isExtensionWorkspaceId('group-abc')).toBe(false)
    expect(isExtensionWorkspaceId('Bad Id')).toBe(false)
  })
})
