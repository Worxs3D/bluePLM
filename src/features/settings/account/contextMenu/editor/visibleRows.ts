/**
 * The rows the layout editor shows: the layout's nodes depth first, without admin-only entries for
 * someone who is not an admin, without the children of a closed group, and, while searching, only
 * the matching entries and the groups they are in.
 */

import { flattenLayout, isWithin, type NodePath } from '@/lib/contextMenu/edit'
import { getContextMenuEntry, type ContextMenuEntryId } from '@/lib/contextMenu/entries'
import type { LayoutGroupNode, LayoutNode, MenuLayout } from '@/lib/contextMenu/types'

export type EditorRow =
  | { kind: 'node'; key: string; path: NodePath; depth: number; node: LayoutNode }
  /** Stands in for an empty (or, for this person, empty-looking) group's children. */
  | { kind: 'empty'; key: string; groupPath: NodePath; depth: number }

/** A row key that stays the same while a node moves (entries and groups); separators by path. */
export function rowKey(node: LayoutNode, path: NodePath): string {
  if (node.kind === 'entry') return `e:${node.id}`
  if (node.kind === 'group') return `g:${node.id}`
  return `s:${path.join('.')}`
}

export function isListedNode(node: LayoutNode, isAdmin: boolean): boolean {
  return node.kind !== 'entry' || isAdmin || !getContextMenuEntry(node.id).adminOnly
}

/** Entries directly or deeper inside a group that this person sees. */
export function listedCount(group: LayoutGroupNode, isAdmin: boolean): number {
  let count = 0
  for (const child of group.children) {
    if (child.kind === 'entry') count += isListedNode(child, isAdmin) ? 1 : 0
    else if (child.kind === 'group') count += listedCount(child, isAdmin)
  }
  return count
}

export interface VisibleRowsOptions {
  isAdmin: boolean
  /** Group ids shown open. */
  open: ReadonlySet<string>
  /** Entry ids matching the search; null = not searching. */
  matches: ReadonlySet<ContextMenuEntryId> | null
}

export function visibleRows(layout: MenuLayout, { isAdmin, open, matches }: VisibleRowsOptions): EditorRow[] {
  const flat = flattenLayout(layout)
  const rows: EditorRow[] = []

  // While searching: the groups that hold a match, so they show (open) around it.
  const holding = new Set<string>()
  if (matches) {
    for (const row of flat) {
      if (row.node.kind !== 'entry' || !matches.has(row.node.id)) continue
      for (const other of flat) {
        if (other.node.kind === 'group' && other.path.length < row.path.length && isWithin(row.path, other.path)) {
          holding.add(other.node.id)
        }
      }
    }
  }

  let closedUnder: NodePath | null = null
  for (const { path, depth, node } of flat) {
    if (closedUnder && isWithin(path, closedUnder)) continue
    closedUnder = null
    if (!isListedNode(node, isAdmin)) continue
    if (matches) {
      if (node.kind === 'separator') continue
      if (node.kind === 'entry' && !matches.has(node.id)) continue
      if (node.kind === 'group' && !holding.has(node.id)) {
        closedUnder = path
        continue
      }
    }
    rows.push({ kind: 'node', key: rowKey(node, path), path, depth, node })
    if (node.kind === 'group') {
      const isOpen = matches ? true : open.has(node.id)
      if (!isOpen) {
        closedUnder = path
        continue
      }
      if (!matches && node.children.filter((child) => isListedNode(child, isAdmin)).length === 0) {
        rows.push({ kind: 'empty', key: `empty:${node.id}`, groupPath: path, depth: depth + 1 })
      }
    }
  }
  return rows
}
