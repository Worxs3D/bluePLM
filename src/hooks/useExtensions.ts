/**
 * useExtensions - React hook for extension package state and IPC events
 *
 * Provides:
 * - Access to extension slice state
 * - One subscription to main's `extension:state-change` event for the hook's lifetime
 * - Computed values for common queries
 */
import { useEffect, useCallback } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import type { InstalledExtension, StoreExtensionListing, PDMStoreState } from '@/stores/types'

interface UseExtensionsReturn {
  installedExtensions: Record<string, InstalledExtension>
  storeExtensions: StoreExtensionListing[]
  storeLoading: boolean
  installedCount: number
  getExtension: (extensionId: string) => InstalledExtension | undefined
  isInstalled: (extensionId: string) => boolean
}

/** The part of the preload extensions API this hook listens to. */
export interface ExtensionEventSource {
  onStateChange: (
    callback: (event: {
      extensionId: string
      state: 'installed' | 'not-installed'
      timestamp: number
    }) => void,
  ) => () => void
}

/**
 * Subscribe to main's extension events. Handlers read the store through
 * `getState` when an event arrives instead of closing over a render's state, so
 * the subscription never has to be torn down and redone when the state changes.
 * Returns the unsubscribe function.
 */
export function subscribeToExtensionEvents(
  api: ExtensionEventSource | undefined,
  getState: () => Pick<PDMStoreState, 'handleExtensionStateChange'>,
): () => void {
  if (!api) return () => {}
  return api.onStateChange((event) => {
    getState().handleExtensionStateChange(event.extensionId, event.state)
  })
}

/**
 * Hook for accessing extension state with automatic IPC event subscription.
 */
export function useExtensions(): UseExtensionsReturn {
  const installedExtensions = usePDMStore((s) => s.installedExtensions)
  const storeExtensions = usePDMStore((s) => s.storeExtensions)
  const storeLoading = usePDMStore((s) => s.storeLoading)

  // Subscribe once per mount. No dependencies on store state: see subscribeToExtensionEvents.
  useEffect(
    () => subscribeToExtensionEvents(window.electronAPI?.extensions, usePDMStore.getState),
    [],
  )

  const getExtension = useCallback(
    (extensionId: string) => installedExtensions[extensionId],
    [installedExtensions],
  )

  const isInstalled = useCallback(
    (extensionId: string) => extensionId in installedExtensions,
    [installedExtensions],
  )

  return {
    installedExtensions,
    storeExtensions,
    storeLoading,
    installedCount: Object.keys(installedExtensions).length,
    getExtension,
    isInstalled,
  }
}
