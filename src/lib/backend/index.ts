import type { BackendResolution } from './contracts/backend'
import { supabaseBackendAdapter } from './supabaseAdapter'

export type { BackendAdapter, BackendKind, BackendResolution } from './contracts/backend'
export type { AuthPort, AuthStateListener, AuthStateSubscription } from './contracts/auth'
export type { IdentityPort } from './contracts/identity'

/**
 * The sole runtime selection point for the first adapter seam.  The Supabase
 * client already resolves a valid saved configuration before a valid Vite
 * environment configuration.  It returns an explicit unconfigured result
 * rather than substituting another backend or retaining a credentials snapshot.
 */
export function resolveBackend(): BackendResolution {
  if (!supabaseBackendAdapter.isConfigured()) {
    return { status: 'unconfigured' }
  }

  return { status: 'ready', backend: supabaseBackendAdapter }
}
