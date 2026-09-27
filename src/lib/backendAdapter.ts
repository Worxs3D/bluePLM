import { getActiveBackendKind } from './backend'
import type { BackendKind } from './backend'
import type { SettingsTab } from '@/types/settings'
import type { ModuleId } from '@/types/modules'

export type ClientRole = 'admin' | 'engineer' | 'viewer'
export type BackendCapability = 'solidworks-license-management' | 'metadata-column-defaults'

export interface BackendRoutes<TMdb, TSupabase> {
  mdb: () => TMdb
  supabase: () => TSupabase
}

const allBackends = new Set<BackendKind>(['community', 'supabase'])
const supabaseOnly = new Set<BackendKind>(['supabase'])

/**
 * Exhaustive feature matrix: adding a SettingsTab requires an explicit backend
 * support decision here before TypeScript will compile.
 */
const settingsTabBackends: Record<SettingsTab, ReadonlySet<BackendKind>> = {
  profile: supabaseOnly,
  preferences: allBackends,
  keybindings: allBackends,
  modules: allBackends,
  vaults: allBackends,
  'team-members': allBackends,
  'module-access': allBackends,
  'company-profile': allBackends,
  'auth-providers': supabaseOnly,
  serialization: allBackends,
  export: allBackends,
  rfq: allBackends,
  'metadata-columns': allBackends,
  'item-designations': allBackends,
  backup: supabaseOnly,
  solidworks: allBackends,
  'google-drive': supabaseOnly,
  odoo: supabaseOnly,
  slack: supabaseOnly,
  webhooks: supabaseOnly,
  api: supabaseOnly,
  supabase: supabaseOnly,
  'recovery-codes': allBackends,
  'vault-audit': supabaseOnly,
  performance: allBackends,
  logs: allBackends,
  'dev-tools': allBackends,
  about: allBackends,
  'delete-account': allBackends,
  'extension-store': supabaseOnly,
}

const backendCapabilities: Record<BackendKind, ReadonlySet<BackendCapability>> = {
  community: new Set<BackendCapability>([
    'solidworks-license-management',
    'metadata-column-defaults',
  ]),
  supabase: new Set<BackendCapability>([
    'solidworks-license-management',
    'metadata-column-defaults',
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
  const backend = getActiveBackendKind()
  return backend ? settingsTabBackends[tab].has(backend) : false
}

/** Keep backend-specific application modules behind the same adapter boundary. */
export function activeBackendSupportsModule(moduleId: ModuleId): boolean {
  return getActiveBackendKind() !== 'community' || moduleId !== 'google-drive'
}
