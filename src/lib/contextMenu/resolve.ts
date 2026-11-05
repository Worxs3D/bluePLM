/**
 * A layout as the menu draws it for one selection: what does not apply is gone, and so is every
 * group or separator left empty by that.
 *
 * - Hidden entries and entries `isAvailable` refuses are dropped; a group with no entry left is
 *   dropped.
 * - Separators are never first, last or doubled within a container (the top level, or one
 *   group's children). An inline or collapsed group is set apart by separators on both sides; the
 *   resolved separators are the only ones, so a renderer adds none of its own.
 * - `auto` is decided once for the top level: `collapsed` when the menu would show more than
 *   `AUTO_COLLAPSE_ROWS` rows with every auto group open (top-level entries and group rows, plus
 *   the rows of inline and auto groups), else `inline`. Below the top level `auto` and
 *   `collapsed` read as `inline` (sanitize already makes them so).
 * - `count` is the number of entries inside a group, at any depth.
 */

import type { ContextMenuEntryId, ContextMenuGroupId } from './entries'
import { AUTO_COLLAPSE_ROWS, type GroupDisplay, type LayoutNode, type MenuLayout } from './types'

export interface ResolvedEntry {
  kind: 'entry'
  id: ContextMenuEntryId
}

export interface ResolvedSeparator {
  kind: 'separator'
}

export interface ResolvedGroup {
  kind: 'group'
  id: string
  builtin?: ContextMenuGroupId
  label?: string
  icon?: string
  display: 'submenu' | 'inline' | 'collapsed'
  children: ResolvedNode[]
  count: number
}

export type ResolvedNode = ResolvedEntry | ResolvedSeparator | ResolvedGroup

/** A group before `auto` is decided. */
interface PendingGroup extends Omit<ResolvedGroup, 'display' | 'children'> {
  display: GroupDisplay
  children: PendingNode[]
}

type PendingNode = ResolvedEntry | ResolvedSeparator | PendingGroup

function prune(
  nodes: readonly LayoutNode[],
  depth: number,
  hidden: ReadonlySet<string>,
  isAvailable: (id: ContextMenuEntryId) => boolean,
  seen: Set<string>,
): PendingNode[] {
  const out: PendingNode[] = []
  for (const node of nodes) {
    if (node.kind === 'separator') {
      out.push({ kind: 'separator' })
    } else if (node.kind === 'entry') {
      if (seen.has(node.id) || hidden.has(node.id)) continue
      seen.add(node.id)
      if (isAvailable(node.id)) out.push({ kind: 'entry', id: node.id })
    } else {
      const children = prune(node.children, depth + 1, hidden, isAvailable, seen)
      const count = children.reduce((sum, child) => sum + entryCount(child), 0)
      if (count === 0) continue
      const display: GroupDisplay =
        depth > 0 && (node.display === 'auto' || node.display === 'collapsed') ? 'inline' : node.display
      const group: PendingGroup = { kind: 'group', id: node.id, display, children, count }
      if (node.builtin) group.builtin = node.builtin
      if (node.label) group.label = node.label
      if (node.icon) group.icon = node.icon
      out.push(group)
    }
  }
  return out
}

function entryCount(node: PendingNode): number {
  if (node.kind === 'entry') return 1
  if (node.kind === 'group') return node.count
  return 0
}

/** Rows a node takes in its container, with every auto group open. */
function rowCount(node: PendingNode): number {
  if (node.kind === 'entry') return 1
  if (node.kind === 'separator') return 0
  if (node.display === 'inline' || node.display === 'auto') {
    return node.children.reduce((sum, child) => sum + rowCount(child), 0)
  }
  return 1
}

/** Separators set apart inline and collapsed groups, and are never first, last or doubled. */
function finish(nodes: readonly PendingNode[], autoDisplay: 'inline' | 'collapsed'): ResolvedNode[] {
  const spaced: ResolvedNode[] = []
  for (const node of nodes) {
    if (node.kind !== 'group') {
      spaced.push(node)
      continue
    }
    const display = node.display === 'auto' ? autoDisplay : node.display
    const group: ResolvedGroup = { ...node, display, children: finish(node.children, 'inline') }
    const apart = display === 'inline' || display === 'collapsed'
    if (apart) spaced.push({ kind: 'separator' })
    spaced.push(group)
    if (apart) spaced.push({ kind: 'separator' })
  }
  const out: ResolvedNode[] = []
  for (const node of spaced) {
    if (node.kind === 'separator' && (out.length === 0 || out[out.length - 1].kind === 'separator')) continue
    out.push(node)
  }
  if (out.length > 0 && out[out.length - 1].kind === 'separator') out.pop()
  return out
}

export function resolveLayout(
  layout: MenuLayout,
  isAvailable: (id: ContextMenuEntryId) => boolean,
): ResolvedNode[] {
  const pending = prune(layout.nodes, 0, new Set(layout.hidden), isAvailable, new Set())
  const rows = pending.reduce((sum, node) => sum + rowCount(node), 0)
  return finish(pending, rows > AUTO_COLLAPSE_ROWS ? 'collapsed' : 'inline')
}

/** The entry ids a resolved menu shows, in order (flyouts and collapsed groups included). */
export function resolvedEntryIds(nodes: readonly ResolvedNode[]): ContextMenuEntryId[] {
  const out: ContextMenuEntryId[] = []
  for (const node of nodes) {
    if (node.kind === 'entry') out.push(node.id)
    else if (node.kind === 'group') out.push(...resolvedEntryIds(node.children))
  }
  return out
}
