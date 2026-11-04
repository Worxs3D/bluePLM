/**
 * The file list's right-click menu.
 *
 * Each entry hook (`actions/*`) says which of its entries apply to the selection and draws them;
 * `CustomizableMenu` lays them out from the person's layout (own, organization template or the
 * app default, `useContextMenuLayout`). The hooks all run on every render, so availability is
 * just "the hook returned an element", and the dialogs they open (overlays) are rendered beside
 * the menu, never inside it, so moving or hiding an entry cannot unmount one.
 */
import { useOrdersEntries } from '@/features/orders/contextMenu/OrdersEntry'
import React from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'

import {
  useOpenEntries,
  useAssemblyEntries,
  useBulkAssemblyEntries,
  useDuplicateEntries,
  useFileSystemEntries,
  useFolderVisibilityEntries,
  useClipboardEntries,
  useSyncEntries,
  useCheckoutEntries,
  useCollaborationEntries,
  useDeleteEntries,
  useGenerateEntries,
  useReviewsEntries,
  useContextMenuSelectionState,
} from './actions'
import { useVaultTransferEntries } from '@/features/source/vaultTransferMenu/VaultTransferMenuItems'
import { NativePreviewContextMenuBackdrop } from './NativePreviewContextMenuBackdrop'
import { CustomizableMenu } from './customizable/CustomizableMenu'
import type { ListMenuEntryId } from './customizable/listEntries'

export interface FileContextMenuProps {
  // Core menu data (required)
  contextMenu: { x: number; y: number; file: LocalFile }
  contextMenuAdjustedPos: { x: number; y: number } | null
  onClose: () => void

  // Ref for positioning (from useContextMenuState)
  contextMenuRef: React.RefObject<HTMLDivElement | null>

  // Files and context
  getContextMenuFiles: () => LocalFile[]

  // Platform (not in context)
  platform: string

  // Handlers for file operations
  onRefresh: (silent?: boolean) => void
  navigateToFolder: (path: string) => void
  startRenaming: (file: LocalFile) => void

  // Search context: when a result row's menu is opened during a search, offer a jump to its folder
  isSearching?: boolean
  onGoToFolder?: (file: LocalFile) => void

  // Clipboard operations
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void

  // Checkout folder operations
  handleCheckoutFolder: (folder: LocalFile) => void
  handleCheckinFolder: (folder: LocalFile) => void

  // State change
  handleBulkStateChange: (files: LocalFile[], newState: string) => void

  // Modals and panels
  setDetailsPanelTab: (tab: 'properties' | 'whereused') => void
  setDetailsPanelVisible: (visible: boolean) => void
  handleOpenCheckoutRequestModal: (file: LocalFile) => void
  handleOpenMentionModal: (file: LocalFile) => void
  handleOpenECOModal: (file: LocalFile) => void

  // Watch and share
  watchingFiles: Set<string>
  isTogglingWatch: boolean
  handleToggleWatch: (file: LocalFile) => void
  isCreatingShareLink: boolean
  handleQuickShareLink: (file: LocalFile) => void

  // Delete operations
  setCustomConfirm: (
    state: {
      title: string
      message: string
      warning?: string
      confirmText: string
      confirmDanger?: boolean
      onConfirm: () => void
    } | null,
  ) => void
  setDeleteLocalCheckoutConfirm: (
    state: {
      checkedOutFiles: LocalFile[]
      allFilesToProcess: LocalFile[]
      contextFiles: LocalFile[]
    } | null,
  ) => void

  // Undo
  undoStack: Array<{ type: 'delete'; file: LocalFile; originalPath: string }>
  handleUndo: () => void

  // Submenu state
  showIgnoreSubmenu: boolean
  setShowIgnoreSubmenu: (value: boolean) => void
  showStateSubmenu: boolean
  setShowStateSubmenu: (value: boolean) => void
  ignoreSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  stateSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>

  // Files currently saving metadata
  savingConfigsToSW?: ReadonlySet<string>
}

export function FileContextMenu({
  // Core menu data
  contextMenu,
  contextMenuAdjustedPos,
  onClose,
  contextMenuRef,
  getContextMenuFiles,
  platform,
  // Handlers
  onRefresh,
  navigateToFolder,
  startRenaming,
  isSearching,
  onGoToFolder,
  handleCopy,
  handleCut,
  handlePaste,
  handleCheckoutFolder,
  handleCheckinFolder,
  handleBulkStateChange,
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
  setCustomConfirm,
  setDeleteLocalCheckoutConfirm,
  undoStack,
  handleUndo,
  setShowIgnoreSubmenu,
  setShowStateSubmenu,
  ignoreSubmenuTimeoutRef,
  stateSubmenuTimeoutRef,
  savingConfigsToSW,
}: FileContextMenuProps) {
  const user = usePDMStore((s) => s.user)

  // Get context files
  const contextFiles = getContextMenuFiles()
  const multiSelect = contextFiles.length > 1
  const firstFile = contextFiles[0]
  // Use the selection state hook to compute counts and state
  const { counts, state, syncedFilesInSelection, unsyncedFilesInSelection } =
    useContextMenuSelectionState({
      contextFiles,
      userId: user?.id,
    })

  // Close menu and clear submenus
  const handleCloseMenu = () => {
    onClose()
    setShowIgnoreSubmenu(false)
    setShowStateSubmenu(false)
    if (ignoreSubmenuTimeoutRef.current) {
      clearTimeout(ignoreSubmenuTimeoutRef.current)
    }
    if (stateSubmenuTimeoutRef.current) {
      clearTimeout(stateSubmenuTimeoutRef.current)
    }
  }

  const base = { contextFiles, multiSelect, firstFile, onClose }
  const open = useOpenEntries({ ...base, navigateToFolder, isSearching, onGoToFolder })
  const assembly = useAssemblyEntries(base)
  const duplicate = useDuplicateEntries(base)
  const bulkAssembly = useBulkAssemblyEntries(base)
  const sync = useSyncEntries({ ...base, onRefresh, counts, state, unsyncedFilesInSelection })
  const checkout = useCheckoutEntries({
    ...base,
    onRefresh,
    counts,
    state,
    syncedFilesInSelection,
    handleCheckoutFolder,
    handleCheckinFolder,
    handleBulkStateChange,
    stateSubmenuTimeoutRef,
    savingConfigsToSW,
  })
  const generate = useGenerateEntries(base)
  const reviews = useReviewsEntries(base)
  const orders = useOrdersEntries(base)
  const fileSystem = useFileSystemEntries({ ...base, platform, startRenaming, userId: user?.id })
  const folderVisibility = useFolderVisibilityEntries(base)
  const clipboard = useClipboardEntries({ ...base, handleCopy, handleCut, handlePaste })
  const vaultTransfer = useVaultTransferEntries(contextFiles, handleCloseMenu)
  const deletion = useDeleteEntries({
    ...base,
    onRefresh,
    counts,
    state,
    setCustomConfirm,
    setDeleteLocalCheckoutConfirm,
    undoStack,
    handleUndo,
  })
  const collaboration = useCollaborationEntries({
    ...base,
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
  })

  const hooks = [
    open,
    assembly,
    duplicate,
    bulkAssembly,
    sync,
    checkout,
    generate,
    reviews,
    orders,
    fileSystem,
    folderVisibility,
    clipboard,
    vaultTransfer,
    deletion,
    collaboration,
  ]

  // Every id the file list offers (`LIST_MENU_ENTRY_IDS`): the compiler holds the hooks to it.
  const entries: Record<ListMenuEntryId, React.ReactNode | null> = {
    ...open.entries,
    ...assembly.entries,
    ...duplicate.entries,
    ...bulkAssembly.entries,
    ...sync.entries,
    ...checkout.entries,
    ...generate.entries,
    ...reviews.entries,
    ...orders.entries,
    ...fileSystem.entries,
    ...folderVisibility.entries,
    ...clipboard.entries,
    ...vaultTransfer.entries,
    ...deletion.entries,
    ...collaboration.entries,
  }

  return (
    <>
      {/* Overlay to close menu on click */}
      <NativePreviewContextMenuBackdrop onClose={handleCloseMenu} />

      {/* Context menu */}
      <div
        ref={contextMenuRef}
        className="context-menu z-[60]"
        style={{
          left: contextMenuAdjustedPos?.x ?? contextMenu.x,
          top: contextMenuAdjustedPos?.y ?? contextMenu.y,
        }}
      >
        {/* Keyed by the click, so each opening starts with "More actions" and every flyout closed */}
        <CustomizableMenu
          key={`${contextMenu.x},${contextMenu.y},${contextMenu.file.path}`}
          entries={entries}
          onClose={handleCloseMenu}
        />
      </div>

      {/* Dialogs the entries open, beside the menu */}
      {hooks.map((hook, index) => (
        <React.Fragment key={index}>{hook.overlays}</React.Fragment>
      ))}
    </>
  )
}
