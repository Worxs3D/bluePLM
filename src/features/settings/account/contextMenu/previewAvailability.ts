/**
 * Which menu entries the settings preview shows for a kind of selection in a given state. A guide
 * built from the registry's `appliesTo` and the rules below; the real menu decides per file.
 */

import { CONTEXT_MENU_ENTRIES, type ContextMenuEntryId, type MenuFileKind } from '@/lib/contextMenu/entries'

/** What was right-clicked. */
export type PreviewKind = Exclude<MenuFileKind, 'file'>

export const PREVIEW_KINDS: readonly PreviewKind[] = ['part', 'assembly', 'drawing', 'folder', 'multi']

/** The state of what was right-clicked, as the vault sees it. */
export type PreviewState = 'checkedIn' | 'mine' | 'others' | 'cloud' | 'local' | 'outdated'

export const PREVIEW_STATES: readonly PreviewState[] = ['checkedIn', 'mine', 'others', 'cloud', 'local', 'outdated']

/** Entries that show only in these states. */
const ONLY_IN: Partial<Record<ContextMenuEntryId, readonly PreviewState[]>> = {
  'sync.download': ['cloud'],
  'sync.getLatest': ['outdated'],
  'sync.firstCheckIn': ['local'],
  'sync.keepLocalOnly': ['local'],
  'checkout.checkOut': ['checkedIn'],
  'checkout.checkIn': ['mine'],
  'checkout.discard': ['mine'],
  'checkout.syncMetadata': ['mine'],
  'checkout.forceRelease': ['others'],
  'collab.requestCheckout': ['others'],
  'delete.deleteLocal': ['local'],
}

/** What a file only on the server offers: nothing that needs a copy on this computer. */
const ON_SERVER_ONLY: ReadonlySet<ContextMenuEntryId> = new Set<ContextMenuEntryId>([
  'open.goToFolder',
  'sync.download',
  'checkout.changeState',
  'generate.server.pdf',
  'generate.server.step',
  'generate.server.inspectionReport',
  'reviews',
  'fileActions.copyName',
  'delete.everywhere',
  'collab.whereUsed',
  'collab.properties',
  'collab.notify',
  'collab.watch',
  'collab.shareLink',
  'collab.addToEco',
])

/** Entries that need the file in the vault, so a file not checked in yet never has them. */
const NEEDS_VAULT: ReadonlySet<ContextMenuEntryId> = new Set<ContextMenuEntryId>([
  'assembly.bulk',
  'assembly.downloadReferenced',
  'checkout.changeState',
  'generate.server.pdf',
  'generate.server.step',
  'generate.server.inspectionReport',
  'reviews',
  'vaultTransfer.copyTo',
  'vaultTransfer.moveTo',
  'delete.removeLocal',
  'delete.serverKeepLocal',
  'delete.everywhere',
  'collab.whereUsed',
  'collab.notify',
  'collab.watch',
  'collab.shareLink',
  'collab.addToEco',
])

export function previewAvailable(
  id: ContextMenuEntryId,
  kind: PreviewKind,
  state: PreviewState,
  opts: { isAdmin: boolean; desktop: boolean },
): boolean {
  const def = CONTEXT_MENU_ENTRIES.find((entry) => entry.id === id)
  if (!def) return false
  if (!(def.surfaces as readonly string[]).includes('list')) return false
  if ('adminOnly' in def && def.adminOnly && !opts.isAdmin) return false
  if ('desktopOnly' in def && def.desktopOnly && !opts.desktop) return false
  if (!(def.appliesTo as readonly MenuFileKind[]).includes(kind)) return false
  const only = ONLY_IN[id]
  if (only && !only.includes(state)) return false
  if (state === 'cloud') return ON_SERVER_ONLY.has(id)
  if (state === 'local') return !NEEDS_VAULT.has(id)
  return true
}
