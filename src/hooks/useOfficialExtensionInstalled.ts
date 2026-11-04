import { usePDMStore } from '@/stores/pdmStore'
import { officialExtensionInstalled, type OfficialExtensionId } from '@/lib/officialExtensions'

/**
 * Whether an official extension (Reviews, Inspection, Orders) is installed for the signed-in
 * organization. Entry points outside the sidebar (menus, tabs, buttons, panes) gate on this; the
 * sidebar modules are denied through `useDeniedModules`. Non-React code reads
 * `officialExtensionInstalled(usePDMStore.getState().organization, id)`.
 */
export function useOfficialExtensionInstalled(id: OfficialExtensionId): boolean {
  return usePDMStore((s) => officialExtensionInstalled(s.organization, id))
}
