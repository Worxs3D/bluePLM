/** Auth lifecycle events consumed by the current renderer. */
export type AuthStateEvent =
  | 'INITIAL_SESSION'
  | 'PASSWORD_RECOVERY'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'MFA_CHALLENGE_VERIFIED'

/**
 * The server-issued identity fields the renderer reads during authentication.
 * Additional provider fields remain on the original runtime object.
 */
export interface AuthenticatedUser {
  id: string
  email?: string
  created_at: string
  user_metadata?: {
    full_name?: string
    name?: string
    avatar_url?: string
    picture?: string
  }
}

/** The session data the existing auth and Electron handoff paths consume. */
export interface AuthSession {
  access_token: string
  refresh_token: string
  expires_in: number
  user: AuthenticatedUser
}

/**
 * The auth-state information the renderer already consumes.  The adapter
 * forwards the provider session object unchanged, rather than constructing a
 * reduced replacement.
 */
export type AuthStateListener = (
  event: AuthStateEvent,
  session: AuthSession | null,
) => void | Promise<void>

export interface AuthStateSubscription {
  unsubscribe(): void
}

export interface OAuthSignInData {
  provider: string
  url: string | null
}

export interface AuthCredentialsData {
  user: AuthenticatedUser | null
  session: AuthSession | null
}

export interface PhoneOtpData {
  user: null
  session: null
  messageId?: string | null
}

export interface AuthOperationResult<TData> {
  data: TData | null
  error: Error | null
}

export interface SignOutResult {
  error: Error | null
}

/**
 * Authentication operations exercised by the existing sign-in and startup
 * paths.  Their structural results preserve established success and error
 * semantics without exporting SDK types through the seam.
 */
export interface AuthPort {
  subscribeToAuthStateChange(listener: AuthStateListener): AuthStateSubscription
  signInWithGoogle(): Promise<AuthOperationResult<OAuthSignInData>>
  signInWithEmail(
    email: string,
    password: string,
  ): Promise<AuthOperationResult<AuthCredentialsData>>
  signUpWithEmail(
    email: string,
    password: string,
    fullName?: string,
  ): Promise<AuthOperationResult<AuthCredentialsData>>
  signInWithPhone(phone: string): Promise<AuthOperationResult<PhoneOtpData>>
  verifyPhoneOTP(phone: string, token: string): Promise<AuthOperationResult<AuthCredentialsData>>
  signOut(): Promise<SignOutResult>
}
