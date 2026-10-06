import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client'
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithPhone,
  signOut,
  signUpWithEmail,
  verifyPhoneOTP,
} from '@/lib/supabase/auth'
import {
  getOrgAuthProviders,
  getUserProfile,
  linkUserToOrganization,
} from '@/lib/supabase/organizations'
import type { BackendAdapter } from './contracts/backend'
import type { AuthStateListener, AuthStateSubscription } from './contracts/auth'

function subscribeToAuthStateChange(listener: AuthStateListener): AuthStateSubscription {
  const {
    data: { subscription },
  } = getSupabaseClient().auth.onAuthStateChange(listener)

  return subscription
}

/**
 * The production adapter delegates to the current Supabase implementation.
 * It holds no credentials or client state: getSupabaseClient() continues to
 * own initialization, reconfiguration, and Electron session-listener cleanup.
 */
export const supabaseBackendAdapter: BackendAdapter = {
  kind: 'supabase',
  isConfigured: isSupabaseConfigured,
  auth: {
    subscribeToAuthStateChange,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signInWithPhone,
    verifyPhoneOTP,
    signOut,
  },
  identity: {
    getUserProfile,
    linkUserToOrganization,
    getOrgAuthProviders,
  },
}
