import { describe, expect, it } from 'vitest'

import { getDefaultModuleConfig } from '@/types/modules'
import { isExtensionWorkspaceVisible } from '@/lib/nativeExtensions/registry'

import { isExtensionModuleEnabled, setExtensionModuleEnabled } from './extensionModules'

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
