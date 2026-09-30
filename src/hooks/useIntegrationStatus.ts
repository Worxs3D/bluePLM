import { useEffect, useRef, useCallback } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { getBackupStatus } from '@/lib/backup'
import { log } from '@/lib/logger'
import type { IntegrationId } from '@/stores/types'

// Polling interval for status checks (5 seconds)
const POLLING_INTERVAL_MS = 5000
const BACKUP_CAPABILITY_RETRY_MS = 60_000

// Initial delay before first check (wait for organization to settle)
const INITIAL_DELAY_MS = 500

interface IntegrationStatusPollingOptions {
  check: (includeBackup: boolean) => Promise<boolean>
  isOnline: () => boolean
  pollIntervalMs?: number
  capabilityRetryMs?: number
}

export function startIntegrationStatusPolling({
  check,
  isOnline,
  pollIntervalMs = POLLING_INTERVAL_MS,
  capabilityRetryMs = BACKUP_CAPABILITY_RETRY_MS,
}: IntegrationStatusPollingOptions) {
  let backupUpdateRequired = false
  let lastBackupCheckAt = Number.NEGATIVE_INFINITY
  let checkInFlight = false

  const checkNow = async (forceBackup = false): Promise<boolean> => {
    if (!isOnline() || checkInFlight) return backupUpdateRequired
    const now = Date.now()
    const includeBackup = forceBackup || !backupUpdateRequired || now - lastBackupCheckAt >= capabilityRetryMs
    if (includeBackup) lastBackupCheckAt = now
    checkInFlight = true
    try {
      const nextUpdateRequired = await check(includeBackup)
      if (includeBackup) backupUpdateRequired = nextUpdateRequired
      return backupUpdateRequired
    } finally {
      checkInFlight = false
    }
  }

  const interval = setInterval(() => { void checkNow() }, pollIntervalMs)
  return {
    checkNow,
    setBackupUpdateRequired(value: boolean) {
      backupUpdateRequired = value
      if (value) lastBackupCheckAt = Date.now()
    },
    stop() { clearInterval(interval) },
  }
}

/**
 * Orchestration hook for integration status checks
 *
 * This hook handles the lifecycle of status checks:
 * - Waits for organization to load before checking
 * - Triggers initial status checks
 * - Sets up polling interval (5s) for ongoing checks
 * - Handles offline/online transitions
 *
 * The actual status checking logic is delegated to the IntegrationsSlice
 * in the store. This hook only orchestrates WHEN checks happen.
 */
export function useIntegrationStatus() {
  // Track if we've done initial check
  const hasInitialCheckRef = useRef(false)
  const isOnlineRef = useRef(navigator.onLine)
  const pollingControllerRef = useRef<ReturnType<typeof startIntegrationStatusPolling> | null>(null)
  const backupUpdateRequiredRef = useRef(false)

  // Subscribe to relevant store values
  const organization = usePDMStore((state) => state.organization)
  const solidworksIntegrationEnabled = usePDMStore((state) => state.solidworksIntegrationEnabled)
  const solidworksPath = usePDMStore((state) => state.solidworksPath)
  const isOfflineMode = usePDMStore((state) => state.isOfflineMode)

  // Get store actions (static references)
  const setIntegrationStatus = usePDMStore.getState().setIntegrationStatus
  const setBackupStatus = usePDMStore.getState().setBackupStatus
  const resetIntegrationStatuses = usePDMStore.getState().resetIntegrationStatuses

  // Check backup status (backup is separate from integrations slice)
  const checkBackup = useCallback(async (): Promise<boolean> => {
    const currentOrg = usePDMStore.getState().organization
    const connectedVaults = usePDMStore.getState().connectedVaults

    if (!currentOrg?.id) {
      setBackupStatus('not-configured')
      return false
    }

    // No vaults connected = nothing to back up, show warning (yellow)
    if (connectedVaults.length === 0) {
      setBackupStatus('partial')
      return false
    }

    try {
      const status = await getBackupStatus(currentOrg.id)
      const updateRequired = status.updateRequired === true

      if (!status.isConfigured) {
        setBackupStatus('partial')
      } else if (status.error) {
        setBackupStatus('offline')
      } else if (status.snapshots.length > 0) {
        setBackupStatus('online')
      } else {
        setBackupStatus('partial')
      }
      return updateRequired
    } catch (error) {
      log.warn('[IntegrationStatus]', 'Failed to check backup status', { error: error })
      setBackupStatus('not-configured')
      return false
    }
  }, [setBackupStatus])

  // Main check function - delegates to slice for integration checks
  // silent=true skips the 'checking' visual state to avoid UI flickering during polling
  const checkAllIntegrations = useCallback(
    async (silent = false, includeBackup = true): Promise<boolean> => {
      const currentOrg = usePDMStore.getState().organization

      // Don't check if organization isn't loaded yet
      if (!currentOrg?.id) {
        return backupUpdateRequiredRef.current
      }

      // Don't check in offline mode
      if (usePDMStore.getState().isOfflineMode) {
        return backupUpdateRequiredRef.current
      }

      // Delegate to slice for all integration checks
      await usePDMStore.getState().checkAllIntegrations(silent)

      // Check backup separately (not in integrations slice)
      if (includeBackup) {
        const updateRequired = await checkBackup()
        backupUpdateRequiredRef.current = updateRequired
        pollingControllerRef.current?.setBackupUpdateRequired(updateRequired)
      }
      return backupUpdateRequiredRef.current
    },
    [checkBackup],
  )

  // Handle online/offline transitions
  useEffect(() => {
    const handleOnline = () => {
      isOnlineRef.current = true
      checkAllIntegrations()
    }

    const handleOffline = () => {
      isOnlineRef.current = false
      // Mark all network-dependent integrations as offline
      const offlineIntegrations: IntegrationId[] = ['supabase', 'google-drive', 'api', 'odoo']
      offlineIntegrations.forEach((id) => {
        setIntegrationStatus(id, 'offline', 'No network connection')
      })
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [checkAllIntegrations, setIntegrationStatus])

  // Initial check when organization loads
  useEffect(() => {
    // Wait for organization to be loaded
    if (!organization?.id) {
      return
    }

    // Skip if in offline mode
    if (isOfflineMode) {
      return
    }

    hasInitialCheckRef.current = true

    // Delay initial check slightly to let other initialization complete
    const initialTimeout = setTimeout(() => {
      checkAllIntegrations()
    }, INITIAL_DELAY_MS)

    return () => {
      clearTimeout(initialTimeout)
    }
  }, [organization?.id, isOfflineMode, checkAllIntegrations])

  // Set up polling interval
  useEffect(() => {
    // Only poll if organization is loaded and we're online
    if (!organization?.id || isOfflineMode) {
      return
    }

    // Set up polling with silent mode to avoid UI flickering
    const controller = startIntegrationStatusPolling({
      check: (includeBackup) => checkAllIntegrations(true, includeBackup),
      isOnline: () => navigator.onLine,
    })
    pollingControllerRef.current = controller

    return () => {
      controller.stop()
      if (pollingControllerRef.current === controller) pollingControllerRef.current = null
    }
  }, [organization?.id, isOfflineMode, checkAllIntegrations])

  // Re-check SolidWorks when relevant settings change
  useEffect(() => {
    // Only re-check if we've already done initial check
    if (!hasInitialCheckRef.current || !organization?.id) {
      return
    }

    // Delegate to slice's individual check
    usePDMStore.getState().checkIntegration('solidworks')
  }, [solidworksIntegrationEnabled, solidworksPath, organization?.id])

  // Return function to manually trigger a check
  return {
    checkAllIntegrations,
    resetIntegrationStatuses,
  }
}
