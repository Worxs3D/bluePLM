// src/features/source/context-menu/index.ts

// Main component - standalone FileContextMenu with simple interface
export { FileContextMenu } from './FileContextMenu'

// Types
export * from './types'

// Entry hooks and the ids they produce
export {
  useTreeClipboardEntries,
  useTreeFileOperationEntries,
  useTreePDMEntries,
  useTreeCollaborationEntries,
  useTreeNavigationEntries,
  useTreeAdminEntries,
  useTreeDeleteEntries,
  useTreeMovedFileEntries,
} from './items'
export { TREE_MENU_ENTRY_IDS, type TreeMenuEntryId } from './treeEntries'

// Dialogs
export {
  DeleteConfirmDialog,
  DeleteLocalConfirmDialog,
  ForceCheckinDialog,
  PropertiesDialog,
  CheckoutRequestDialog,
  MentionDialog,
  ShareLinkDialog,
  AddToECODialog,
} from './dialogs'

// Hooks
export { useMenuPosition, useContextMenuState } from './hooks'

// Utils - re-export from central location
export { formatFileSize as formatSize, getCountLabel, plural } from '@/lib/utils'

// Constants
export {
  SW_EXTENSIONS,
  MENU_PADDING,
  SUBMENU_WIDTH,
  DEFAULT_SHARE_EXPIRY_DAYS,
  MAX_VISIBLE_FILES,
} from './constants'
