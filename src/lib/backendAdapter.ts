import { getActiveBackendKind } from './backend'
import type { BackendKind } from './backend'
import type { SettingsTab } from '@/types/settings'

export type ClientRole = 'admin' | 'engineer' | 'viewer'
export type BackendCapability = 'solidworks-license-management' | `settings:${SettingsTab}`

export interface BackendRoutes<TMdb, TSupabase> {
  mdb: () => TMdb
  supabase: () => TSupabase
}

const sharedSettingsTabs = [
  'preferences',
  'keybindings',
  'modules',
  'vaults',
  'team-members',
  'company-profile',
  'item-designations',
  'solidworks',
  'google-drive',
  'performance',
  'logs',
  'dev-tools',
  'about',
] as const satisfies readonly SettingsTab[]

const supabaseOnlySettingsTabs = [
  'profile',
  'module-access',
  'auth-providers',
  'serialization',
  'export',
  'rfq',
  'metadata-columns',
  'backup',
  'odoo',
  'slack',
  'webhooks',
  'api',
  'supabase',
  'recovery-codes',
  'vault-audit',
  'delete-account',
  'extension-store',
] as const satisfies readonly SettingsTab[]

function settingsCapabilities(tabs: readonly SettingsTab[]): BackendCapability[] {
  return tabs.map((tab) => `settings:${tab}` as const)
}

const backendCapabilities: Record<BackendKind, ReadonlySet<BackendCapability>> = {
  community: new Set<BackendCapability>([
    ...settingsCapabilities(sharedSettingsTabs),
    'solidworks-license-management',
  ]),
  supabase: new Set<BackendCapability>([
    ...settingsCapabilities(sharedSettingsTabs),
    ...settingsCapabilities(supabaseOnlySettingsTabs),
    'solidworks-license-management',
  ]),
}

/**
 * The only data-provider selection boundary. Domain functions provide both
 * implementations; this adapter chooses exactly one without initializing or
 * probing the inactive SDK.
 */
export function routeBackend<TMdb, TSupabase>(
  routes: BackendRoutes<TMdb, TSupabase>,
): TMdb | TSupabase {
  return getActiveBackendKind() === 'community' ? routes.mdb() : routes.supabase()
}

/** Translate the MDB server role without promoting unknown values. */
export function mapMdbRole(role: string): ClientRole | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'admin'
    case 'member':
      return 'engineer'
    case 'viewer':
    case 'guest':
      return 'viewer'
    default:
      return null
  }
}

/** Single backend-selection seam for auth and data adapters. */
export function isMdbBackendActive(): boolean {
  return getActiveBackendKind() === 'community'
}

/** Central backend capability check used by legacy feature call-sites. */
export function isBackendConfigured(kind: 'community' | 'supabase'): boolean {
  return getActiveBackendKind() === kind
}

/**
 * Keep backend-specific feature availability behind the adapter seam so UI
 * components never have to probe an inactive SDK client.
 */
export function activeBackendSupports(capability: BackendCapability): boolean {
  const backend = getActiveBackendKind()
  return backend ? backendCapabilities[backend].has(capability) : false
}

/** Keep Settings navigation availability behind the backend adapter seam. */
export function activeBackendSupportsSettingsTab(tab: SettingsTab): boolean {
  return activeBackendSupports(`settings:${tab}`)
}
