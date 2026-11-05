/**
 * Names, hints and visibility of menu entries and groups on the settings pages. Labels use the
 * menu's own wording (`contextMenuCustomizer.entry.*`), so a person finds on the page what they see
 * when they right-click.
 */

import {
  CONTEXT_MENU_ENTRIES,
  getContextMenuEntry,
  type ContextMenuEntryDef,
  type ContextMenuEntryId,
  type ContextMenuGroupId,
} from '@/lib/contextMenu/entries'
import { ancestorGroups, findEntryPath } from '@/lib/contextMenu/edit'
import type { MenuLayout } from '@/lib/contextMenu/types'

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function entryLabel(t: Translate, id: ContextMenuEntryId): string {
  return t(`contextMenuCustomizer.entry.${id}`)
}

export function entryHint(t: Translate, id: ContextMenuEntryId): string {
  return t(`contextMenuCustomizer.hint.${id}`)
}

export function groupName(t: Translate, group: { builtin?: ContextMenuGroupId; label?: string }): string {
  if (group.label) return group.label
  if (group.builtin) return t(`contextMenuCustomizer.group.${group.builtin}`)
  return t('contextMenuCustomizer.editor.unnamedGroup')
}

/** Admin-only entries are not listed for anyone else (they never see them in the menu). */
export function isListedFor(def: Pick<ContextMenuEntryDef, 'adminOnly'>, isAdmin: boolean): boolean {
  return isAdmin || !def.adminOnly
}

/** The registry entries a person can arrange. */
export function listedEntries(isAdmin: boolean): readonly ContextMenuEntryDef[] {
  return (CONTEXT_MENU_ENTRIES as readonly ContextMenuEntryDef[]).filter((def) => isListedFor(def, isAdmin))
}

/** "Generate › Local" for an entry inside groups; "" at the top level or when hidden. */
export function entryLocation(t: Translate, layout: MenuLayout, id: ContextMenuEntryId): string {
  const path = findEntryPath(layout, id)
  if (!path) return ''
  return ancestorGroups(layout, path)
    .map((group) => groupName(t, group))
    .join(' › ')
}

/** Lower-cased words a search matches an entry by: its name, hint and id. */
export function entrySearchText(t: Translate, id: ContextMenuEntryId): string {
  return `${entryLabel(t, id)} ${entryHint(t, id)} ${id}`.toLowerCase()
}

export function matchesQuery(text: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return words.every((word) => text.includes(word))
}

export { getContextMenuEntry }
