/**
 * The right-click menu layout for the signed-in person: the store's organization settings and
 * their prefs for that organization, through `effectiveLayout`. Memoised on exactly those two, so
 * the menu re-resolves only when the organization's menu settings or the person's prefs change.
 */

import { useMemo } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

import { effectiveLayout, orgKey, type EffectiveLayout } from './effective'
import type { MenuLayout } from './types'

/** The whole result (source, template, force, change since customised), for the settings page. */
export function useEffectiveContextMenu(): EffectiveLayout {
  const contextMenu = usePDMStore((s) => s.organization?.settings?.context_menu)
  const orgId = usePDMStore((s) => s.organization?.id)
  const prefs = usePDMStore((s) => s.contextMenuPrefs[orgKey(orgId)])
  return useMemo(() => effectiveLayout({ settings: { context_menu: contextMenu } }, prefs), [contextMenu, prefs])
}

/** The completed layout the menus resolve. */
export function useContextMenuLayout(): MenuLayout {
  return useEffectiveContextMenu().layout
}
