/**
 * The explorer tree's right-click menu.
 *
 * Each entry hook (`items/*`, and the file list's Generate, Reviews, folder visibility and vault
 * transfer hooks) says which of its entries apply to the selection and draws them;
 * `CustomizableMenu` lays them out from the person's layout (own, organization template or the
 * app default, `useContextMenuLayout`), the same layout as the file list's menu. The tree's
 * entries keep their own conditions and labels. Dialogs are driven by `useContextMenuState` and
 * rendered beside the menu, never inside it, so moving or hiding an entry cannot unmount one.
 */
import { useOrdersEntries } from '@/features/orders/contextMenu/OrdersEntry'
import { useRef, type ReactNode } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import {
  executeCommand,
  getSyncedFilesFromSelection,
  getUnsyncedFilesFromSelection,
  getCloudOnlyFilesFromSelection,
  getDiscardableFilesFromSelection,
} from '@/lib/commands'
import { watchFile, unwatchFile, createShareLink } from '@/lib/supabase'
import { copyToClipboard } from '@/lib/clipboard'

// Import from local modules
import { useMenuPosition, useContextMenuState } from './hooks'
import { getCountLabel } from '@/lib/utils'

// Entry hooks
import {
  useTreeAdminEntries,
  useTreeClipboardEntries,
  useTreeCollaborationEntries,
  useTreeDeleteEntries,
  useTreeFileOperationEntries,
  useTreeMovedFileEntries,
  useTreeNavigationEntries,
  useTreePDMEntries,
} from './items'
import {
  useFolderVisibilityEntries,
  useGenerateEntries,
  useReviewsEntries,
} from '@/features/source/browser/components/ContextMenu/actions'
import { CustomizableMenu } from '@/features/source/browser/components/ContextMenu/customizable/CustomizableMenu'
import { useVaultTransferEntries } from '@/features/source/vaultTransferMenu/VaultTransferMenuItems'
import type { TreeMenuEntryId } from './treeEntries'

// Dialog components
import { DeleteConfirmDialog } from './dialogs'
import { DeleteLocalConfirmDialog } from './dialogs'
import { ForceCheckinDialog } from './dialogs'
import { PropertiesDialog } from './dialogs'
import { CheckoutRequestDialog } from './dialogs'
import { MentionDialog } from './dialogs'
import { ShareLinkDialog } from './dialogs'
import { AddToECODialog } from './dialogs'
import { MatchGhostFileDialog } from './dialogs'
import { ResolveMovedFilesDialog } from './dialogs'

import type { FileContextMenuProps } from './types'
import type { LocalFile } from '@/stores/pdmStore'

/**
 * Check if a folder has any local content (files that exist locally, not just on server).
 * This derives folder status from children rather than relying on potentially stale folder diffStatus.
 */
function folderHasLocalContent(folderPath: string, files: LocalFile[]): boolean {
  const normalizedPath = folderPath.replace(/\\/g, '/')
  return files.some((f) => {
    if (f.isDirectory) return false
    const filePath = f.relativePath.replace(/\\/g, '/')
    return filePath.startsWith(normalizedPath + '/') && f.diffStatus !== 'cloud'
  })
}

export function FileContextMenu(props: FileContextMenuProps) {
  // Nothing selected: no menu (every entry hook below expects a first file)
  if (props.contextFiles.length === 0) return null
  return <TreeFileContextMenu {...props} />
}

function TreeFileContextMenu({
  x,
  y,
  files,
  contextFiles,
  onClose,
  onRefresh,
  clipboard,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onNewFolder,
}: FileContextMenuProps) {
  const {
    user,
    activeVaultId,
    addToast,
    pinnedFolders,
    pinFolder,
    unpinFolder,
    connectedVaults,
    addIgnorePattern,
    getIgnorePatterns,
    serverFolderPaths,
    organization,
  } = usePDMStore(
    useShallow((s) => ({
      user: s.user,
      activeVaultId: s.activeVaultId,
      addToast: s.addToast,
      pinnedFolders: s.pinnedFolders,
      pinFolder: s.pinFolder,
      unpinFolder: s.unpinFolder,
      connectedVaults: s.connectedVaults,
      addIgnorePattern: s.addIgnorePattern,
      getIgnorePatterns: s.getIgnorePatterns,
      serverFolderPaths: s.serverFolderPaths,
      organization: s.organization,
    })),
  )

  const menuRef = useRef<HTMLDivElement>(null)

  // Use custom hooks
  const { position } = useMenuPosition(x, y, menuRef)
  const state = useContextMenuState({
    userId: user?.id,
    organizationId: organization?.id,
    contextFiles,
  })

  // Computed values
  const currentVault = connectedVaults.find((v) => v.id === activeVaultId)
  const currentVaultName = currentVault?.name || 'Vault'

  const multiSelect = contextFiles.length > 1
  const firstFile = contextFiles[0]
  const isFolder = firstFile.isDirectory
  const allFolders = contextFiles.every((f) => f.isDirectory)
  const fileCount = contextFiles.filter((f) => !f.isDirectory).length
  const folderCount = contextFiles.filter((f) => f.isDirectory).length

  // Use command system helpers for file categorization
  const syncedFilesInSelection = getSyncedFilesFromSelection(files, contextFiles)
  const unsyncedFilesInSelection = getUnsyncedFilesFromSelection(files, contextFiles)
  const cloudOnlyFilesInSelection = getCloudOnlyFilesFromSelection(files, contextFiles)

  const anySynced = syncedFilesInSelection.length > 0
  const anyUnsynced = unsyncedFilesInSelection.length > 0
  const anyCloudOnly =
    cloudOnlyFilesInSelection.length > 0 || contextFiles.some((f) => f.diffStatus === 'cloud')

  // Check out/in status
  const allCheckedOut =
    syncedFilesInSelection.length > 0 &&
    syncedFilesInSelection.every((f) => f.pdmData?.checked_out_by)
  const allCheckedIn =
    syncedFilesInSelection.length > 0 &&
    syncedFilesInSelection.every((f) => !f.pdmData?.checked_out_by)

  // Count files that can be checked out/in
  const checkoutableCount = syncedFilesInSelection.filter((f) => !f.pdmData?.checked_out_by).length
  const checkinableCount = syncedFilesInSelection.filter(
    (f) => f.pdmData?.checked_out_by === user?.id,
  ).length
  const checkedOutByOthersCount = syncedFilesInSelection.filter(
    (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id,
  ).length
  const effectiveRole = usePDMStore.getState().getEffectiveRole()
  const isAdmin = effectiveRole === 'admin'

  // Discardable files
  const discardableFilesInSelection = getDiscardableFilesFromSelection(
    files,
    contextFiles,
    user?.id,
  )
  const discardableCount = discardableFilesInSelection.length

  const countLabel = getCountLabel(fileCount, folderCount)

  // Check for cloud-only files
  // For folders, derive cloud-only status from children (not stale folder diffStatus)
  const allCloudOnly = contextFiles.every((f) => {
    if (f.isDirectory) {
      // A folder is cloud-only if it has NO local children (all cloud or empty)
      return !folderHasLocalContent(f.relativePath, files)
    }
    return f.diffStatus === 'cloud'
  })
  const cloudOnlyCount = cloudOnlyFilesInSelection.length

  // Check for local folders (folders with local content)
  // Derive from children rather than relying on folder's own diffStatus
  const hasLocalFolders = contextFiles.some(
    (f) => f.isDirectory && folderHasLocalContent(f.relativePath, files),
  )

  // Check if any selected folders exist on server
  const hasFoldersOnServer = contextFiles.some((f) => {
    if (!f.isDirectory) return false
    const normalizedPath = f.relativePath.replace(/\\/g, '/')
    return serverFolderPaths.has(normalizedPath)
  })

  // ============================================
  // Handler functions
  // ============================================

  const handleToggleWatch = async () => {
    if (!user?.id || !organization?.id) return

    const syncedFile = contextFiles.find((f) => f.pdmData?.id)
    if (!syncedFile || !syncedFile.pdmData) return

    state.setIsTogglingWatch(true)

    if (state.isWatching) {
      const { success, error } = await unwatchFile(syncedFile.pdmData.id, user.id)
      if (success) {
        state.setIsWatching(false)
        addToast('info', `Stopped watching ${syncedFile.name}`)
      } else {
        addToast('error', error || 'Failed to unwatch file')
      }
    } else {
      const { success, error } = await watchFile(organization.id, syncedFile.pdmData.id, user.id)
      if (success) {
        state.setIsWatching(true)
        addToast('success', `Now watching ${syncedFile.name}`)
      } else {
        addToast('error', error || 'Failed to watch file')
      }
    }

    state.setIsTogglingWatch(false)
    onClose()
  }

  const handleQuickShareLink = async () => {
    if (!user?.id || !organization?.id || !firstFile.pdmData?.id) {
      addToast('error', 'File must be synced to create a share link')
      return
    }

    state.setIsCreatingShareLink(true)

    const { link, error } = await createShareLink(organization.id, firstFile.pdmData.id, user.id, {
      expiresInDays: 7,
    })

    if (error) {
      addToast('error', error)
    } else if (link) {
      const result = await copyToClipboard(link.downloadUrl)
      if (result.success) {
        addToast('success', 'Share link copied! (expires in 7 days)')
      } else {
        state.setGeneratedShareLink(link.downloadUrl)
        state.openDialog('shareLink')
      }
    }

    state.setIsCreatingShareLink(false)
    onClose()
  }

  const handleCopyShareLink = async () => {
    if (!state.generatedShareLink) return

    const result = await copyToClipboard(state.generatedShareLink)
    if (result.success) {
      state.setCopiedLink(true)
      addToast('success', 'Link copied to clipboard!')
      setTimeout(() => state.setCopiedLink(false), 2000)
    } else {
      addToast('error', 'Failed to copy link')
    }
  }

  // Delete confirmation handlers
  const handleDeleteConfirm = () => {
    state.closeDialog('deleteConfirm')
    const keepLocal = state.deleteServerKeepLocal
    state.setDeleteServerKeepLocal(false)
    state.setDeleteConfirmFiles([])
    onClose()
    executeCommand('delete-server', { files: contextFiles, deleteLocal: !keepLocal }, { onRefresh })
  }

  const handleCheckinThenDeleteLocal = async () => {
    state.closeDialog('deleteLocalConfirm')
    onClose()
    await executeCommand('checkin', { files: contextFiles }, { onRefresh })
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }

  const handleDiscardAndDeleteLocal = () => {
    state.closeDialog('deleteLocalConfirm')
    onClose()
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }

  const handleForceCheckin = () => {
    state.closeDialog('forceCheckin')
    state.setForceCheckinFiles(null)
    onClose()
    executeCommand('checkin', { files: contextFiles }, { onRefresh })
  }

  const handleMatchGhostConfirm = (selectedCandidate: LocalFile) => {
    const ghostFile = state.matchGhostFile
    if (!ghostFile) return
    state.closeDialog('matchGhostFile')
    state.setMatchGhostFile(null)
    state.setMatchGhostCandidates([])
    onClose()
    executeCommand('match-ghost-file', { ghostFile, targetFile: selectedCandidate }, { onRefresh })
  }

  // ============================================
  // Entries
  // ============================================

  const base = { contextFiles, multiSelect, firstFile, onClose }

  const pdm = useTreePDMEntries({
    files,
    contextFiles,
    syncedFilesInSelection,
    unsyncedFilesInSelection,
    anySynced,
    anyUnsynced,
    anyCloudOnly,
    allCloudOnly,
    allCheckedOut,
    allCheckedIn,
    checkoutableCount,
    checkinableCount,
    discardableCount,
    allFolders,
    multiSelect,
    countLabel,
    cloudOnlyCount,
    userId: user?.id,
    checkForDifferentMachineCheckout: state.checkForDifferentMachineCheckout,
    openDialog: state.openDialog,
    setMatchGhostFile: state.setMatchGhostFile,
    setMatchGhostCandidates: state.setMatchGhostCandidates,
    onClose,
    onRefresh,
  })
  const generate = useGenerateEntries(base)
  const reviews = useReviewsEntries(base)
  const orders = useOrdersEntries(base)
  const fileOperations = useTreeFileOperationEntries({
    firstFile,
    multiSelect,
    isFolder,
    platform: state.platform,
    userId: user?.id,
    onRename,
    onNewFolder,
    onClose,
    onRefresh,
  })
  const navigation = useTreeNavigationEntries({
    firstFile,
    files,
    multiSelect,
    isFolder,
    activeVaultId,
    currentVaultName,
    pinnedFolders,
    onClose,
    onRefresh,
    openDialog: state.openDialog,
    setFolderSize: state.setFolderSize,
    setIsCalculatingSize: state.setIsCalculatingSize,
    addToast,
    pinFolder,
    unpinFolder,
  })
  // Clipboard and Copy / Move to another connected vault (hidden when there is none to go to)
  // both move files on disk, so not on BluePLM Web (each hook checks)
  const clipboardEntries = useTreeClipboardEntries({ clipboard, onCopy, onCut, onPaste, onClose })
  const vaultTransfer = useVaultTransferEntries(contextFiles, onClose)
  const collaboration = useTreeCollaborationEntries({
    firstFile,
    multiSelect,
    isFolder,
    anySynced,
    userId: user?.id,
    isWatching: state.isWatching,
    isTogglingWatch: state.isTogglingWatch,
    isCreatingShareLink: state.isCreatingShareLink,
    onToggleWatch: handleToggleWatch,
    onQuickShareLink: handleQuickShareLink,
    openDialog: state.openDialog,
    onClose,
    addToast,
  })
  // Hide folder from non-admins (cosmetic decluttering, not access control), audit its metadata
  const folderVisibility = useFolderVisibilityEntries(base)
  // Resolve Moved Files - for a single file that is 'moved' or 'moved_away' (desktop only)
  const moved = useTreeMovedFileEntries({ firstFile, multiSelect, openDialog: state.openDialog })
  const admin = useTreeAdminEntries({
    contextFiles,
    isAdmin,
    checkedOutByOthersCount,
    onClose,
    onRefresh,
  })
  const deletion = useTreeDeleteEntries({
    files,
    contextFiles,
    syncedFilesInSelection,
    unsyncedFilesInSelection,
    cloudOnlyFilesInSelection,
    anySynced,
    anyUnsynced,
    allCloudOnly,
    isFolder,
    multiSelect,
    folderCount,
    hasLocalFolders,
    hasFoldersOnServer,
    activeVaultId,
    userId: user?.id,
    onClose,
    onRefresh,
    openDialog: state.openDialog,
    setDeleteConfirmFiles: state.setDeleteConfirmFiles,
    setDeleteServerKeepLocal: state.setDeleteServerKeepLocal,
    setDeleteLocalCheckedOutFiles: state.setDeleteLocalCheckedOutFiles,
    addIgnorePattern,
    getIgnorePatterns,
    addToast,
    firstFile,
  })

  // Every id the tree offers (`TREE_MENU_ENTRY_IDS`): the compiler holds the hooks to it.
  const entries: Record<TreeMenuEntryId, ReactNode | null> = {
    ...pdm.entries,
    ...generate.entries,
    ...reviews.entries,
    ...orders.entries,
    ...fileOperations.entries,
    ...navigation.entries,
    ...clipboardEntries.entries,
    ...vaultTransfer.entries,
    ...collaboration.entries,
    ...folderVisibility.entries,
    ...moved.entries,
    ...admin.entries,
    ...deletion.entries,
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />

      {/* Context Menu */}
      <div
        ref={menuRef}
        className="context-menu z-[60]"
        style={{ left: position.x, top: position.y }}
      >
        {/* Keyed by the click, so each opening starts with "More actions" and every flyout closed */}
        <CustomizableMenu key={`${x},${y},${firstFile.path}`} entries={entries} onClose={onClose} />
      </div>

      {/* ============================================ */}
      {/* Dialogs */}
      {/* ============================================ */}

      <DeleteConfirmDialog
        isOpen={state.dialogs.deleteConfirm}
        onClose={() => {
          state.closeDialog('deleteConfirm')
          state.setDeleteServerKeepLocal(false)
          onClose()
        }}
        files={state.deleteConfirmFiles}
        keepLocal={state.deleteServerKeepLocal}
        onConfirm={handleDeleteConfirm}
      />

      <DeleteLocalConfirmDialog
        isOpen={state.dialogs.deleteLocalConfirm}
        onClose={() => {
          state.closeDialog('deleteLocalConfirm')
          onClose()
        }}
        checkedOutFiles={state.deleteLocalCheckedOutFiles}
        onCheckinThenDelete={handleCheckinThenDeleteLocal}
        onDiscardAndDelete={handleDiscardAndDeleteLocal}
      />

      <ForceCheckinDialog
        isOpen={state.dialogs.forceCheckin}
        onClose={() => {
          state.closeDialog('forceCheckin')
          state.setForceCheckinFiles(null)
          onClose()
        }}
        filesOnDifferentMachine={state.forceCheckinFiles?.filesOnDifferentMachine || []}
        machineNames={state.forceCheckinFiles?.machineNames || []}
        anyMachineOnline={state.forceCheckinFiles?.anyMachineOnline || false}
        onForceCheckin={handleForceCheckin}
      />

      <PropertiesDialog
        isOpen={state.dialogs.properties}
        onClose={() => {
          state.closeDialog('properties')
          onClose()
        }}
        file={firstFile}
        isFolder={isFolder}
        multiSelect={multiSelect}
        contextFiles={contextFiles}
        userId={user?.id}
        folderSize={state.folderSize}
        isCalculatingSize={state.isCalculatingSize}
      />

      <CheckoutRequestDialog
        isOpen={state.dialogs.checkoutRequest}
        onClose={() => state.closeDialog('checkoutRequest')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        onSuccess={onClose}
      />

      <MentionDialog
        isOpen={state.dialogs.mention}
        onClose={() => state.closeDialog('mention')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        onSuccess={onClose}
      />

      <ShareLinkDialog
        isOpen={state.dialogs.shareLink}
        onClose={() => {
          state.closeDialog('shareLink')
          state.setGeneratedShareLink(null)
          onClose()
        }}
        generatedLink={state.generatedShareLink}
        onCopyLink={handleCopyShareLink}
        copiedLink={state.copiedLink}
      />

      <AddToECODialog
        isOpen={state.dialogs.addToECO}
        onClose={() => state.closeDialog('addToECO')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        onSuccess={onClose}
      />

      <MatchGhostFileDialog
        isOpen={state.dialogs.matchGhostFile}
        onClose={() => {
          state.closeDialog('matchGhostFile')
          state.setMatchGhostFile(null)
          state.setMatchGhostCandidates([])
          onClose()
        }}
        ghostFile={state.matchGhostFile}
        candidates={state.matchGhostCandidates}
        onConfirm={handleMatchGhostConfirm}
      />

      <ResolveMovedFilesDialog
        isOpen={state.dialogs.resolveMoves}
        onClose={() => {
          state.closeDialog('resolveMoves')
          onClose()
        }}
        contextFile={firstFile}
        onRefresh={onRefresh}
      />
    </>
  )
}
