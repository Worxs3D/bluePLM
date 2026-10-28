/**
 * The vault's disk watchers, moved out of App.tsx so the multi-machine simulator
 * (src/test/multi/) can mount the same code the app runs:
 *
 * - file changes: a debounced silent reload of the changed paths, unless every change was one the
 *   app expected; changes that arrive while an operation runs wait for it to finish;
 * - watcher recovery: a full silent reload when the main process lost events;
 * - directory added / removed in Explorer: the folder row is created or deleted on the server.
 */
import { useEffect } from 'react'

import { log } from '@/lib/logger'
import { recordMetric } from '@/lib/performanceMetrics'
import { deleteFolderByPath, syncFolder } from '@/lib/supabase'
import { clearSwReferencesCache } from '@/lib/solidworks'
import { syncDrawingReferencesInBackground } from '@/lib/solidworks/drawingReferenceSync'
import { logExplorer } from '@/lib/userActionLogger'
import { usePDMStore } from '@/stores/pdmStore'

/** Debounce delay (ms) for watcher-recovery reloads, which arrive in bursts */
const VAULT_RESYNC_DEBOUNCE_MS = 1000

/** How often changes held back by a running operation are looked at again. */
const DEFERRED_RETRY_MS = 1000

export function useVaultWatchers(
  vaultPath: string | null,
  loadFiles: (silent?: boolean, forceHashComputation?: boolean, changedRelativePaths?: string[]) => Promise<void>,
): void {
  // File change watcher - auto-refresh when files change externally
  // Enhanced suppression prevents redundant refreshes after downloads/get-latest operations
  useEffect(() => {
    if (!window.electronAPI || !vaultPath) return

    // Suppression window: ignore file watcher events for 3 seconds after an operation completes.
    // This handles the case where the watcher's debounce timer fires AFTER the operation clears
    // its processingOperations. The watcher would otherwise trigger a full filesystem rescan
    // even though the operation already applied incremental store updates.
    const SUPPRESSION_WINDOW_MS = 5000

    let refreshTimeout: NodeJS.Timeout | null = null
    // Paths reported since the debounce timer last fired.
    let debouncedPaths = new Set<string>()

    // Changes that arrive while an operation runs are looked at again once it is done. They used
    // to be dropped: a file moved in Explorer during a checkout stayed at its old place in the app
    // until the next manual refresh (src/test/multi/savedSequences.test.ts).
    let deferredPaths = new Set<string>()
    let retryTimeout: NodeJS.Timeout | null = null
    const deferUntilIdle = (paths: readonly string[]) => {
      for (const path of paths) deferredPaths.add(path)
      if (retryTimeout) return
      retryTimeout = setTimeout(() => {
        retryTimeout = null
        const retry = [...deferredPaths]
        deferredPaths = new Set()
        onFilesChanged(retry)
      }, DEFERRED_RETRY_MS)
    }

    const onFilesChanged = (changedFiles: string[]) => {
      logExplorer('FileWatcher onFilesChanged ENTRY', { changedFilesCount: changedFiles.length })
      const { syncProgress, processingOperations, lastOperationCompletedAt, expectedFileChanges } =
        usePDMStore.getState()

      const now = Date.now()
      const msSinceLastOp = now - lastOperationCompletedAt
      const withinSuppressionWindow = msSinceLastOp < SUPPRESSION_WINDOW_MS

      // Enhanced state logging for diagnostics
      window.electronAPI?.log('info', '[FileWatcher] Event received', {
        changedCount: changedFiles.length,
        timestamp: now,
      })
      recordMetric('FileWatcher', 'Event received', { changedCount: changedFiles.length })

      window.electronAPI?.log('info', '[FileWatcher] State check', {
        processingOpsCount: processingOperations.size,
        expectedChangesCount: expectedFileChanges.size,
        msSinceLastOp,
        withinSuppressionWindow,
        timestamp: now,
      })
      recordMetric('FileWatcher', 'State check', {
        processingOpsCount: processingOperations.size,
        expectedChangesCount: expectedFileChanges.size,
        msSinceLastOp,
        withinSuppressionWindow,
      })

      // Suppress if a sync operation is actively running
      if (syncProgress.isActive || processingOperations.size > 0) {
        window.electronAPI?.log('info', '[FileWatcher] Decision', {
          willTriggerRefresh: false,
          reason: 'operation_in_progress',
          timestamp: now,
        })
        recordMetric('FileWatcher', 'Decision: suppressed', {
          willTriggerRefresh: false,
          reason: 'operation_in_progress',
        })
        deferUntilIdle(changedFiles)
        return
      }

      // Filter out expected file changes (files we downloaded/updated ourselves)
      const unexpectedChanges = changedFiles.filter((filePath) => {
        // Normalize paths for comparison (handle Windows backslashes)
        const normalizedPath = filePath.replace(/\\/g, '/')
        return !expectedFileChanges.has(normalizedPath) && !expectedFileChanges.has(filePath)
      })

      const unexpectedCount = unexpectedChanges.length

      log.debug('[FileWatcher]', 'Files changed', {
        count: changedFiles.length,
        unexpectedCount,
        withinSuppressionWindow,
        expectedCount: expectedFileChanges.size,
      })

      // If all changes were expected and we're within the suppression window, skip refresh
      if (unexpectedCount === 0 && withinSuppressionWindow) {
        window.electronAPI?.log('info', '[FileWatcher] Decision', {
          unexpectedCount,
          willTriggerRefresh: false,
          reason: 'all_expected_within_window',
          timestamp: now,
        })
        recordMetric('FileWatcher', 'Decision: suppressed', {
          willTriggerRefresh: false,
          reason: 'all_expected_within_window',
        })
        log.debug('[FileWatcher]', 'Suppressing refresh - all changes were expected')
        return
      }

      // If no unexpected changes, skip refresh (even outside suppression window)
      if (unexpectedCount === 0) {
        window.electronAPI?.log('info', '[FileWatcher] Decision', {
          unexpectedCount,
          willTriggerRefresh: false,
          reason: 'no_unexpected_changes',
          timestamp: now,
        })
        recordMetric('FileWatcher', 'Decision: suppressed', {
          willTriggerRefresh: false,
          reason: 'no_unexpected_changes',
        })
        log.debug('[FileWatcher]', 'Skipping refresh - no unexpected changes')
        return
      }

      if (refreshTimeout) {
        clearTimeout(refreshTimeout)
      }

      // Every batch that lands inside the debounce is reloaded, not only the last one. Restarting
      // the timer used to drop the earlier batches' paths: an Explorer move reported as the old
      // path in one batch and the new path in the next reached the delta scan as the new path
      // alone, the old path stayed in the scan, and the move was not seen until a full scan
      // (blueplm-2026-10-26 log, 7000aw angular contact bearing).
      for (const path of unexpectedChanges) debouncedPaths.add(path)

      refreshTimeout = setTimeout(async () => {
        const unexpectedChanges = [...debouncedPaths]
        debouncedPaths = new Set()
        const currentState = usePDMStore.getState()
        if (currentState.syncProgress.isActive || currentState.processingOperations.size > 0) {
          window.electronAPI?.log('info', '[FileWatcher] Decision (after debounce)', {
            willTriggerRefresh: false,
            reason: 'operation_started_during_debounce',
            timestamp: Date.now(),
          })
          recordMetric('FileWatcher', 'Decision (debounced): suppressed', {
            willTriggerRefresh: false,
            reason: 'operation_started_during_debounce',
          })
          deferUntilIdle(unexpectedChanges)
          return
        }

        // Re-check suppression conditions after debounce
        const nowWithinWindow =
          Date.now() - currentState.lastOperationCompletedAt < SUPPRESSION_WINDOW_MS
        const stillExpected = unexpectedChanges.every(
          (f) =>
            currentState.expectedFileChanges.has(f.replace(/\\/g, '/')) ||
            currentState.expectedFileChanges.has(f),
        )

        if (stillExpected && nowWithinWindow) {
          window.electronAPI?.log('info', '[FileWatcher] Decision (after debounce)', {
            willTriggerRefresh: false,
            reason: 'now_expected_within_window',
            timestamp: Date.now(),
          })
          recordMetric('FileWatcher', 'Decision (debounced): suppressed', {
            willTriggerRefresh: false,
            reason: 'now_expected_within_window',
          })
          log.debug('[FileWatcher]', 'Suppressing refresh after debounce - changes now expected')
          refreshTimeout = null
          return
        }

        window.electronAPI?.log('info', '[FileWatcher] Decision (after debounce)', {
          unexpectedCount: unexpectedChanges.length,
          willTriggerRefresh: true,
          reason: 'unexpected_external_changes',
          timestamp: Date.now(),
        })
        recordMetric('FileWatcher', 'Decision: triggered refresh', {
          willTriggerRefresh: true,
          unexpectedCount: unexpectedChanges.length,
          reason: 'unexpected_external_changes',
        })
        log.debug('[FileWatcher]', 'Triggering loadFiles for unexpected external changes', {
          unexpectedCount: unexpectedChanges.length,
        })

        // Hand the changed paths through so the main process re-stats only those
        // instead of walking every entry in the vault.
        await loadFiles(true, false, unexpectedChanges)

        // Files on disk just changed, so anything read before this batch is stale.
        clearSwReferencesCache()

        // Sync drawing references in background (fire-and-forget).
        // When .slddrw files change, extract their model references via SW service
        // and upsert to file_references DB table so the reverse lookup stays in sync.
        syncDrawingReferencesInBackground(unexpectedChanges)

        // Metadata is deliberately not synced here. A watcher event cannot tell a user's edit
        // in SolidWorks apart from a write the app itself just made, and check-in writes
        // pending metadata into the document before hashing it. Refreshing on that event put
        // the values straight back into `pendingMetadata`, so the next check-in wrote them to
        // the file again and cut another version - drawings nobody had touched climbing a
        // version per cycle. Metadata now moves only when the user runs `sync-metadata`.

        refreshTimeout = null
      }, 1000)
    }
    const cleanup = window.electronAPI.onFilesChanged(onFilesChanged)

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout)
      cleanup()
    }
  }, [vaultPath, loadFiles])

  // Watcher recovery - the main process lost file events and can no longer say what
  // changed, so a full reload is the only way back to a correct view of the vault.
  useEffect(() => {
    if (!window.electronAPI || !vaultPath) return

    let resyncTimeout: NodeJS.Timeout | null = null

    const cleanup = window.electronAPI.onVaultResyncRequired((reason) => {
      window.electronAPI?.log('warn', '[FileWatcher] Full resync requested', { reason })

      if (resyncTimeout) clearTimeout(resyncTimeout)
      resyncTimeout = setTimeout(async () => {
        resyncTimeout = null
        const { syncProgress, processingOperations } = usePDMStore.getState()
        if (syncProgress.isActive || processingOperations.size > 0) return
        await loadFiles(true, false)
      }, VAULT_RESYNC_DEBOUNCE_MS)
    })

    return () => {
      if (resyncTimeout) clearTimeout(resyncTimeout)
      cleanup()
    }
  }, [vaultPath, loadFiles])

  // Directory change watcher - sync folder changes from Windows Explorer to server
  useEffect(() => {
    if (!window.electronAPI || !vaultPath) return

    const { organization, activeVaultId, user, isOfflineMode } = usePDMStore.getState()

    // Skip if offline or missing required data
    if (isOfflineMode || !organization?.id || !activeVaultId || !user?.id) return

    const orgId = organization.id
    const vaultId = activeVaultId
    const userId = user.id

    // Handle directory added - sync to server
    const cleanupAdded = window.electronAPI.onDirectoryAdded(async (relativePath) => {
      // Check suppression window - don't sync folders we just created ourselves
      const { lastOperationCompletedAt, expectedFileChanges } = usePDMStore.getState()
      const msSinceLastOp = Date.now() - lastOperationCompletedAt
      const SUPPRESSION_WINDOW_MS = 5000

      // Check if this is an expected change (we created it ourselves)
      if (expectedFileChanges.has(relativePath) && msSinceLastOp < SUPPRESSION_WINDOW_MS) {
        window.electronAPI?.log('debug', '[DirectoryWatcher] Skipping sync for expected folder', {
          relativePath,
        })
        return
      }

      window.electronAPI?.log('info', '[DirectoryWatcher] Syncing new folder to server', {
        relativePath,
      })

      try {
        const result = await syncFolder(orgId, vaultId, userId, relativePath)
        if (result.error) {
          window.electronAPI?.log('warn', '[DirectoryWatcher] Failed to sync folder', {
            relativePath,
            error: result.error,
          })
        } else {
          window.electronAPI?.log('info', '[DirectoryWatcher] Folder synced to server', {
            relativePath,
            folderId: result.folder?.id,
          })
        }
      } catch (error) {
        window.electronAPI?.log('warn', '[DirectoryWatcher] Exception syncing folder', {
          relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    // Handle directory removed - delete from server
    const cleanupRemoved = window.electronAPI.onDirectoryRemoved(async (relativePath) => {
      // Check suppression window - don't delete folders we just deleted ourselves
      const { lastOperationCompletedAt, expectedFileChanges } = usePDMStore.getState()
      const msSinceLastOp = Date.now() - lastOperationCompletedAt
      const SUPPRESSION_WINDOW_MS = 5000

      // Check if this is an expected change (we deleted it ourselves)
      if (expectedFileChanges.has(relativePath) && msSinceLastOp < SUPPRESSION_WINDOW_MS) {
        window.electronAPI?.log('debug', '[DirectoryWatcher] Skipping delete for expected folder', {
          relativePath,
        })
        return
      }

      window.electronAPI?.log('info', '[DirectoryWatcher] Deleting folder from server', {
        relativePath,
      })

      try {
        const result = await deleteFolderByPath(vaultId, relativePath, userId)
        if (result.error) {
          window.electronAPI?.log(
            'warn',
            '[DirectoryWatcher] Failed to delete folder from server',
            {
              relativePath,
              error: result.error,
            },
          )
        } else {
          window.electronAPI?.log('info', '[DirectoryWatcher] Folder deleted from server', {
            relativePath,
          })
        }
      } catch (error) {
        window.electronAPI?.log('warn', '[DirectoryWatcher] Exception deleting folder', {
          relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    return () => {
      cleanupAdded()
      cleanupRemoved()
    }
  }, [vaultPath])
}
