import type { ModuleId } from '@/types/modules'

// Translation keys for module names
export const moduleTranslationKeys: Record<ModuleId, string> = {
  // Source Files
  explorer: 'sidebar.explorer',
  pending: 'sidebar.pending',
  history: 'sidebar.history',
  workflows: 'sidebar.workflows',
  reviews: 'sidebar.reviews',
  trash: 'sidebar.trash',
  // Items
  items: 'sidebar.items',
  // Change Control
  eco: 'sidebar.eco',
  deviations: 'sidebar.deviations',
  // Supply Chain - Suppliers
  'supplier-database': 'sidebar.supplierDatabase',
  'supplier-portal': 'sidebar.supplierPortal',
  // Supply Chain - Orders
  orders: 'sidebar.orders',
  // Integrations
  'google-drive': 'sidebar.googleDrive',
  // System
  terminal: 'sidebar.terminal',
  settings: 'sidebar.settings',
}
