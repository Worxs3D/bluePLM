/**
 * Runs the organization's native extensions for the signed-in user.
 *
 * On sign-in or an org switch it activates the org's enabled native extensions
 * (deactivating the previous org's first); on sign-out (no user or no
 * organization) it deactivates everything. Changes to the org's installed
 * extensions arrive over realtime and trigger a debounced refresh. The session
 * (src/lib/nativeExtensions/session.ts) serializes all of this with a generation
 * token, so a stale fetch can never activate the wrong org's extensions.
 */
import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { deactivateAllNativeExtensions, reloadNativeExtensions } from '@/lib/nativeExtensions/runtime'
import { subscribeToOrgExtensionChanges } from '@/lib/nativeExtensions/realtime'

export function useNativeExtensions(): void {
  const orgId = usePDMStore((s) => s.organization?.id ?? null)
  const userId = usePDMStore((s) => s.user?.id ?? null)

  useEffect(() => {
    if (!window.electronAPI?.extensions?.nativePrepare) return
    if (!orgId || !userId) {
      void deactivateAllNativeExtensions()
      return
    }
    void reloadNativeExtensions(orgId)
    const unsubscribe = subscribeToOrgExtensionChanges(orgId, () => {
      void reloadNativeExtensions(orgId)
    })
    return unsubscribe
  }, [orgId, userId])
}
