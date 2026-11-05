/**
 * Pure edits of a right-click menu layout, for the settings editor (`MenuLayoutEditor`).
 *
 * A node is addressed by its path: the indexes from the top level down (`[3]` is the fourth
 * top-level node, `[3, 0]` the first child of that group). A place to put something is a container
 * (`parent`: `[]` for the top level, else a group's path) and an index in it, counted before the
 * moved node is taken out.
 *
 * Every edit returns a new layout (the input is never changed) that has been through
 * `sanitizeLayout`, so the editor can never store something the menu would not read back the same.
 * An entry taken out of the menu always goes to `hidden`: an entry in neither place is one the
 * layout has never seen, and `completeLayout` would bring it back at its default place. That is
 * also how "put back where it was" works (`resetEntry`).
 */

import { completeLayout } from './complete'
import { DEFAULT_LAYOUT, isContextMenuGroupId, type ContextMenuEntryId, type ContextMenuGroupId } from './entries'
import { layoutGroupIds, newUserGroupId, sanitizeLayout } from './sanitize'
import {
  MAX_GROUP_DEPTH,
  type GroupDisplay,
  type LayoutGroupNode,
  type LayoutNode,
  type MenuLayout,
} from './types'

export type NodePath = readonly number[]

/** A place in a layout: a container (`[]` = the top level, else a group's path) and an index in it. */
export interface InsertAt {
  parent: NodePath
  index: number
}

export interface FlatLayoutRow {
  path: NodePath
  /** 0 for a top-level node. */
  depth: number
  node: LayoutNode
}

function clone(layout: MenuLayout): MenuLayout {
  return {
    v: 1,
    nodes: cloneNodes(layout.nodes),
    hidden: [...layout.hidden],
    removedGroups: [...layout.removedGroups],
  }
}

function cloneNodes(nodes: readonly LayoutNode[]): LayoutNode[] {
  return nodes.map((node) => (node.kind === 'group' ? { ...node, children: cloneNodes(node.children) } : { ...node }))
}

/** The sanitized layout; the input itself if sanitize refuses it (it never should for an edit). */
function finish(layout: MenuLayout): MenuLayout {
  return sanitizeLayout(layout) ?? layout
}

export function samePath(a: NodePath, b: NodePath): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** True when `path` is `ancestor` or lies inside it. */
export function isWithin(path: NodePath, ancestor: NodePath): boolean {
  return path.length >= ancestor.length && ancestor.every((value, i) => value === path[i])
}

export function nodeAt(layout: MenuLayout, path: NodePath): LayoutNode | undefined {
  let list: readonly LayoutNode[] = layout.nodes
  let node: LayoutNode | undefined
  for (const index of path) {
    node = list[index]
    if (!node) return undefined
    list = node.kind === 'group' ? node.children : []
  }
  return node
}

/** The children of a container: the top level for `[]`, else the group at `parent`. */
function containerOf(nodes: LayoutNode[], parent: NodePath): LayoutNode[] | undefined {
  let list = nodes
  for (const index of parent) {
    const node = list[index]
    if (!node || node.kind !== 'group') return undefined
    list = node.children
  }
  return list
}

export function childrenAt(layout: MenuLayout, parent: NodePath): readonly LayoutNode[] | undefined {
  return containerOf(layout.nodes, parent)
}

/** Every node, depth first, in menu order. */
export function flattenLayout(layout: MenuLayout): FlatLayoutRow[] {
  const rows: FlatLayoutRow[] = []
  const walk = (nodes: readonly LayoutNode[], parent: NodePath) => {
    nodes.forEach((node, index) => {
      const path = [...parent, index]
      rows.push({ path, depth: parent.length, node })
      if (node.kind === 'group') walk(node.children, path)
    })
  }
  walk(layout.nodes, [])
  return rows
}

export function findEntryPath(layout: MenuLayout, id: ContextMenuEntryId): NodePath | null {
  return flattenLayout(layout).find((row) => row.node.kind === 'entry' && row.node.id === id)?.path ?? null
}

export function findGroupPath(layout: MenuLayout, groupId: string): NodePath | null {
  return flattenLayout(layout).find((row) => row.node.kind === 'group' && row.node.id === groupId)?.path ?? null
}

/** The groups a node at `path` sits in, outermost first. */
export function ancestorGroups(layout: MenuLayout, path: NodePath): LayoutGroupNode[] {
  const out: LayoutGroupNode[] = []
  for (let i = 1; i < path.length; i++) {
    const node = nodeAt(layout, path.slice(0, i))
    if (node?.kind === 'group') out.push(node)
  }
  return out
}

/** How many levels of groups a node holds (an entry 0, a group of entries 1). */
function groupHeight(node: LayoutNode): number {
  if (node.kind !== 'group') return 0
  return 1 + Math.max(0, ...node.children.map(groupHeight))
}

/**
 * Whether the node at `from` may go into the container `parent`: not into itself, and a group
 * must still fit within `MAX_GROUP_DEPTH`.
 */
export function canMoveInto(layout: MenuLayout, from: NodePath, parent: NodePath): boolean {
  const node = nodeAt(layout, from)
  if (!node) return false
  if (parent.length > 0 && nodeAt(layout, parent)?.kind !== 'group') return false
  if (node.kind === 'group' && isWithin(parent, from)) return false
  return parent.length + groupHeight(node) <= MAX_GROUP_DEPTH
}

/** Takes the node at `path` out of `nodes` (in place) and returns it. */
function detach(nodes: LayoutNode[], path: NodePath): LayoutNode | undefined {
  const list = containerOf(nodes, path.slice(0, -1))
  const index = path[path.length - 1]
  if (!list || index === undefined || index < 0 || index >= list.length) return undefined
  return list.splice(index, 1)[0]
}

/** Where `at` points once the node at `removed` has been taken out. */
function adjustAfterRemoval(at: InsertAt, removed: NodePath): InsertAt {
  const parent = [...at.parent]
  let index = at.index
  const depth = removed.length - 1
  const removedParent = removed.slice(0, -1)
  const removedIndex = removed[depth]
  // The target container lies after the removed node in a shared container: shift its path.
  if (parent.length > depth && samePath(parent.slice(0, depth), removedParent) && parent[depth] > removedIndex) {
    parent[depth] -= 1
  }
  // Same container, later index.
  if (samePath(parent, removedParent) && index > removedIndex) index -= 1
  return { parent, index }
}

function insertInto(nodes: LayoutNode[], node: LayoutNode, at: InsertAt): boolean {
  const list = containerOf(nodes, at.parent)
  if (!list) return false
  list.splice(Math.max(0, Math.min(at.index, list.length)), 0, node)
  return true
}

/** Moves the node at `from` to `to` (index counted before the move). Unchanged when it cannot. */
export function moveNode(layout: MenuLayout, from: NodePath, to: InsertAt): MenuLayout {
  if (!canMoveInto(layout, from, to.parent)) return layout
  const next = clone(layout)
  const node = detach(next.nodes, from)
  if (!node) return layout
  if (!insertInto(next.nodes, node, adjustAfterRemoval(to, from))) return layout
  return finish(next)
}

/** Puts a new node (a separator, a group, an entry from `hidden`) at `at`. */
export function insertNode(layout: MenuLayout, node: LayoutNode, at: InsertAt): MenuLayout {
  const next = clone(layout)
  if (node.kind === 'entry') next.hidden = next.hidden.filter((id) => id !== node.id)
  if (node.kind === 'group' && node.builtin) {
    next.removedGroups = next.removedGroups.filter((id) => id !== node.builtin)
  }
  if (!insertInto(next.nodes, node.kind === 'group' ? { ...node, children: cloneNodes(node.children) } : { ...node }, at)) {
    return layout
  }
  return finish(next)
}

/**
 * Takes the node at `path` out: an entry is hidden, a separator deleted, a group dissolved (its
 * children take its place).
 */
export function removeNode(layout: MenuLayout, path: NodePath): MenuLayout {
  const node = nodeAt(layout, path)
  if (!node) return layout
  if (node.kind === 'group') return dissolveGroup(layout, path)
  const next = clone(layout)
  detach(next.nodes, path)
  if (node.kind === 'entry' && !next.hidden.includes(node.id)) next.hidden.push(node.id)
  return finish(next)
}

/** Takes an entry out of the menu (into `hidden`). */
export function hideEntry(layout: MenuLayout, id: ContextMenuEntryId): MenuLayout {
  const path = findEntryPath(layout, id)
  if (path) return removeNode(layout, path)
  if (layout.hidden.includes(id)) return layout
  const next = clone(layout)
  next.hidden.push(id)
  return finish(next)
}

/**
 * Brings a hidden entry back: at `at` when given, else at its default place (as `completeLayout`
 * places an entry it has never seen).
 */
export function showEntry(
  layout: MenuLayout,
  id: ContextMenuEntryId,
  at?: InsertAt,
  defaults: MenuLayout = DEFAULT_LAYOUT,
): MenuLayout {
  if (at) return insertNode(layout, { kind: 'entry', id }, at)
  const next = clone(layout)
  next.hidden = next.hidden.filter((hiddenId) => hiddenId !== id)
  if (findEntryPath(next, id)) return finish(next)
  return finish(completeLayout(next, defaults))
}

/** Moves an entry (hidden or not) to the very top of the menu. */
export function pinEntry(layout: MenuLayout, id: ContextMenuEntryId): MenuLayout {
  const path = findEntryPath(layout, id)
  if (path) return moveNode(layout, path, { parent: [], index: 0 })
  return insertNode(layout, { kind: 'entry', id }, { parent: [], index: 0 })
}

/** Puts an entry back at its default place (and shows it if it was hidden). */
export function resetEntry(
  layout: MenuLayout,
  id: ContextMenuEntryId,
  defaults: MenuLayout = DEFAULT_LAYOUT,
): MenuLayout {
  const next = clone(layout)
  next.hidden = next.hidden.filter((hiddenId) => hiddenId !== id)
  const path = findEntryPath(next, id)
  if (path) detach(next.nodes, path)
  return finish(completeLayout(next, defaults))
}

/** Moves the node at `path` one place up or down among its siblings, skipping those `skip` names. */
export function moveSibling(
  layout: MenuLayout,
  path: NodePath,
  direction: -1 | 1,
  skip: (node: LayoutNode) => boolean = () => false,
): MenuLayout {
  const parent = path.slice(0, -1)
  const list = childrenAt(layout, parent)
  const index = path[path.length - 1]
  if (!list || index === undefined) return layout
  let target = index + direction
  while (target >= 0 && target < list.length && skip(list[target])) target += direction
  if (target < 0 || target >= list.length) {
    // At the edge of a group: step out of it, just before or after the group.
    if (parent.length === 0) return layout
    const groupIndex = parent[parent.length - 1]
    return moveNode(layout, path, { parent: parent.slice(0, -1), index: direction < 0 ? groupIndex : groupIndex + 1 })
  }
  return moveNode(layout, path, { parent, index: direction < 0 ? target : target + 1 })
}

/** A fresh user group id for this layout. */
export function newGroupId(layout: MenuLayout): string {
  return newUserGroupId(layoutGroupIds(layout.nodes))
}

export interface NewGroup {
  id: string
  label: string
  icon?: string
  display: GroupDisplay
  /** Where it goes; the end of the top level when unset. */
  at?: InsertAt
  /** Entries moved into the new group, in this order. */
  entries?: readonly ContextMenuEntryId[]
}

/** Adds a group a person named (empty, or holding `entries`). */
export function addGroup(layout: MenuLayout, group: NewGroup): MenuLayout {
  const node: LayoutGroupNode = {
    kind: 'group',
    id: group.id,
    label: group.label,
    display: group.display,
    children: [],
  }
  if (group.icon) node.icon = group.icon
  const at = group.at ?? { parent: [], index: layout.nodes.length }
  let next = insertNode(layout, node, at)
  for (const id of group.entries ?? []) {
    const groupPath = findGroupPath(next, group.id)
    if (!groupPath) break
    const children = childrenAt(next, groupPath) ?? []
    const from = findEntryPath(next, id)
    next = from
      ? moveNode(next, from, { parent: groupPath, index: children.length })
      : insertNode(next, { kind: 'entry', id }, { parent: groupPath, index: children.length })
  }
  return next
}

export interface GroupChanges {
  /** A new name; an empty one clears it (a built-in group then shows its own name again). */
  label?: string
  icon?: string | null
  display?: GroupDisplay
}

export function updateGroup(layout: MenuLayout, path: NodePath, changes: GroupChanges): MenuLayout {
  const node = nodeAt(layout, path)
  if (!node || node.kind !== 'group') return layout
  const next = clone(layout)
  const group = nodeAt(next, path) as LayoutGroupNode
  if (changes.label !== undefined) {
    const label = changes.label.trim()
    if (label) group.label = label
    else delete group.label
  }
  if (changes.icon !== undefined) {
    if (changes.icon) group.icon = changes.icon
    else delete group.icon
  }
  if (changes.display) group.display = changes.display
  return finish(next)
}

export function renameGroup(layout: MenuLayout, path: NodePath, label: string): MenuLayout {
  return updateGroup(layout, path, { label })
}

/**
 * Removes a group and puts its children where it was. A built-in group is remembered in
 * `removedGroups`, so a newer app does not bring it back.
 */
export function dissolveGroup(layout: MenuLayout, path: NodePath): MenuLayout {
  const node = nodeAt(layout, path)
  if (!node || node.kind !== 'group') return layout
  const next = clone(layout)
  const list = containerOf(next.nodes, path.slice(0, -1))
  const index = path[path.length - 1]
  if (!list) return layout
  list.splice(index, 1, ...cloneNodes(node.children))
  if (node.builtin && !next.removedGroups.includes(node.builtin)) next.removedGroups.push(node.builtin)
  return finish(next)
}

export function addSeparator(layout: MenuLayout, at: InsertAt): MenuLayout {
  return insertNode(layout, { kind: 'separator' }, at)
}

function defaultGroup(defaults: MenuLayout, id: ContextMenuGroupId): LayoutGroupNode | undefined {
  const path = findGroupPath(defaults, id)
  const node = path ? nodeAt(defaults, path) : undefined
  return node?.kind === 'group' ? node : undefined
}

function entryIdsIn(nodes: readonly LayoutNode[]): ContextMenuEntryId[] {
  return nodes.flatMap((node) =>
    node.kind === 'entry' ? [node.id] : node.kind === 'group' ? entryIdsIn(node.children) : [],
  )
}

function builtinGroupsIn(nodes: readonly LayoutNode[]): ContextMenuGroupId[] {
  return nodes.flatMap((node) =>
    node.kind === 'group' ? [...(node.builtin ? [node.builtin] : []), ...builtinGroupsIn(node.children)] : [],
  )
}

/** Removes every entry in `ids` and every built-in group in `groups` from `nodes`, at any depth. */
function strip(nodes: LayoutNode[], ids: ReadonlySet<string>, groups: ReadonlySet<string>): LayoutNode[] {
  const out: LayoutNode[] = []
  for (const node of nodes) {
    if (node.kind === 'entry' && ids.has(node.id)) continue
    if (node.kind === 'group') {
      // A nested built-in group of the one being reset is rebuilt from the defaults; its other
      // children go back to their default places through completeLayout.
      if (node.builtin && groups.has(node.builtin)) continue
      out.push({ ...node, children: strip(node.children, ids, groups) })
      continue
    }
    out.push(node)
  }
  return out
}

/**
 * Puts a built-in group back the way the defaults have it: its own entries (shown again) in the
 * default order, its name, icon and display. Entries the person had added to it go back to their
 * default places.
 */
export function resetGroup(layout: MenuLayout, groupId: string, defaults: MenuLayout = DEFAULT_LAYOUT): MenuLayout {
  if (!isContextMenuGroupId(groupId)) return layout
  const path = findGroupPath(layout, groupId)
  const original = defaultGroup(defaults, groupId)
  if (!path || !original) return layout
  const ids = new Set<string>(entryIdsIn(original.children))
  const nested = new Set<string>(builtinGroupsIn(original.children))

  const next = clone(layout)
  const target = nodeAt(next, path) as LayoutGroupNode
  target.children = []
  next.nodes = strip(next.nodes, ids, nested)
  const kept = findGroupPath(next, groupId)
  const group = kept ? (nodeAt(next, kept) as LayoutGroupNode) : undefined
  if (!group) return layout
  group.children = cloneNodes(original.children)
  group.display = original.display
  delete group.label
  delete group.icon
  if (original.label) group.label = original.label
  if (original.icon) group.icon = original.icon
  next.hidden = next.hidden.filter((id) => !ids.has(id))
  next.removedGroups = next.removedGroups.filter((id) => !nested.has(id))
  return finish(completeLayout(next, defaults))
}

/** Whether two layouts are the same (same nodes, hidden and removed groups). */
export function sameLayout(a: MenuLayout, b: MenuLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
