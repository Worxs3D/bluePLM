import { getCheckedOutUsers } from '@/lib/supabase'
import { describeError } from '@/lib/errorDetails'
import { log } from '@/lib/logger'
import type { CheckoutOwnerRef, CheckoutProfileScope } from '@/lib/supabase/files/queries'
import { hashCheckoutIdentifier, type CheckoutUserProfile } from '@/types/pdm'

const CHECKOUT_PROFILE_MAX_ATTEMPTS = 3
const CHECKOUT_PROFILE_RETRY_BASE_MS = 200

function waitForCheckoutRetry(attempt: number): Promise<void> {
  const delayMs = CHECKOUT_PROFILE_RETRY_BASE_MS * 2 ** (attempt - 1)
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export interface CheckoutProfileFetchResult {
  users: Record<string, CheckoutUserProfile>
  error: unknown
  attempts: number
}

export async function fetchCheckoutProfilesWithRetry(
  owners: CheckoutOwnerRef[],
  scope: CheckoutProfileScope,
  requestId: string,
  isCurrent?: () => boolean,
): Promise<CheckoutProfileFetchResult> {
  let lastError: unknown = null
  let lastUsers: Record<string, CheckoutUserProfile> = {}
  const ownerCount = new Set(owners.map((owner) => owner.ownerId)).size

  for (let attempt = 1; attempt <= CHECKOUT_PROFILE_MAX_ATTEMPTS; attempt++) {
    if (isCurrent && !isCurrent()) {
      return { users: {}, error: null, attempts: attempt - 1 }
    }

    const fetchStart = performance.now()
    let result: { users: Record<string, CheckoutUserProfile>; error: unknown }
    try {
      result = await getCheckedOutUsers(owners, scope)
    } catch (error) {
      result = { users: {}, error }
    }
    const latencyMs = Math.round(performance.now() - fetchStart)

    if (isCurrent && !isCurrent()) {
      log.info('[CheckoutHydration]', 'Discarding profile response after context change', {
        requestId,
        orgId: hashCheckoutIdentifier(scope.orgId),
        vaultId: hashCheckoutIdentifier(scope.vaultId),
        attempt,
        latencyMs,
        stale: true,
      })
      return { users: {}, error: null, attempts: attempt }
    }

    if (!result.error) {
      log.info('[CheckoutHydration]', 'Checkout profiles fetched', {
        requestId,
        orgId: hashCheckoutIdentifier(scope.orgId),
        vaultId: hashCheckoutIdentifier(scope.vaultId),
        fileCount: owners.length,
        ownerCount,
        hitCount: Object.keys(result.users).length,
        missCount: owners.length - Object.keys(result.users).length,
        attempt,
        latencyMs,
        stale: false,
      })
      return { users: result.users, error: null, attempts: attempt }
    }

    lastError = result.error
    lastUsers = result.users
    log.warn('[CheckoutHydration]', 'Checkout profile lookup failed', {
      requestId,
      orgId: hashCheckoutIdentifier(scope.orgId),
      vaultId: hashCheckoutIdentifier(scope.vaultId),
      fileCount: owners.length,
      ownerCount,
      hitCount: Object.keys(result.users).length,
      attempt,
      latencyMs,
      // name, message, code, details, hint, status: the cause was logged as "[object Object]".
      error: describeError(result.error),
      retrying: attempt < CHECKOUT_PROFILE_MAX_ATTEMPTS,
    })

    if (attempt < CHECKOUT_PROFILE_MAX_ATTEMPTS) {
      await waitForCheckoutRetry(attempt)
    }
  }

  return { users: lastUsers, error: lastError, attempts: CHECKOUT_PROFILE_MAX_ATTEMPTS }
}
