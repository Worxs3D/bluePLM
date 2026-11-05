import { describe, expect, it } from 'vitest'

import { isContextMenuEntryId } from '@/lib/contextMenu/entries'
import { MODULES, computeDeniedModules } from '@/types/modules'
import { SETTINGS_TABS } from '@/types/settings'
import { SHORTCUT_CATEGORIES } from '@/lib/keybindings/registry'
import { isSettingsTabAvailable, settingsSections } from '@/features/settings/settingsCatalog'
import type { Organization } from '@/types/pdm'

import {
  OFFICIAL_EXTENSIONS,
  OFFICIAL_EXTENSION_IDS,
  dependentsOf,
  detailsTabsOfUninstalledExtensions,
  extensionOfCommand,
  extensionOfMenuEntry,
  extensionOfSettingsTab,
  modulesOfUninstalledExtensions,
  officialExtensionInstalled,
  parseExtensionIds,
  planInstall,
  planUninstall,
  uninstalledOfficialExtensions,
  type OfficialExtensionId,
} from './index'

const org = (extensions?: unknown): Pick<Organization, 'settings'> =>
  ({ settings: extensions === undefined ? {} : { extensions } }) as unknown as Pick<Organization, 'settings'>

describe('install state', () => {
  it('reads every extension as installed when the organization never set it', () => {
    for (const id of OFFICIAL_EXTENSION_IDS) {
      expect(officialExtensionInstalled(org(), id)).toBe(true)
      expect(officialExtensionInstalled(null, id)).toBe(true)
    }
    expect(uninstalledOfficialExtensions(org())).toEqual([])
    // One shared empty array, so selectors stay stable.
    expect(uninstalledOfficialExtensions(org())).toBe(uninstalledOfficialExtensions(null))
  })

  it('uninstalls only on an explicit installed: false', () => {
    const o = org({
      'blueplm.reviews': { installed: false },
      'blueplm.supply-chain': { installed: true },
      'blueplm.inspection': { installed: 'no' },
    })
    expect(officialExtensionInstalled(o, 'blueplm.reviews')).toBe(false)
    expect(officialExtensionInstalled(o, 'blueplm.supply-chain')).toBe(true)
    expect(officialExtensionInstalled(o, 'blueplm.inspection')).toBe(true)
    expect(uninstalledOfficialExtensions(o)).toEqual(['blueplm.reviews'])
  })

  it('ignores malformed settings', () => {
    expect(officialExtensionInstalled(org([]), 'blueplm.reviews')).toBe(true)
    expect(officialExtensionInstalled(org('x'), 'blueplm.reviews')).toBe(true)
    expect(officialExtensionInstalled(org({ 'blueplm.reviews': null }), 'blueplm.reviews')).toBe(true)
  })

  it('round-trips the joined key selectors use, dropping unknown ids', () => {
    expect(parseExtensionIds('')).toEqual([])
    expect(parseExtensionIds('blueplm.reviews,blueplm.nope,blueplm.supply-chain')).toEqual([
      'blueplm.reviews',
      'blueplm.supply-chain',
    ])
  })
})

describe('manifests', () => {
  it('have unique ids, known modules, settings tabs, shortcut categories and menu entries', () => {
    expect(new Set(OFFICIAL_EXTENSIONS.map((m) => m.id)).size).toBe(OFFICIAL_EXTENSIONS.length)
    const moduleIds = new Set(MODULES.map((m) => m.id))
    for (const m of OFFICIAL_EXTENSIONS) {
      for (const mod of m.contributes.modules) expect(moduleIds.has(mod), `${m.id}: ${mod}`).toBe(true)
      for (const tab of m.contributes.settingsTabs) expect(SETTINGS_TABS).toContain(tab)
      for (const c of m.contributes.shortcutCategories) expect(SHORTCUT_CATEGORIES).toContain(c)
      for (const e of m.contributes.contextMenuEntries) expect(isContextMenuEntryId(e), `${m.id}: ${e}`).toBe(true)
    }
  })

  it('are independent of each other (no hard dependencies between the three)', () => {
    for (const m of OFFICIAL_EXTENSIONS) expect(m.dependencies.extensions).toEqual([])
  })

  it('map contributions back to their extension', () => {
    expect(extensionOfSettingsTab('inspection-templates')).toBe('blueplm.inspection')
    expect(extensionOfSettingsTab('profile')).toBeNull()
    expect(extensionOfCommand('download-review-package')).toBe('blueplm.reviews')
    expect(extensionOfCommand('checkin')).toBeNull()
    expect(extensionOfMenuEntry('orders')).toBe('blueplm.supply-chain')
    expect(extensionOfMenuEntry('reviews')).toBe('blueplm.reviews')
    expect(extensionOfMenuEntry('generate.local.inspectionReport')).toBe('blueplm.inspection')
  })
})

describe('gates', () => {
  it('deny the modules of uninstalled extensions to everyone', () => {
    // The Reviews view stays without Reviews: workflow gate approvals are decided there.
    const modules = modulesOfUninstalledExtensions(['blueplm.reviews', 'blueplm.supply-chain'])
    expect(modules).toEqual(['orders', 'supplier-database', 'supplier-portal'])
    const denied = computeDeniedModules([], true, true, modules)
    expect(denied.has('reviews')).toBe(false)
    expect(denied.has('orders')).toBe(true)
    expect(denied.has('explorer')).toBe(false)
    expect(computeDeniedModules([], true, true, []).size).toBe(0)
  })

  it('hide the details tabs of uninstalled extensions', () => {
    expect(detailsTabsOfUninstalledExtensions([])).toEqual([])
    expect(detailsTabsOfUninstalledExtensions(['blueplm.inspection'])).toEqual(['inspection'])
    expect(detailsTabsOfUninstalledExtensions(['blueplm.supply-chain'])).toEqual(['vendors', 'orders'])
  })

  it('hide a settings tab of an uninstalled extension, admins included', () => {
    const tab = settingsSections()
      .flatMap((s) => s.items)
      .find((i) => i.id === 'inspection-templates')!
    expect(isSettingsTabAvailable(tab, true, true)).toBe(true)
    expect(isSettingsTabAvailable(tab, true, true, ['blueplm.inspection'])).toBe(false)
    expect(isSettingsTabAvailable(tab, true, true, ['blueplm.supply-chain'])).toBe(true)
  })

  it('show Settings > Extensions on the web', () => {
    const tab = settingsSections()
      .flatMap((s) => s.items)
      .find((i) => i.id === 'extensions')!
    expect(isSettingsTabAvailable(tab, false, false)).toBe(true)
  })
})

describe('dependency plans', () => {
  const all: (id: OfficialExtensionId) => boolean = () => true

  it('never block an uninstall of the three (nothing depends on them)', () => {
    for (const id of OFFICIAL_EXTENSION_IDS) {
      expect(dependentsOf(id)).toEqual([])
      expect(planUninstall(id, all).blockedBy).toEqual([])
    }
  })

  it('install just the extension when its dependencies are core only', () => {
    expect(planInstall('blueplm.supply-chain', (id) => id !== 'blueplm.supply-chain').install).toEqual(['blueplm.supply-chain'])
  })
})

describe('review packages without Reviews', () => {
  it('never show the review pane, even as the right panel fallback', async () => {
    const { reviewPackagesInstalled, selectReviewPackagePaneShown } = await import('@/stores/slices/reviewsSlice')
    type State = Parameters<typeof selectReviewPackagePaneShown>[0]
    const base = {
      rightPanelVisible: true,
      reviewPackagePaneOpen: true,
      activeView: 'explorer',
      rightPanelTabs: [],
      extensionRightPanel: null,
      extensionWorkspaces: [],
    }
    const on = { ...base, organization: org() } as unknown as State
    const off = { ...base, organization: org({ 'blueplm.reviews': { installed: false } }) } as unknown as State
    expect(reviewPackagesInstalled(on)).toBe(true)
    expect(selectReviewPackagePaneShown(on)).toBe(true)
    expect(reviewPackagesInstalled(off)).toBe(false)
    expect(selectReviewPackagePaneShown(off)).toBe(false)
  })
})
