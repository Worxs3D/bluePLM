import type { SettingsTab } from '@/types/settings'

const SETTINGS_TABS: ReadonlySet<string> = new Set<SettingsTab>([
  'profile',
  'preferences',
  'keybindings',
  'vaults',
  'modules',
  'team-members',
  'module-access',
  'company-profile',
  'auth-providers',
  'serialization',
  'solidworks',
  'export',
  'rfq',
  'metadata-columns',
  'item-designations',
  'backup',
  'google-drive',
  'odoo',
  'slack',
  'webhooks',
  'api',
  'supabase',
  'recovery-codes',
  'vault-audit',
  'performance',
  'logs',
  'dev-tools',
  'about',
  'delete-account',
  'extension-store',
])

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && SETTINGS_TABS.has(value)
}

export function applySettingsNavigationEvent(
  event: Event,
  actions: { setActiveView: (view: 'settings') => void; setSettingsTab: (tab: SettingsTab) => void },
): boolean {
  const tab = (event as CustomEvent<unknown>).detail
  if (!isSettingsTab(tab)) return false
  actions.setSettingsTab(tab)
  actions.setActiveView('settings')
  return true
}
