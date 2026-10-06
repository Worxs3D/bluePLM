import type { Organization } from '@/types/pdm'

/** Server profile fields used to hydrate the signed-in renderer user. */
export interface UserProfile {
  id: string
  email: string
  role: string
  org_id: string | null
  full_name: string | null
  avatar_url: string | null
  custom_avatar_url: string | null
}

export interface AuthProviders {
  users: { google: boolean; email: boolean; phone: boolean }
  suppliers: { google: boolean; email: boolean; phone: boolean }
}

export interface UserProfileResult {
  profile: UserProfile | null
  error: Error | null
}

export interface OrganizationLinkResult {
  org: Organization | null
  error: Error | string | null
}

/**
 * Identity and organization lookups used immediately after authentication.
 * Each method keeps the established data and error results unchanged.
 */
export interface IdentityPort {
  getUserProfile(userId: string, options?: { maxRetries?: number }): Promise<UserProfileResult>
  linkUserToOrganization(
    userId: string,
    userEmail: string,
    cachedOrgId?: string | null,
  ): Promise<OrganizationLinkResult>
  getOrgAuthProviders(orgSlug?: string): Promise<AuthProviders | null>
}
