/**
 * Sync entries for the context menu: `sync.download`, `sync.getLatest`, `sync.keepLocalOnly`
 * (Keep Local Only, a flyout) and `sync.firstCheckIn`.
 */
import { ArrowDown, ArrowUp, EyeOff, FileX, FolderX, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import type { LocalFile } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand, getCloudOnlyFilesFromSelection } from '@/lib/commands'
import { getOutdatedFilesFromSelection } from '@/lib/commands/handlers/getLatest'
import type { RefreshableActionProps, SelectionCounts, SelectionState } from './types'
import { ContextSubmenu } from '../components'
import { useFlyout } from '../customizable/flyout'
import type { EntryHookResult } from '../customizable/types'
import { SubmenuArrow } from '../components/SubmenuArrow'

export interface SyncEntriesProps extends RefreshableActionProps {
  counts: SelectionCounts
  state: SelectionState
  unsyncedFilesInSelection: LocalFile[]
}

type SyncEntryId = 'sync.download' | 'sync.getLatest' | 'sync.keepLocalOnly' | 'sync.firstCheckIn'

export function useSyncEntries({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
  counts,
  state,
  unsyncedFilesInSelection,
}: SyncEntriesProps): EntryHookResult<SyncEntryId> {
  const { files, activeVaultId } = usePDMStore(
    useShallow((s) => ({
      files: s.files,
      activeVaultId: s.activeVaultId,
    })),
  )

  const anyCloudOnly =
    counts.cloudOnlyCount > 0 || contextFiles.some((f) => f.diffStatus === 'cloud')

  // Cloud-only files drive the Download item; outdated files drive the Get Latest item below.
  // The two sets never overlap - each file is either 'cloud' or 'outdated', never both.
  const cloudOnlyFilesInSelection = getCloudOnlyFilesFromSelection(files, contextFiles)
  const outdatedFilesInSelection = getOutdatedFilesFromSelection(files, contextFiles)
  const anyOutdated =
    outdatedFilesInSelection.length > 0 || contextFiles.some((f) => f.diffStatus === 'outdated')
  const currentVaultId = activeVaultId
  // BluePLM Web keeps Download (a browser download) but has no local vault to update or upload.
  const desktop = hasDesktop()

  return {
    entries: {
      'sync.download': anyCloudOnly ? (
        <div
          className="context-menu-item text-plm-success"
          onClick={() => {
            onClose()
            // Use command system for consistent incremental store updates
            executeCommand('download', { files: cloudOnlyFilesInSelection }, { onRefresh })
          }}
        >
          <ArrowDown size={14} className="text-plm-success" />
          Download{' '}
          {counts.cloudOnlyCount > 0 ? `${counts.cloudOnlyCount} files` : multiSelect ? '' : ''}
        </div>
      ) : null,
      'sync.getLatest':
        desktop && anyOutdated ? (
          <div
            className="context-menu-item text-purple-400"
            onClick={() => {
              onClose()
              executeCommand('get-latest', { files: outdatedFilesInSelection }, { onRefresh })
            }}
          >
            <RefreshCw size={14} className="text-purple-400" />
            {t('fileOps.getLatest', 'Get Latest')}{' '}
            {outdatedFilesInSelection.length > 0 ? `${outdatedFilesInSelection.length} files` : ''}
          </div>
        ) : null,
      'sync.keepLocalOnly':
        desktop && state.anyUnsynced && !state.allCloudOnly && currentVaultId ? (
          <KeepLocalOnlyEntry
            contextFiles={contextFiles}
            multiSelect={multiSelect}
            firstFile={firstFile}
            onClose={onClose}
            onRefresh={onRefresh}
            state={state}
            currentVaultId={currentVaultId}
          />
        ) : null,
      'sync.firstCheckIn':
        desktop && state.anyUnsynced ? (
          <div
            className="context-menu-item"
            onClick={() => {
              onClose()
              executeCommand('sync', { files: contextFiles }, { onRefresh })
            }}
          >
            <ArrowUp size={14} className="text-plm-info" />
            First Check In{' '}
            {unsyncedFilesInSelection.length > 0
              ? `${unsyncedFilesInSelection.length} file${unsyncedFilesInSelection.length !== 1 ? 's' : ''}`
              : ''}
          </div>
        ) : null,
    },
  }
}

/** Keep Local Only (Ignore) - for unsynced files */
function KeepLocalOnlyEntry({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
  state,
  currentVaultId,
}: RefreshableActionProps & { state: SelectionState; currentVaultId: string }) {
  const { addIgnorePattern, getIgnorePatterns, addToast } = usePDMStore(
    useShallow((s) => ({
      addIgnorePattern: s.addIgnorePattern,
      getIgnorePatterns: s.getIgnorePatterns,
      addToast: s.addToast,
    })),
  )
  const flyout = useFlyout('sync.keepLocalOnly')

  return (
    <div
      className="context-menu-item relative"
      onMouseEnter={flyout.onMouseEnter}
      onMouseLeave={flyout.onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        flyout.toggle()
      }}
    >
      <EyeOff size={14} />
      Keep Local Only
      <SubmenuArrow />
      {/* Submenu */}
      {flyout.isOpen && (
        <ContextSubmenu
          minWidth={200}
          onMouseEnter={flyout.onMouseEnter}
          onMouseLeave={flyout.onMouseLeave}
        >
          {/* Ignore this specific file/folder */}
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              for (const file of contextFiles) {
                if (file.isDirectory) {
                  addIgnorePattern(currentVaultId, file.relativePath + '/')
                } else {
                  addIgnorePattern(currentVaultId, file.relativePath)
                }
              }
              addToast(
                'success',
                `Added ${contextFiles.length > 1 ? `${contextFiles.length} items` : contextFiles[0].name} to ignore list`,
              )
              onClose()
              onRefresh(true)
            }}
          >
            {state.isFolder ? <FolderX size={14} /> : <FileX size={14} />}
            This {state.isFolder ? 'folder' : 'file'}
            {multiSelect ? ` (${contextFiles.length})` : ''}
          </div>

          {/* Ignore all files with this extension - only for single file */}
          {!state.isFolder && !multiSelect && firstFile.extension && (
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation()
                const pattern = `*${firstFile.extension}`
                addIgnorePattern(currentVaultId, pattern)
                addToast('success', `Now ignoring all ${firstFile.extension} files`)
                onClose()
                onRefresh(true)
              }}
            >
              <FileX size={14} />
              All *{firstFile.extension} files
            </div>
          )}

          {/* Show current patterns count */}
          {(() => {
            const currentPatterns = getIgnorePatterns(currentVaultId)
            if (currentPatterns.length > 0) {
              return (
                <>
                  <div className="context-menu-separator" />
                  <div className="px-3 py-1.5 text-xs text-plm-fg-muted">
                    {currentPatterns.length} pattern{currentPatterns.length > 1 ? 's' : ''}{' '}
                    configured
                  </div>
                </>
              )
            }
            return null
          })()}
        </ContextSubmenu>
      )}
    </div>
  )
}
