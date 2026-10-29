import { describe, expect, it } from 'vitest'

import { ALL_RESOURCES } from '@/types/permissions'

import {
  extensionPermissionResources,
  readContributedPermissions,
  withExtensionPermissionResources,
} from './permissions'

const manifest = {
  id: 'blueplm.customers',
  contributes: {
    permissions: [
      { resource: 'module:customers', label: 'Customers', actions: ['view', 'create', 'bogus'] },
      { resource: 'system:customer-enrichment', label: 'AI Research', actions: ['view', 'admin'] },
      { resource: 'no colon', label: 'Bad', actions: ['view'] },
      { resource: 'module:empty', label: 'Empty', actions: [] },
    ],
  },
}

describe('readContributedPermissions', () => {
  it('keeps well-formed entries and drops malformed ones', () => {
    const resources = readContributedPermissions('blueplm.customers', manifest)
    expect(resources.map((r) => [r.id, r.category, r.applicableActions])).toEqual([
      ['module:customers', 'modules', ['view', 'create']],
      ['system:customer-enrichment', 'system', ['view', 'admin']],
    ])
  })

  it('returns nothing for a manifest without contributes.permissions', () => {
    expect(readContributedPermissions('x.y', { id: 'x.y' })).toEqual([])
    expect(readContributedPermissions('x.y', null)).toEqual([])
  })
})

describe('extensionPermissionResources', () => {
  it('skips resources core already defines and duplicates across extensions', () => {
    const rows = [
      { extensionId: 'blueplm.customers', manifest: { ...manifest, name: 'C', version: '1.0.0' } },
      {
        extensionId: 'acme.other',
        manifest: {
          id: 'acme.other',
          name: 'O',
          version: '1.0.0',
          contributes: { permissions: [{ resource: 'module:customers', label: 'X', actions: ['view'] }] },
        },
      },
    ]
    const ids = extensionPermissionResources(rows, new Set(['system:customer-enrichment'])).map(
      (r) => `${r.extensionId}/${r.id}`,
    )
    expect(ids).toEqual(['blueplm.customers/module:customers'])
  })
})

describe('withExtensionPermissionResources', () => {
  const groups = [{ id: 'core', name: 'Core', icon: 'Shield', color: '#000', resources: [] }]

  it('adds one extension group after the core groups', () => {
    const { allResources, resourceGroups } = withExtensionPermissionResources(
      ALL_RESOURCES,
      groups,
      [{ extensionId: 'blueplm.customers', manifest: { ...manifest, name: 'C', version: '1.0.0' } }],
      'Extensions',
    )
    expect(resourceGroups.map((g) => [g.id, g.name, g.resources])).toEqual([
      ['core', 'Core', []],
      ['extensions', 'Extensions', ['module:customers', 'system:customer-enrichment']],
    ])
    expect(allResources.length).toBe(ALL_RESOURCES.length + 2)
  })

  it('returns core unchanged when no extension contributes a resource', () => {
    const { allResources, resourceGroups } = withExtensionPermissionResources(
      ALL_RESOURCES,
      groups,
      [],
      'Extensions',
    )
    expect(allResources).toEqual(ALL_RESOURCES)
    expect(resourceGroups).toEqual(groups)
  })
})
