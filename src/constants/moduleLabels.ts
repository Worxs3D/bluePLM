/**
 * Human-readable labels for sidebar modules
 * Used by Sidebar, ActivityBar, and other UI components
 */

import type { CoreSidebarView, SidebarView } from '@/stores/types'
import { DEFAULT_CUSTOM_GROUPS } from '@/types/modules'

/** Display names for modules (sentence case) */
export const MODULE_LABELS: Record<CoreSidebarView, string> = {
  // Source Files
  explorer: 'Explorer',
  pending: 'Pending Changes',
  history: 'History',
  workflows: 'File Workflows',
  reviews: 'Reviews',
  trash: 'Trash',
  // Items
  items: 'Item Browser',
  products: 'Products',
  // Change Control
  ecr: 'ECRs / Issues',
  eco: 'ECOs',
  deviations: 'Deviations',
  'release-schedule': 'Release Schedule',
  process: 'Process Editor',
  // Supply Chain - Suppliers
  'supplier-database': 'Supplier Database',
  'supplier-portal': 'Supplier Portal',
  // Customers
  customers: 'Customers',
  // Integrations
  'google-drive': 'Google Drive',
  // System
  terminal: 'Terminal',
  settings: 'Settings',
}

/** Header titles for sidebar (uppercase) */
export const MODULE_TITLES: Record<CoreSidebarView, string> = Object.fromEntries(
  Object.entries(MODULE_LABELS).map(([key, value]) => [key, value.toUpperCase()]),
) as Record<CoreSidebarView, string>

/** Label lookup that also accepts extension view ids (which have no core label). */
function lookup(table: Record<CoreSidebarView, string>, view: SidebarView): string | undefined {
  return (table as Readonly<Record<string, string | undefined>>)[view]
}

/** Get module label with fallback */
export function getModuleLabel(view: SidebarView): string {
  const label = lookup(MODULE_LABELS, view)
  if (label) return label
  const viewStr = view as string
  if (viewStr.startsWith('group-')) {
    const group = DEFAULT_CUSTOM_GROUPS.find((g) => g.id === viewStr)
    if (group) return group.name
  }
  return 'Explorer'
}

/** Get module title (uppercase) with fallback */
export function getModuleTitle(view: SidebarView): string {
  const title = lookup(MODULE_TITLES, view)
  if (title) return title
  const viewStr = view as string
  if (viewStr.startsWith('group-')) {
    const group = DEFAULT_CUSTOM_GROUPS.find((g) => g.id === viewStr)
    if (group) return group.name.toUpperCase()
  }
  return 'EXPLORER'
}
