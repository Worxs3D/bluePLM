/**
 * The file and folder right-click menu, laid out by the person's layout.
 *
 * The menu's own code decides which entries apply to the selection (each entry hook returns an
 * element, or `null`); the layout (`useContextMenuLayout`: the person's own, their organization's
 * template, or the app default) decides their order, grouping and visibility. `resolveLayout`
 * drops what does not apply and every group or separator left empty by that, and this draws the
 * rest: entries, separators, flyout groups (`ContextMenuGroup`), inline groups (a small heading
 * when a person named the group) and the collapsed "More actions" group. The last row, outside
 * every layout, opens the settings page where the menu is customised. Entries of an official
 * extension the organization uninstalled are left out here, for every menu (schema 516).
 */
import { Fragment, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { groupIcon, type ContextMenuEntryId } from '@/lib/contextMenu/entries'
import {
  resolveLayout,
  resolvedEntryIds,
  type ResolvedGroup,
  type ResolvedNode,
} from '@/lib/contextMenu/resolve'
import type { MenuLayout } from '@/lib/contextMenu/types'
import { useContextMenuLayout } from '@/lib/contextMenu/useContextMenuLayout'
import { t } from '@/lib/i18n'
import {
  extensionOfMenuEntry,
  parseExtensionIds,
  uninstalledOfficialExtensions,
} from '@/lib/officialExtensions'
import { usePDMStore } from '@/stores/pdmStore'

import { ContextMenuGroup, ExpandableSection } from '../components'
import { FlyoutProvider } from './flyout'
import type { EntryElements } from './types'

export interface CustomizableMenuProps {
  /** What each entry draws for this selection (`null` = does not apply). */
  entries: EntryElements
  /** A layout to draw instead of the person's own (the settings preview, the render harness). */
  layout?: MenuLayout
  /** Which entries apply; defaults to `entries[id] != null`. */
  isAvailable?: (id: ContextMenuEntryId) => boolean
  /** Closes the menu; the "Customize this menu…" row calls it after opening settings. */
  onClose?: () => void
  /** Leave out the "Customize this menu…" row (the settings preview). */
  hideCustomize?: boolean
}

/** Flyout widths of the built-in groups that had their own before the layout existed. */
const GROUP_MIN_WIDTH: Partial<Record<string, number>> = {
  generateServer: 200,
  generateLocal: 200,
}

export function groupLabel(group: Pick<ResolvedGroup, 'builtin' | 'label'>): string {
  if (group.label) return group.label
  if (group.builtin) return t(`contextMenuCustomizer.group.${group.builtin}`)
  // Same as the settings editor (`groupName`), so an unnamed group reads the same in both.
  return t('contextMenuCustomizer.editor.unnamedGroup')
}

export function CustomizableMenu({
  entries,
  layout,
  isAvailable,
  onClose,
  hideCustomize,
}: CustomizableMenuProps) {
  const personLayout = useContextMenuLayout()
  const openSettings = usePDMStore((s) => s.openSettings)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // An entry an uninstalled official extension adds never shows (Settings > Extensions), whatever
  // its hook returned. Its overlays stay mounted by the hook, as for any hidden entry.
  const uninstalled = parseExtensionIds(
    usePDMStore((s) => uninstalledOfficialExtensions(s.organization).join(',')),
  )
  const applies = isAvailable ?? ((id: ContextMenuEntryId) => entries[id] != null)
  const available = (id: ContextMenuEntryId) => {
    const extension = uninstalled.length > 0 ? extensionOfMenuEntry(id) : null
    return (!extension || !uninstalled.includes(extension)) && applies(id)
  }
  const nodes = resolveLayout(layout ?? personLayout, available)

  const renderNodes = (list: readonly ResolvedNode[], topLevel: boolean): ReactNode[] =>
    list.map((node, index) => {
      if (node.kind === 'separator') {
        return <div key={`sep-${index}`} className="context-menu-separator" />
      }
      if (node.kind === 'entry') {
        return <Fragment key={node.id}>{entries[node.id] ?? null}</Fragment>
      }
      const children = renderNodes(node.children, false)
      if (node.display === 'submenu') {
        return (
          <ContextMenuGroup
            key={`group-${node.id}`}
            flyoutKey={`group:${node.id}`}
            label={groupLabel(node)}
            icon={groupIcon(node)}
            minWidth={GROUP_MIN_WIDTH[node.builtin ?? ''] ?? 180}
          >
            {children}
          </ContextMenuGroup>
        )
      }
      if (node.display === 'collapsed' && topLevel) {
        const open = expanded[node.id] === true
        return (
          <ExpandableSection
            key={`group-${node.id}`}
            separator={false}
            expanded={open}
            onToggle={() => setExpanded((s) => ({ ...s, [node.id]: !open }))}
            hiddenCount={node.count}
          >
            {children}
          </ExpandableSection>
        )
      }
      // Inline: the children in place. Only a group a person named gets a heading; the app's
      // own groups read as plain sections, as they did before layouts.
      return (
        <Fragment key={`group-${node.id}`}>
          {!node.builtin && node.label && (
            <div
              className="px-3 py-1 text-[11px] uppercase tracking-wide text-plm-fg-muted"
              data-menu-heading=""
            >
              {node.label}
            </div>
          )}
          {children}
        </Fragment>
      )
    })

  return (
    <FlyoutProvider>
      {renderNodes(nodes, true)}
      {!hideCustomize && (
        <>
          {nodes.length > 0 && <div className="context-menu-separator" data-menu-customize="" />}
          <div
            className="context-menu-item text-plm-fg-muted"
            data-menu-customize=""
            // The entries this menu resolved to, in order: what tests and the render harness read.
            data-entries={resolvedEntryIds(nodes).join(' ')}
            onClick={(e) => {
              e.stopPropagation()
              openSettings('context-menu')
              onClose?.()
            }}
          >
            <SlidersHorizontal size={14} />
            {t('contextMenuCustomizer.menu.customize')}
          </div>
        </>
      )}
    </FlyoutProvider>
  )
}
