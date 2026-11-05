import { useMemo } from 'react'

import { usePDMStore } from '@/stores/pdmStore'
import type { DetailsPanelTab } from '@/stores/types'
import {
  detailsTabsOfUninstalledExtensions,
  officialExtensionInstalled,
  parseExtensionIds,
  uninstalledOfficialExtensions,
  type OfficialExtensionId,
} from '@/lib/officialExtensions'

/**
 * Whether an official extension (Reviews, Inspection, Supply chain) is installed for the signed-in
 * organization. Entry points outside the sidebar (menus, tabs, buttons, panes) gate on this; the
 * sidebar modules are denied through `useDeniedModules`. Non-React code reads
 * `officialExtensionInstalled(usePDMStore.getState().organization, id)`.
 */
export function useOfficialExtensionInstalled(id: OfficialExtensionId): boolean {
  return usePDMStore((s) => officialExtensionInstalled(s.organization, id))
}

const NO_TABS: ReadonlySet<DetailsPanelTab> = new Set()

/**
 * The file details tabs of uninstalled extensions (manifest `contributes.detailsTabs`: Inspection,
 * Vendors, Orders). Every panel that lists or renders details tabs leaves them out; the user's tab
 * layout keeps them for a reinstall.
 */
export function useHiddenDetailsTabs(): ReadonlySet<DetailsPanelTab> {
  // A comma-joined key: a store selector must return a stable value.
  const key = usePDMStore((s) => uninstalledOfficialExtensions(s.organization).join(','))
  return useMemo(() => {
    const tabs = detailsTabsOfUninstalledExtensions(parseExtensionIds(key))
    return tabs.length === 0 ? NO_TABS : new Set(tabs)
  }, [key])
}
