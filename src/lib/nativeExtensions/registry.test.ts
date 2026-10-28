import { describe, expect, it } from 'vitest'

import {
  CORE_VIEW_IDS,
  WorkspaceRegistrationError,
  isExtensionWorkspaceVisible,
  placeExtensionModules,
  validateWorkspaceRegistration,
} from './registry'
import type { ExtensionWorkspace, WorkspaceRegistration } from '@/types/nativeExtensions'

const Component = () => null

function reg(overrides: Partial<WorkspaceRegistration> = {}): WorkspaceRegistration {
  return { id: 'widgets', title: 'Widgets', icon: 'Box', Workspace: Component, ...overrides }
}

describe('validateWorkspaceRegistration', () => {
  it('keeps the id verbatim and normalizes optional parts', () => {
    const ws = validateWorkspaceRegistration('acme.widgets', reg({ group: 'supply-chain' }), [])
    expect(ws).toMatchObject({
      extensionId: 'acme.widgets',
      id: 'widgets',
      group: 'supply-chain',
      permission: null,
      Navigator: null,
      RightPanel: null,
    })
  })

  it('maps an unknown group to none (placed before System)', () => {
    expect(validateWorkspaceRegistration('acme.widgets', reg({ group: 'business' }), []).group).toBeNull()
  })

  it.each(['explorer', 'settings', 'items'])('refuses core module id %s', (id) => {
    expect(CORE_VIEW_IDS.has(id)).toBe(true)
    expect(() => validateWorkspaceRegistration('acme.widgets', reg({ id }), [])).toThrow(
      /already a core module/,
    )
  })

  it('accepts customers, which left core for the blueplm.customers extension', () => {
    expect(CORE_VIEW_IDS.has('customers')).toBe(false)
    expect(validateWorkspaceRegistration('blueplm.customers', reg({ id: 'customers' }), []).id).toBe(
      'customers',
    )
  })

  it("refuses another extension's id, and a duplicate from the same extension", () => {
    const existing: ExtensionWorkspace[] = [
      validateWorkspaceRegistration('acme.other', reg(), []),
    ]
    expect(() => validateWorkspaceRegistration('acme.widgets', reg(), existing)).toThrow(
      /already registered by acme.other/,
    )
    expect(() => validateWorkspaceRegistration('acme.other', reg(), existing)).toThrow(
      /already registered by this extension/,
    )
  })

  it.each([
    [reg({ id: 'Bad Id' }), /lowercase/],
    [reg({ id: 'group-x' }), /lowercase/],
    [reg({ title: ' ' }), /title/],
    [reg({ Workspace: 'nope' as unknown as typeof Component }), /Workspace component/],
    [reg({ Navigator: 42 as unknown as typeof Component }), /Navigator/],
    [reg({ permission: '' }), /permission/],
  ])('refuses a malformed registration %#', (registration, message) => {
    expect(() => validateWorkspaceRegistration('acme.widgets', registration, [])).toThrow(message)
    expect(() => validateWorkspaceRegistration('acme.widgets', registration, [])).toThrow(
      WorkspaceRegistrationError,
    )
  })
})

describe('placeExtensionModules', () => {
  const core = [
    { id: 'explorer', group: 'source-files' as const },
    { id: 'supplier-database', group: 'supply-chain-suppliers' as const },
    { id: 'items', group: 'quality' as const },
    { id: 'terminal', group: 'system' as const },
    { id: 'settings', group: 'system' as const },
  ]

  it('places after the last entry of its group, including nested groups', () => {
    expect(placeExtensionModules(core, [{ id: 'customers', group: 'supply-chain' }])).toEqual([
      'explorer',
      'supplier-database',
      'customers',
      'items',
      'terminal',
      'settings',
    ])
  })

  it('places an ungrouped workspace before the System modules', () => {
    expect(placeExtensionModules(core, [{ id: 'x', group: null }])).toEqual([
      'explorer',
      'supplier-database',
      'items',
      'x',
      'terminal',
      'settings',
    ])
  })

  it("keeps a workspace where the user's saved order already has it", () => {
    const saved = ['explorer', 'items', 'customers', 'supplier-database', 'terminal', 'settings']
    expect(
      placeExtensionModules(core, [{ id: 'customers', group: 'supply-chain' }], saved),
    ).toEqual(['explorer', 'supplier-database', 'items', 'customers', 'terminal', 'settings'])
  })
})

describe('isExtensionWorkspaceVisible', () => {
  const ws = { id: 'customers', permission: 'module:customers' }
  const allow = () => true

  it('hides a workspace module_access denies', () => {
    expect(isExtensionWorkspaceVisible(ws, new Set(['customers']), {}, allow)).toBe(false)
  })

  it('hides a workspace the user switched off', () => {
    expect(isExtensionWorkspaceVisible(ws, new Set(), { customers: false }, allow)).toBe(false)
  })

  it('requires the view action on its permission resource', () => {
    const seen: string[] = []
    const check = (resource: string, action: string) => {
      seen.push(`${resource}:${action}`)
      return false
    }
    expect(isExtensionWorkspaceVisible(ws, new Set(), {}, check)).toBe(false)
    expect(seen).toEqual(['module:customers:view'])
    expect(isExtensionWorkspaceVisible({ id: 'x', permission: null }, new Set(), {}, check)).toBe(
      true,
    )
  })
})
