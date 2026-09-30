import { useState, useEffect, useCallback, useRef } from 'react'
import { log } from '@/lib/logger'
import { useTranslation } from '@/lib/i18n'
import {
  runBackup,
  restoreFromSnapshot,
  deleteSnapshot,
  designateThisMachine,
  clearDesignatedMachine,
  requestBackup,
  markBackupStarted,
  markBackupComplete,
  startBackupService,
  stopBackupService,
  getBackupConfig,
  importDatabaseMetadata,
  isBackupRunningLocally,
  setBackupRunningLocally,
  type BackupConfig,
  type DatabaseExport,
} from '@/lib/backup'
import type { BackupProgress, DeleteConfirmTarget, ConnectedVault, BackupLogEntry } from '../types'

// Helper to emit a synthetic backup log for renderer-side operations
function emitRendererLog(entry: Omit<BackupLogEntry, 'timestamp'>) {
  // Use a custom event to communicate with useBackupLogs
  const event = new CustomEvent('backup:renderer-log', {
    detail: { ...entry, timestamp: Date.now() },
  })
  window.dispatchEvent(event)
}

interface UseBackupOperationsReturn {
  // Backup state
  isRunningBackup: boolean
  backupProgress: BackupProgress | null

  // Restore state
  isRestoring: boolean
  selectedSnapshot: string | null
  setSelectedSnapshot: (id: string | null) => void

  // Delete state - set of all snapshots being deleted (queued or in-progress)
  deletingSnapshotIds: Set<string>
  deleteConfirmTarget: DeleteConfirmTarget | null
  setDeleteConfirmTarget: (target: DeleteConfirmTarget | null) => void

  // Vault selection
  selectedVaultIds: string[]
  setSelectedVaultIds: React.Dispatch<React.SetStateAction<string[]>>

  // History filter
  historyVaultFilter: string
  setHistoryVaultFilter: (filter: string) => void

  // Operations
  handleRunBackup: () => Promise<void>
  handleRestore: () => Promise<void>
  handleDeleteSnapshot: () => Promise<void>
  handleDesignateThisMachine: () => Promise<void>
  handleClearDesignatedMachine: () => Promise<void>
}

/**
 * Hook to manage backup and restore operations
 */
export function useBackupOperations(
  config: BackupConfig | null | undefined,
  orgId: string | undefined,
  _userId: string | undefined, // Reserved for future use
  userEmail: string | undefined,
  vaultPath: string | null,
  currentVaultId: string | undefined,
  connectedVaults: ConnectedVault[],
  isThisDesignated: boolean,
  isDesignatedOnline: boolean,
  addToast: (type: 'success' | 'error' | 'info', message: string, duration?: number) => void,
  loadStatus: () => Promise<void>,
): UseBackupOperationsReturn {
  const { t } = useTranslation()
  // Backup state
  const [isRunningBackup, setIsRunningBackup] = useState(false)
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null)

  // Restore state
  const [isRestoring, setIsRestoring] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null)

  // Delete state - track all snapshots being deleted (queued or in-progress)
  const [deletingSnapshotIds, setDeletingSnapshotIds] = useState<Set<string>>(new Set())
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<DeleteConfirmTarget | null>(null)

  // Vault selection
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([])

  // History filter
  const [historyVaultFilter, setHistoryVaultFilter] = useState<string>('all')

  // Initialize selected vaults when connected vaults change
  useEffect(() => {
    if (connectedVaults.length > 0 && selectedVaultIds.length === 0) {
      setSelectedVaultIds(connectedVaults.map((v) => v.id))
    }
  }, [connectedVaults, selectedVaultIds.length])

  // Restore backup running state on mount (survives tab switches)
  useEffect(() => {
    if (isBackupRunningLocally()) {
      setIsRunningBackup(true)
      setBackupProgress({
        phase: 'Backing up',
        percent: 50,
        message: t('backup.progressResumed'),
      })
    }
    // Also check the main process in case the module flag was lost (e.g., hot reload)
    window.electronAPI?.isBackupRunning?.().then((result) => {
      if (result?.running) {
        setIsRunningBackup(true)
        setBackupRunningLocally(true)
        setBackupProgress({ phase: t('backup.backingUp'), percent: 50, message: t('backup.inProgress') })
      }
    })
  }, [t])

  // Internal function to actually run the backup (used by designated machine)
  const handleRunBackupInternal = useCallback(
    async (backupConfig: BackupConfig) => {
      const vaultsToBackup = connectedVaults.filter((v) => selectedVaultIds.includes(v.id))

      window.electronAPI?.log('info', '[Backup] handleRunBackupInternal called', {
        configOrgId: backupConfig.org_id,
        vaultsToBackup: vaultsToBackup.map((v) => ({ id: v.id, name: v.name })),
        selectedVaultIds,
      })

      if (vaultsToBackup.length === 0) {
        addToast('error', t('backup.noVaultsSelected'))
        return
      }

      setIsRunningBackup(true)
      setBackupRunningLocally(true)
      setBackupProgress({ phase: t('backup.starting'), percent: 0, message: t('backup.initializing') })

      // Mark backup as started in database
      await markBackupStarted(orgId || '')

      const cleanupProgress = window.electronAPI?.onBackupProgress?.((progress) => {
        setBackupProgress(progress)
      })

      let successCount = 0
      let failCount = 0

      try {
        for (let i = 0; i < vaultsToBackup.length; i++) {
          const vault = vaultsToBackup[i]
          setBackupProgress({
            phase: t('backup.vaultProgress', { current: i + 1, total: vaultsToBackup.length }),
            percent: Math.round((i / vaultsToBackup.length) * 100),
            message: t('backup.backingUpVault', { name: vault.name }),
          })

          try {
            window.electronAPI?.log('info', '[Backup] Running backup for vault', {
              vaultId: vault.id,
              vaultName: vault.name,
              vaultPath: vault.localPath,
              configOrgId: backupConfig.org_id,
            })
            const result = await runBackup(backupConfig, {
              vaultId: vault.id,
              vaultName: vault.name,
              vaultPath: vault.localPath,
            })

            if (result.success) {
              successCount++
              addToast('success', t('backup.vaultBackedUp', { name: vault.name, snapshot: result.snapshotId?.substring(0, 8) ?? '' }))
            } else {
              failCount++
              addToast('error', t('backup.saveFailed'))
            }
          } catch (error) {
            failCount++
            log.error('[Backup]', `Backup failed for ${vault.name}`, { error: error })
            addToast(
              'error',
              t('backup.vaultBackupFailed', { name: vault.name, error: error instanceof Error ? error.message : String(error) }),
            )
          }
        }
      } finally {
        cleanupProgress?.()
        // Mark backup as complete
        await markBackupComplete(orgId || '')
        setIsRunningBackup(false)
        setBackupRunningLocally(false)
        setBackupProgress(null)
        await loadStatus()

        if (vaultsToBackup.length > 1) {
          addToast('info', t('backup.summary', { succeeded: successCount, failed: failCount }))
        }
      }
    },
    [connectedVaults, selectedVaultIds, orgId, addToast, loadStatus],
  )

  // The service only ever calls the latest handler, so holding it in a ref keeps it out
  // of the effect's dependencies. Otherwise every change to connectedVaults,
  // selectedVaultIds or loadStatus tears the service down and restarts it.
  const runBackupInternalRef = useRef(handleRunBackupInternal)
  useEffect(() => {
    runBackupInternalRef.current = handleRunBackupInternal
  }, [handleRunBackupInternal])

  // Start backup service if this is the designated machine
  useEffect(() => {
    if (!isThisDesignated || !orgId || !currentVaultId) return

    log.info('[Backup]', 'This is the designated machine, starting backup service')

    startBackupService(
      orgId,
      currentVaultId,
      async (backupConfig) => {
        // Backup request received - run the backup
        await runBackupInternalRef.current(backupConfig)
      },
      async () => {
        // Fetch fresh config from database each time
        return await getBackupConfig(orgId)
      },
    )

    return () => {
      stopBackupService()
    }
  }, [isThisDesignated, orgId, currentVaultId])

  // Handle backup button click - either run locally or request remotely
  const handleRunBackup = useCallback(async () => {
    if (!config || !orgId) {
      addToast('error', t('backup.notConfigured'))
      return
    }

    // Check if there's a designated machine
    if (!config.designated_machine_id) {
      addToast('error', t('backup.noDesignatedMachine'))
      return
    }

    // If this is the designated machine, run locally
    if (isThisDesignated) {
      if (!currentVaultId) {
        addToast('error', 'No vault connected')
        return
      }
      await handleRunBackupInternal(config)
      return
    }

    // Otherwise, request backup from designated machine
    if (!isDesignatedOnline) {
      addToast('error', t('backup.machineOffline'))
      return
    }

    try {
      const result = await requestBackup(orgId, userEmail || '')
      if (result.success) {
        addToast(
          'success',
          t('backup.requestAccepted'),
        )
        await loadStatus()
      } else {
        addToast('error', t('backup.saveFailed'))
      }
    } catch (_err) {
      addToast('error', t('backup.requestFailed'))
    }
  }, [
    config,
    orgId,
    isThisDesignated,
    currentVaultId,
    isDesignatedOnline,
    userEmail,
    handleRunBackupInternal,
    addToast,
    loadStatus,
  ])

  // Restore from snapshot
  const handleRestore = useCallback(async () => {
    if (!selectedSnapshot || !config || !vaultPath) {
      addToast('error', t('backup.noSnapshotOrVault'))
      return
    }

    setIsRestoring(true)

    // Set up progress listener for restore operation
    const cleanupProgress = window.electronAPI?.onBackupProgress?.((progress) => {
      log.debug('[Restore]', 'Progress update', {
        phase: progress.phase,
        percent: progress.percent,
        message: progress.message,
      })
    })

    try {
      addToast('info', t('backup.restoringSnapshot', { snapshot: selectedSnapshot.substring(0, 8) }), 0)

      // Emit start log
      emitRendererLog({
        level: 'info',
        phase: 'restore',
        message: t('backup.restoreStarted', { snapshot: selectedSnapshot.substring(0, 8), path: vaultPath }),
      })

      const result = await restoreFromSnapshot(config, selectedSnapshot, vaultPath)

      if (result.success) {
        emitRendererLog({
          level: 'success',
          phase: 'restore',
          message: t('backup.fileRestoreCompleted'),
        })

        // If backup contains metadata, automatically import it
        if (result.hasMetadata) {
          addToast('info', t('backup.importingMetadata'), 0)

          emitRendererLog({
            level: 'info',
            phase: 'metadata_import',
            message: t('backup.metadataImportStarting'),
          })

          try {
            // Read the metadata file from the restored backup
            emitRendererLog({
              level: 'info',
              phase: 'metadata_import',
              message: t('backup.readingMetadata'),
            })

            const metadataResult = await window.electronAPI?.readBackupMetadata(vaultPath)

            log.debug('[Restore]', 'Metadata result', {
              success: metadataResult?.success,
              hasData: !!metadataResult?.data,
              dataKeys: metadataResult?.data ? Object.keys(metadataResult.data) : [],
              filesType: typeof metadataResult?.data?.files,
              filesIsArray: Array.isArray(metadataResult?.data?.files),
              vaultPath,
            })

            if (metadataResult?.success && metadataResult.data) {
              const fileCount = (metadataResult.data.files as unknown[])?.length || 0
              const versionCount = (metadataResult.data.fileVersions as unknown[])?.length || 0

              log.debug('[Restore]', 'File counts', { fileCount, versionCount })

              emitRendererLog({
                level: 'info',
                phase: 'metadata_import',
                message: t('backup.metadataFound', { files: fileCount, versions: versionCount }),
              })

              // Import the metadata into the database
              // Cast the data to DatabaseExport since the IPC returns a loosely typed version
              const importResult = await importDatabaseMetadata(
                metadataResult.data as DatabaseExport,
                {
                  restoreDeleted: true,
                },
              )

              if (importResult.success && importResult.stats) {
                const { filesRestored, versionsRestored, skipped } = importResult.stats

                emitRendererLog({
                  level: 'success',
                  phase: 'complete',
                  message: t('backup.metadataImportComplete', { files: filesRestored, versions: versionsRestored, skipped }),
                  metadata: {
                    filesProcessed: filesRestored + versionsRestored,
                    operation: 'metadata_import',
                  },
                })

                addToast(
                  'success',
                  t('backup.restoreComplete', { files: filesRestored, versions: versionsRestored, skipped }),
                )
              } else {
                emitRendererLog({
                  level: 'error',
                  phase: 'metadata_import',
                  message: t('backup.metadataImportFailed', { error: importResult.error || t('backup.unknownError') }),
                  metadata: { error: importResult.error },
                })

                // Metadata import failed, but files were restored
                addToast('success', t('backup.filesRestored'))
                addToast(
                  'error',
                  t('backup.metadataImportFailed', { error: importResult.error || t('backup.unknownError') }),
                )
              }
            } else {
              emitRendererLog({
                level: 'error',
                phase: 'metadata_import',
                message: t('backup.metadataReadFailed', { error: metadataResult?.error || t('backup.unknownError') }),
                metadata: { error: metadataResult?.error },
              })

              // Couldn't read metadata file, but files were restored
              addToast('success', t('backup.filesRestored'))
              addToast(
                'error',
                t('backup.metadataReadFailed', { error: metadataResult?.error || t('backup.unknownError') }),
              )
            }
          } catch (metadataErr) {
            const errorMsg =
              metadataErr instanceof Error ? metadataErr.message : String(metadataErr)

            emitRendererLog({
              level: 'error',
              phase: 'metadata_import',
              message: t('backup.metadataImportFailed', { error: errorMsg }),
              metadata: { error: errorMsg },
            })

            // Metadata import threw an error, but files were restored
            addToast('success', t('backup.filesRestored'))
            addToast('error', t('backup.metadataImportFailed', { error: errorMsg }))
          }
        } else {
          emitRendererLog({
            level: 'success',
            phase: 'complete',
            message: t('backup.restoreCompletedNoMetadata'),
          })
          addToast('success', t('backup.filesRestored'))
        }

        setSelectedSnapshot(null)
      } else {
        emitRendererLog({
          level: 'error',
          phase: 'error',
          message: t('backup.restoreFailed', { error: result.error || t('backup.unknownError') }),
          metadata: { error: result.error },
        })
        addToast('error', result.error || t('backup.restoreFailedGeneric'))
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('[Restore]', 'Restore failed', { error: error })

      emitRendererLog({
        level: 'error',
        phase: 'error',
        message: t('backup.restoreFailed', { error: errorMsg }),
        metadata: { error: errorMsg },
      })

      addToast('error', t('backup.restoreFailed', { error: errorMsg }))
    } finally {
      cleanupProgress?.()
      setIsRestoring(false)
    }
  }, [selectedSnapshot, config, vaultPath, addToast])

  // Delete a snapshot (handles queuing automatically)
  const handleDeleteSnapshot = useCallback(async () => {
    if (!deleteConfirmTarget || !config) return

    const { id: snapshotId } = deleteConfirmTarget
    setDeleteConfirmTarget(null)

    // Add to the set of deleting snapshots (shows spinner immediately)
    setDeletingSnapshotIds((prev) => new Set([...prev, snapshotId]))

    try {
      // deleteSnapshot is queued internally - it will wait for other deletes to finish
      const result = await deleteSnapshot(config, snapshotId)

      if (result.success) {
        addToast('success', t('backup.snapshotDeleted', { snapshot: snapshotId.substring(0, 8) }))
      } else {
      addToast('error', t('backup.saveFailed'))
      }
    } catch (error) {
      log.error('[Backup]', 'Delete failed', { error: error })
      addToast('error', t('backup.deleteFailed'))
    } finally {
      // Remove from the set
      setDeletingSnapshotIds((prev) => {
        const next = new Set(prev)
        next.delete(snapshotId)

        // Only refresh the list when ALL deletes are done (queue is empty)
        if (next.size === 0) {
          // Use setTimeout to allow state to update before refresh
          setTimeout(() => loadStatus(), 100)
        }

        return next
      })
    }
  }, [deleteConfirmTarget, config, addToast, loadStatus])

  // Designate this machine as backup source
  const handleDesignateThisMachine = useCallback(async () => {
    if (!orgId || !userEmail) return

    const result = await designateThisMachine(orgId, userEmail)
    if (result.success) {
      addToast('success', t('backup.machineDesignated'))
      await loadStatus()
    } else {
      addToast('error', t('backup.saveFailed'))
    }
  }, [orgId, userEmail, addToast, loadStatus])

  // Clear designated machine
  const handleClearDesignatedMachine = useCallback(async () => {
    if (!orgId) return

    const result = await clearDesignatedMachine(orgId)
    if (result.success) {
      addToast('success', t('backup.designationCleared'))
      await loadStatus()
    } else {
      addToast('error', t('backup.saveFailed'))
    }
  }, [orgId, addToast, loadStatus])

  return {
    isRunningBackup,
    backupProgress,
    isRestoring,
    selectedSnapshot,
    setSelectedSnapshot,
    deletingSnapshotIds,
    deleteConfirmTarget,
    setDeleteConfirmTarget,
    selectedVaultIds,
    setSelectedVaultIds,
    historyVaultFilter,
    setHistoryVaultFilter,
    handleRunBackup,
    handleRestore,
    handleDeleteSnapshot,
    handleDesignateThisMachine,
    handleClearDesignatedMachine,
  }
}
