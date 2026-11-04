/**
 * Collaboration entries for the context menu (in the default layout under "More actions"):
 * `collab.whereUsed`, `properties`, `extractReferences`, `requestCheckout`, `notify`, `watch`,
 * `shareLink`, `addToEco`.
 */
import {
  ArrowDown,
  ClipboardList,
  Eye,
  EyeOff,
  Info,
  Link,
  Loader2,
  Network,
  Users,
} from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'
import type { RefreshableActionProps, SelectionState } from './types'
import type { EntryHookResult } from '../customizable/types'

export interface CollaborationEntriesProps extends RefreshableActionProps {
  state: SelectionState
  setDetailsPanelTab: (tab: 'properties' | 'whereused') => void
  setDetailsPanelVisible: (visible: boolean) => void
  handleOpenCheckoutRequestModal: (file: LocalFile) => void
  handleOpenMentionModal: (file: LocalFile) => void
  handleOpenECOModal: (file: LocalFile) => void
  watchingFiles: Set<string>
  isTogglingWatch: boolean
  handleToggleWatch: (file: LocalFile) => void
  isCreatingShareLink: boolean
  handleQuickShareLink: (file: LocalFile) => void
}

type CollaborationEntryId =
  | 'collab.whereUsed'
  | 'collab.properties'
  | 'collab.extractReferences'
  | 'collab.requestCheckout'
  | 'collab.notify'
  | 'collab.watch'
  | 'collab.shareLink'
  | 'collab.addToEco'

export function useCollaborationEntries({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
  state,
  setDetailsPanelTab,
  setDetailsPanelVisible,
  handleOpenCheckoutRequestModal,
  handleOpenMentionModal,
  handleOpenECOModal,
  watchingFiles,
  isTogglingWatch,
  handleToggleWatch,
  isCreatingShareLink,
  handleQuickShareLink,
}: CollaborationEntriesProps): EntryHookResult<CollaborationEntryId> {
  const { user, files, addToast } = usePDMStore(
    useShallow((s) => ({
      user: s.user,
      files: s.files,
      addToast: s.addToast,
    })),
  )
  const isFolder = firstFile.isDirectory

  // Check for SolidWorks assembly files
  const assemblyExtensions = ['.sldasm']
  const isAssemblyFile =
    !isFolder && state.isSynced && assemblyExtensions.includes(firstFile.extension.toLowerCase())

  // Get assembly files in folder (for Extract References)
  const getAssemblyFilesInFolder = () => {
    if (!isFolder || multiSelect) return []
    const folderPath = firstFile.relativePath
    return files.filter(
      (f) =>
        !f.isDirectory &&
        f.relativePath.startsWith(folderPath + '/') &&
        assemblyExtensions.includes(f.extension.toLowerCase()) &&
        f.pdmData?.id,
    )
  }
  const assemblyFilesInFolder = getAssemblyFilesInFolder()

  // Get synced assembly files from selection (for multi-select)
  const getAssemblyFilesInSelection = () => {
    if (!multiSelect) return []
    return contextFiles.filter(
      (f) =>
        !f.isDirectory && assemblyExtensions.includes(f.extension.toLowerCase()) && f.pdmData?.id,
    )
  }
  const assemblyFilesInSelection = getAssemblyFilesInSelection()

  const isSyncedSingleFile = !multiSelect && !isFolder && state.isSynced && !!firstFile.pdmData?.id
  // Extract References: a synced assembly, the assemblies of a multi-select, or the assemblies in
  // a folder (the first two can both apply when the first selected file is an assembly)
  const extractSingle = isAssemblyFile
  const extractSelection = multiSelect && assemblyFilesInSelection.length > 0
  const extractFolder = isFolder && !multiSelect && assemblyFilesInFolder.length > 0

  return {
    entries: {
      // Where Used - for synced files
      'collab.whereUsed':
        !isFolder && state.isSynced ? (
          <div
            className="context-menu-item"
            onClick={() => {
              onClose()
              setDetailsPanelTab('whereused')
              setDetailsPanelVisible(true)
            }}
          >
            <Link size={14} />
            Where Used
          </div>
        ) : null,
      'collab.properties': (
        <div
          className="context-menu-item"
          onClick={() => {
            onClose()
            setDetailsPanelTab('properties')
            setDetailsPanelVisible(true)
          }}
        >
          <Info size={14} />
          Properties
        </div>
      ),
      'collab.extractReferences':
        extractSingle || extractSelection || extractFolder ? (
          <>
            {extractSingle && (
              <div
                className="context-menu-item"
                onClick={() => {
                  onClose()
                  executeCommand('extract-references', { files: [firstFile] }, { onRefresh })
                }}
                title="Extract and store assembly component references to enable Contains/Where-Used queries"
              >
                <Network size={14} className="text-plm-accent" />
                Extract References
              </div>
            )}
            {extractSelection && (
              <div
                className="context-menu-item"
                onClick={() => {
                  onClose()
                  executeCommand(
                    'extract-references',
                    { files: assemblyFilesInSelection },
                    { onRefresh },
                  )
                }}
                title="Extract and store assembly component references to enable Contains/Where-Used queries"
              >
                <Network size={14} className="text-plm-accent" />
                Extract References ({assemblyFilesInSelection.length}{' '}
                {assemblyFilesInSelection.length === 1 ? 'assembly' : 'assemblies'})
              </div>
            )}
            {extractFolder && (
              <div
                className="context-menu-item"
                onClick={() => {
                  onClose()
                  executeCommand(
                    'extract-references',
                    { files: assemblyFilesInFolder },
                    { onRefresh },
                  )
                }}
                title="Extract and store assembly component references for all assemblies in this folder"
              >
                <Network size={14} className="text-plm-accent" />
                Extract References ({assemblyFilesInFolder.length}{' '}
                {assemblyFilesInFolder.length === 1 ? 'assembly' : 'assemblies'})
              </div>
            )}
          </>
        ) : null,
      // Request Checkout - for files checked out by others
      'collab.requestCheckout':
        !multiSelect &&
        !isFolder &&
        state.isSynced &&
        firstFile.pdmData?.checked_out_by &&
        firstFile.pdmData.checked_out_by !== user?.id ? (
          <div
            className="context-menu-item"
            onClick={() => handleOpenCheckoutRequestModal(firstFile)}
          >
            <ArrowDown size={14} className="text-plm-warning" />
            Request Checkout
          </div>
        ) : null,
      // Notify Someone - for synced files
      'collab.notify': isSyncedSingleFile ? (
        <div className="context-menu-item" onClick={() => handleOpenMentionModal(firstFile)}>
          <Users size={14} className="text-plm-fg-dim" />
          Notify Someone
        </div>
      ) : null,
      // Watch/Unwatch File - for synced files
      'collab.watch':
        isSyncedSingleFile && firstFile.pdmData ? (
          <div
            className={`context-menu-item ${isTogglingWatch ? 'opacity-50' : ''}`}
            onClick={() => handleToggleWatch(firstFile)}
          >
            {isTogglingWatch ? (
              <Loader2 size={14} className="animate-spin" />
            ) : watchingFiles.has(firstFile.pdmData.id) ? (
              <EyeOff size={14} className="text-plm-fg-muted" />
            ) : (
              <Eye size={14} className="text-plm-accent" />
            )}
            {watchingFiles.has(firstFile.pdmData!.id) ? 'Stop Watching' : 'Watch File'}
          </div>
        ) : null,
      // Copy Share Link - for synced files and folders
      'collab.shareLink':
        !multiSelect && (state.isSynced || isFolder) ? (
          <div
            className={`context-menu-item ${isCreatingShareLink ? 'opacity-50' : ''}`}
            onClick={() => {
              if (isFolder) {
                addToast('info', 'Folder sharing coming soon! For now, share individual files.')
                onClose()
              } else if (!isCreatingShareLink && firstFile.pdmData?.id) {
                handleQuickShareLink(firstFile)
              }
            }}
          >
            {isCreatingShareLink ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link size={14} className="text-plm-accent" />
            )}
            Copy Share Link
          </div>
        ) : null,
      // Add to ECO - for synced files
      'collab.addToEco': isSyncedSingleFile ? (
        <div className="context-menu-item" onClick={() => handleOpenECOModal(firstFile)}>
          <ClipboardList size={14} className="text-plm-fg-dim" />
          Add to ECO
        </div>
      ) : null,
    },
  }
}
