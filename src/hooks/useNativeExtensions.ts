/**
 * Runs the organization's native extensions for the signed-in user.
 *
 * On sign-in or an org switch it loads the org's native rows and activates the
 * enabled ones; on sign-out (no user or no organization) it deactivates
 * everything, so nothing an extension registered outlives the session it ran in.
 */
import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import { deactivateAllNativeExtensions, reloadNativeExtensions } from '@/lib/nativeExtensions/runtime'

export function useNativeExtensions(): void {
  const orgId = usePDMStore((s) => s.organization?.id ?? null)
  const userId = usePDMStore((s) => s.user?.id ?? null)

  useEffect(() => {
    if (!window.electronAPI?.extensions?.nativePrepare) return
    if (!orgId || !userId) {
      void deactivateAllNativeExtensions()
      return
    }
    reloadNativeExtensions(orgId).catch((error: unknown) => {
      log.error('[NativeExt]', 'Loading native extensions failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, [orgId, userId])
}
