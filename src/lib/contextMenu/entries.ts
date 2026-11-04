/**
 * Every entry of the file and folder right-click menu, by stable id, and the app's default layout.
 *
 * An id names one logical action. Variants of the same action share it (Open / Open all / Open
 * folder; Check out a folder / files; the two Change state submenus). A submenu whose rows are
 * loaded when it opens (Reviews, Change state, Insert into assembly, the assembly submenu, the
 * export format flyouts) is one entry: its rows cannot be placed on their own.
 *
 * Ids are stored in users' and organizations' layouts: never rename or reuse one. Retire an id by
 * deleting it here; `sanitizeLayout` drops ids it no longer knows.
 *
 * Both menus (file list: `browser/components/ContextMenu`, explorer tree: `context-menu`) render
 * from the same layout. `surfaces` says which menu has an entry; the other skips it like an entry
 * that does not apply. Labels and hints for the settings page are
 * `contextMenuCustomizer.entry.<id>` and `contextMenuCustomizer.hint.<id>` (every locale).
 */

import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUp,
  Box,
  Boxes,
  Clipboard,
  ClipboardCheck,
  ClipboardList,
  ClipboardPaste,
  Cloud,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileOutput,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HardDrive,
  Info,
  Layers,
  Link,
  Lock,
  MoreHorizontal,
  Move,
  Network,
  Package,
  Package2,
  Pencil,
  RefreshCw,
  ScanSearch,
  Scissors,
  Settings,
  Share2,
  Sparkles,
  Star,
  Table,
  Trash2,
  Undo2,
  Unlock,
  UserX,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { LayoutNode, MenuLayout } from './types'

/** Rough file kinds, used only by the settings preview to say which entries can appear. */
export type MenuFileKind = 'part' | 'assembly' | 'drawing' | 'file' | 'folder' | 'multi'
export type MenuSurface = 'list' | 'tree'

export type MenuEntryCategory =
  | 'open'
  | 'solidworks'
  | 'sync'
  | 'checkout'
  | 'generate'
  | 'reviews'
  | 'file'
  | 'edit'
  | 'transfer'
  | 'delete'
  | 'collaborate'
  | 'navigate'

export interface ContextMenuEntryDef {
  id: string
  category: MenuEntryCategory
  icon: LucideIcon
  /** Which kinds of selection the entry can show for (preview only; the menu checks the real file). */
  appliesTo: readonly MenuFileKind[]
  /** Which menus render it. */
  surfaces: readonly MenuSurface[]
  /** Needs the desktop app (hidden on BluePLM Web). */
  desktopOnly?: boolean
  /** Shown only to admins. */
  adminOnly?: boolean
  /** Destructive. */
  danger?: boolean
  /** Opens a flyout of its own. */
  submenu?: boolean
}

const SW: readonly MenuFileKind[] = ['part', 'assembly', 'drawing']
const MODELS: readonly MenuFileKind[] = ['part', 'assembly']
const FILES: readonly MenuFileKind[] = ['part', 'assembly', 'drawing', 'file']
const ANY: readonly MenuFileKind[] = ['part', 'assembly', 'drawing', 'file', 'folder', 'multi']
const BOTH: readonly MenuSurface[] = ['list', 'tree']
const LIST: readonly MenuSurface[] = ['list']
const TREE: readonly MenuSurface[] = ['tree']

export const CONTEXT_MENU_ENTRIES = [
  // Open
  { id: 'open.open', category: 'open', icon: ExternalLink, appliesTo: ANY, surfaces: BOTH },
  { id: 'open.goToFolder', category: 'open', icon: FolderSearch, appliesTo: FILES, surfaces: LIST },

  // SOLIDWORKS
  { id: 'assembly.insert', category: 'solidworks', icon: Boxes, appliesTo: MODELS, surfaces: LIST, desktopOnly: true, submenu: true },
  { id: 'duplicate.partAndDrawing', category: 'solidworks', icon: Copy, appliesTo: ['part'], surfaces: LIST, desktopOnly: true },
  { id: 'assembly.bulk', category: 'solidworks', icon: Package2, appliesTo: ['assembly'], surfaces: LIST, desktopOnly: true, submenu: true },
  { id: 'assembly.downloadReferenced', category: 'solidworks', icon: Package2, appliesTo: ['assembly'], surfaces: TREE, desktopOnly: true },

  // Sync
  { id: 'sync.download', category: 'sync', icon: ArrowDown, appliesTo: ANY, surfaces: BOTH },
  { id: 'sync.getLatest', category: 'sync', icon: RefreshCw, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'sync.keepLocalOnly', category: 'sync', icon: EyeOff, appliesTo: ANY, surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'sync.firstCheckIn', category: 'sync', icon: ArrowUp, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },

  // Check out and state
  { id: 'checkout.checkOut', category: 'checkout', icon: Lock, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'checkout.checkIn', category: 'checkout', icon: ArrowUp, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'checkout.discard', category: 'checkout', icon: Undo2, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'checkout.matchGhost', category: 'checkout', icon: FileSearch, appliesTo: FILES, surfaces: TREE, desktopOnly: true },
  { id: 'checkout.forceRelease', category: 'checkout', icon: Unlock, appliesTo: ANY, surfaces: BOTH, adminOnly: true },
  { id: 'checkout.changeState', category: 'checkout', icon: RefreshCw, appliesTo: ANY, surfaces: LIST, submenu: true },
  { id: 'checkout.syncMetadata', category: 'checkout', icon: RefreshCw, appliesTo: SW, surfaces: BOTH, desktopOnly: true },

  // Generate: on server
  { id: 'generate.server.pdf', category: 'generate', icon: FileText, appliesTo: ['drawing', 'multi'], surfaces: BOTH, desktopOnly: true },
  { id: 'generate.server.step', category: 'generate', icon: Box, appliesTo: [...SW, 'multi'], surfaces: BOTH, desktopOnly: true },
  { id: 'generate.server.inspectionReport', category: 'generate', icon: FileSpreadsheet, appliesTo: ['drawing'], surfaces: BOTH, desktopOnly: true, submenu: true },
  // Generate: local files
  { id: 'generate.local.step', category: 'generate', icon: Package, appliesTo: [...MODELS, 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.iges', category: 'generate', icon: Package, appliesTo: [...MODELS, 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.stl', category: 'generate', icon: Package, appliesTo: [...MODELS, 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.pdf', category: 'generate', icon: FileOutput, appliesTo: ['drawing', 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.dxf', category: 'generate', icon: Download, appliesTo: ['drawing', 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.stepFromDrawing', category: 'generate', icon: Package, appliesTo: ['drawing', 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.exportOptions', category: 'generate', icon: Settings, appliesTo: [...SW, 'multi'], surfaces: BOTH, desktopOnly: true },
  { id: 'generate.local.table', category: 'generate', icon: Table, appliesTo: ['file', 'multi'], surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'generate.local.inspectionReport', category: 'generate', icon: FileSpreadsheet, appliesTo: ['drawing'], surfaces: BOTH, submenu: true },

  // Reviews
  { id: 'reviews', category: 'reviews', icon: ClipboardCheck, appliesTo: ANY, surfaces: BOTH, submenu: true },

  // File
  { id: 'fileActions.showInExplorer', category: 'file', icon: FolderOpen, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'fileActions.copyName', category: 'file', icon: Copy, appliesTo: ANY, surfaces: LIST },
  { id: 'fileActions.copyPath', category: 'file', icon: Copy, appliesTo: ANY, surfaces: LIST, desktopOnly: true },
  { id: 'fileActions.copyFolderPath', category: 'file', icon: Copy, appliesTo: FILES, surfaces: LIST, desktopOnly: true },
  { id: 'fileActions.pin', category: 'file', icon: Star, appliesTo: ['part', 'assembly', 'drawing', 'file', 'folder'], surfaces: BOTH, desktopOnly: true },
  { id: 'fileActions.rename', category: 'file', icon: Pencil, appliesTo: ['part', 'assembly', 'drawing', 'file', 'folder'], surfaces: BOTH, desktopOnly: true },
  { id: 'fileActions.newFolder', category: 'file', icon: FolderPlus, appliesTo: ['folder'], surfaces: TREE, desktopOnly: true },
  { id: 'fileActions.folderVisibility', category: 'file', icon: Eye, appliesTo: ['folder'], surfaces: BOTH, adminOnly: true },
  { id: 'fileActions.auditFolderMetadata', category: 'file', icon: ScanSearch, appliesTo: ['folder'], surfaces: BOTH, adminOnly: true, desktopOnly: true },

  // Edit
  { id: 'edit.copy', category: 'edit', icon: Copy, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'edit.cut', category: 'edit', icon: Scissors, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },
  { id: 'edit.paste', category: 'edit', icon: ClipboardPaste, appliesTo: ANY, surfaces: BOTH, desktopOnly: true },

  // Other vaults, moves
  { id: 'vaultTransfer.copyTo', category: 'transfer', icon: Copy, appliesTo: ANY, surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'vaultTransfer.moveTo', category: 'transfer', icon: ArrowRightLeft, appliesTo: ANY, surfaces: BOTH, desktopOnly: true, submenu: true },
  { id: 'moves.resolve', category: 'transfer', icon: Move, appliesTo: FILES, surfaces: TREE, desktopOnly: true },

  // Delete
  { id: 'delete.removeLocal', category: 'delete', icon: Trash2, appliesTo: ANY, surfaces: BOTH },
  { id: 'delete.deleteLocal', category: 'delete', icon: Trash2, appliesTo: ANY, surfaces: BOTH, danger: true },
  { id: 'delete.serverKeepLocal', category: 'delete', icon: CloudOff, appliesTo: ANY, surfaces: BOTH },
  { id: 'delete.everywhere', category: 'delete', icon: Trash2, appliesTo: ANY, surfaces: BOTH, danger: true },
  { id: 'delete.discardOrphaned', category: 'delete', icon: UserX, appliesTo: ANY, surfaces: TREE, desktopOnly: true },
  { id: 'delete.undo', category: 'delete', icon: Undo2, appliesTo: ANY, surfaces: LIST },

  // Collaborate
  { id: 'collab.whereUsed', category: 'collaborate', icon: Link, appliesTo: FILES, surfaces: LIST },
  { id: 'collab.properties', category: 'collaborate', icon: Info, appliesTo: ANY, surfaces: BOTH },
  { id: 'collab.extractReferences', category: 'collaborate', icon: Network, appliesTo: ['assembly', 'folder', 'multi'], surfaces: BOTH, desktopOnly: true },
  { id: 'collab.requestCheckout', category: 'collaborate', icon: ArrowDown, appliesTo: FILES, surfaces: BOTH },
  { id: 'collab.notify', category: 'collaborate', icon: Users, appliesTo: FILES, surfaces: BOTH },
  { id: 'collab.watch', category: 'collaborate', icon: Eye, appliesTo: FILES, surfaces: BOTH },
  { id: 'collab.shareLink', category: 'collaborate', icon: Link, appliesTo: ['part', 'assembly', 'drawing', 'file', 'folder'], surfaces: BOTH },
  { id: 'collab.addToEco', category: 'collaborate', icon: ClipboardList, appliesTo: FILES, surfaces: BOTH },

  // Navigate (explorer tree)
  { id: 'nav.showDeleted', category: 'navigate', icon: Trash2, appliesTo: ['folder'], surfaces: TREE },
  { id: 'nav.refreshVault', category: 'navigate', icon: RefreshCw, appliesTo: ANY, surfaces: TREE },
] as const satisfies readonly ContextMenuEntryDef[]

export type ContextMenuEntryId = (typeof CONTEXT_MENU_ENTRIES)[number]['id']

const ENTRY_BY_ID: ReadonlyMap<string, ContextMenuEntryDef> = new Map(
  CONTEXT_MENU_ENTRIES.map((e) => [e.id, e as ContextMenuEntryDef]),
)

export function isContextMenuEntryId(id: unknown): id is ContextMenuEntryId {
  return typeof id === 'string' && ENTRY_BY_ID.has(id)
}

export function getContextMenuEntry(id: ContextMenuEntryId): ContextMenuEntryDef {
  // Every ContextMenuEntryId is in the map by construction.
  return ENTRY_BY_ID.get(id) as ContextMenuEntryDef
}

/** The app's own groups. Labels: `contextMenuCustomizer.group.<id>`. */
export const CONTEXT_MENU_GROUPS = {
  solidworks: { icon: Boxes },
  generate: { icon: Sparkles },
  generateServer: { icon: Cloud },
  generateLocal: { icon: HardDrive },
  fileActions: { icon: FolderOpen },
  edit: { icon: Clipboard },
  more: { icon: MoreHorizontal },
} as const satisfies Record<string, { icon: LucideIcon }>

export type ContextMenuGroupId = keyof typeof CONTEXT_MENU_GROUPS

export function isContextMenuGroupId(id: unknown): id is ContextMenuGroupId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CONTEXT_MENU_GROUPS, id)
}

/** Icons a person can give a group they make. The key is what a layout stores. */
export const GROUP_ICONS = {
  folder: Folder,
  star: Star,
  zap: Zap,
  wrench: Wrench,
  share: Share2,
  package: Package,
  export: FileOutput,
  sparkles: Sparkles,
  clipboard: Clipboard,
  layers: Layers,
  archive: Archive,
  download: ArrowDownToLine,
  more: MoreHorizontal,
} as const satisfies Record<string, LucideIcon>

export type GroupIconName = keyof typeof GROUP_ICONS

/** The icon a group shows: its own when known, else its built-in one, else a folder. */
export function groupIcon(group: { icon?: string; builtin?: ContextMenuGroupId }): LucideIcon {
  if (group.icon && Object.prototype.hasOwnProperty.call(GROUP_ICONS, group.icon)) {
    return GROUP_ICONS[group.icon as GroupIconName]
  }
  if (group.builtin) return CONTEXT_MENU_GROUPS[group.builtin].icon
  return Folder
}

const e = (id: ContextMenuEntryId): LayoutNode => ({ kind: 'entry', id })
const sep: LayoutNode = { kind: 'separator' }

/**
 * Today's menu, as one layout for both surfaces: the file list's order, with the explorer tree's
 * own entries next to their closest relatives. Do not reorder to taste: a person who never
 * customised sees this, and the parity test pins it.
 */
export const DEFAULT_LAYOUT: MenuLayout = {
  v: 1,
  hidden: [],
  removedGroups: [],
  nodes: [
    e('open.open'),
    e('open.goToFolder'),
    // An inline group, so its separators show only when one of its entries applies: a drawing or a
    // folder reads "Open, Check out" without a stray separator.
    {
      kind: 'group',
      id: 'solidworks',
      builtin: 'solidworks',
      display: 'inline',
      children: [
        e('assembly.insert'),
        e('duplicate.partAndDrawing'),
        sep,
        e('assembly.bulk'),
        e('assembly.downloadReferenced'),
      ],
    },
    // No separator here: today's menu draws one only when Download or Get Latest shows, and a
    // layout has no conditional separators. A synced file reads "Open, Check out" as before.
    e('sync.download'),
    e('sync.getLatest'),
    e('sync.keepLocalOnly'),
    e('sync.firstCheckIn'),
    e('checkout.checkOut'),
    e('checkout.checkIn'),
    e('checkout.discard'),
    e('checkout.matchGhost'),
    e('checkout.forceRelease'),
    e('checkout.changeState'),
    e('checkout.syncMetadata'),
    {
      kind: 'group',
      id: 'generate',
      builtin: 'generate',
      display: 'submenu',
      children: [
        {
          kind: 'group',
          id: 'generateServer',
          builtin: 'generateServer',
          display: 'submenu',
          children: [
            e('generate.server.pdf'),
            e('generate.server.step'),
            e('generate.server.inspectionReport'),
          ],
        },
        {
          kind: 'group',
          id: 'generateLocal',
          builtin: 'generateLocal',
          display: 'submenu',
          children: [
            e('generate.local.table'),
            e('generate.local.step'),
            e('generate.local.iges'),
            e('generate.local.stl'),
            e('generate.local.pdf'),
            e('generate.local.dxf'),
            e('generate.local.stepFromDrawing'),
            e('generate.local.exportOptions'),
            e('generate.local.inspectionReport'),
          ],
        },
      ],
    },
    e('reviews'),
    sep,
    {
      kind: 'group',
      id: 'fileActions',
      builtin: 'fileActions',
      display: 'submenu',
      children: [
        e('fileActions.showInExplorer'),
        e('fileActions.copyName'),
        e('fileActions.copyPath'),
        e('fileActions.copyFolderPath'),
        sep,
        e('fileActions.pin'),
        e('fileActions.rename'),
        e('fileActions.newFolder'),
        e('fileActions.folderVisibility'),
        e('fileActions.auditFolderMetadata'),
      ],
    },
    {
      kind: 'group',
      id: 'edit',
      builtin: 'edit',
      display: 'submenu',
      children: [e('edit.copy'), e('edit.cut'), e('edit.paste')],
    },
    e('vaultTransfer.copyTo'),
    e('vaultTransfer.moveTo'),
    e('moves.resolve'),
    sep,
    e('delete.removeLocal'),
    e('delete.deleteLocal'),
    e('delete.serverKeepLocal'),
    e('delete.everywhere'),
    e('delete.discardOrphaned'),
    sep,
    e('delete.undo'),
    {
      kind: 'group',
      id: 'more',
      builtin: 'more',
      display: 'auto',
      children: [
        e('collab.whereUsed'),
        e('collab.properties'),
        e('collab.extractReferences'),
        e('collab.requestCheckout'),
        e('collab.notify'),
        e('collab.watch'),
        e('collab.shareLink'),
        e('collab.addToEco'),
        e('nav.showDeleted'),
        e('nav.refreshVault'),
      ],
    },
  ],
}
