/**
 * Adds to a layout what it has never seen: entries and built-in groups of a newer app version.
 *
 * An entry is "never seen" when it is neither placed in `nodes` nor in `hidden`; a built-in group
 * when it is neither in `nodes` nor in `removedGroups`. Each goes to its default place, worked
 * out from the default layout (precedence agreed in the design audit, M1/M2):
 *
 * 1. Its default container (top level, or the group it sits in by default) exists in the layout:
 *    after the nearest preceding default sibling that the container holds directly (siblings
 *    moved elsewhere or hidden are skipped), else first in the container.
 * 2. The container is gone (the person removed that group): one level up (further while that is
 *    gone too), after the nearest of the node's own preceding default siblings, then of the
 *    missing group's, that this container holds directly, else at its end. At the top level this
 *    reads "after the nearest preceding default top-level sibling, else the end".
 *
 * Missing nodes are handled in default order, so a run of new entries keeps its order, and a
 * recreated built-in group starts empty and is then filled by its own new entries.
 */

import { DEFAULT_LAYOUT, isContextMenuEntryId, type ContextMenuEntryId } from './entries'
import { MAX_GROUP_DEPTH, type LayoutGroupNode, type LayoutNode, type MenuLayout } from './types'

interface DefaultPlace {
  node: LayoutNode
  /** The default containers from the top level down: [] = top level, else group ids. */
  path: string[]
  /** For each level of `path` (plus the node's own level), the preceding siblings, nearest first. */
  precedingAtLevel: LayoutNode[][]
}

/** The key a node is matched by across layouts (separators have none). */
function nodeKey(node: LayoutNode): string | null {
  if (node.kind === 'entry') return `e:${node.id}`
  if (node.kind === 'group') return `g:${node.id}`
  return null
}

function walkDefaults(defaults: readonly LayoutNode[]): DefaultPlace[] {
  const out: DefaultPlace[] = []
  const walk = (list: readonly LayoutNode[], path: string[], ancestorsPreceding: LayoutNode[][]) => {
    list.forEach((node, index) => {
      if (node.kind === 'separator') return
      const preceding = list.slice(0, index).reverse()
      const precedingAtLevel = [...ancestorsPreceding, preceding]
      out.push({ node, path, precedingAtLevel })
      if (node.kind === 'group') walk(node.children, [...path, node.id], precedingAtLevel)
    })
  }
  walk(defaults, [], [])
  return out
}

function cloneNodes(nodes: readonly LayoutNode[]): LayoutNode[] {
  return nodes.map((node) =>
    node.kind === 'group' ? { ...node, children: cloneNodes(node.children) } : { ...node },
  )
}

interface Located {
  group: LayoutGroupNode
  depth: number
}

function indexGroups(nodes: LayoutNode[], depth = 1, out = new Map<string, Located>()): Map<string, Located> {
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    out.set(node.id, { group: node, depth })
    indexGroups(node.children, depth + 1, out)
  }
  return out
}

function placedEntries(nodes: readonly LayoutNode[], out = new Set<ContextMenuEntryId>()): Set<ContextMenuEntryId> {
  for (const node of nodes) {
    if (node.kind === 'entry') out.add(node.id)
    else if (node.kind === 'group') placedEntries(node.children, out)
  }
  return out
}

/**
 * Insert `node` after the first of `preceding` (nearest first, separators included) that `list`
 * holds directly; else at `fallback`. When the defaults have a separator between that sibling
 * and the node, and the layout too has one right after the sibling, the node goes after it, so a
 * new first entry of a block stays in its block.
 */
function insertAfterSibling(
  list: LayoutNode[],
  node: LayoutNode,
  preceding: readonly LayoutNode[],
  fallback: 'first' | 'end',
): void {
  let crossedSeparator = false
  for (const sibling of preceding) {
    const key = nodeKey(sibling)
    if (!key) {
      crossedSeparator = true
      continue
    }
    const index = list.findIndex((candidate) => nodeKey(candidate) === key)
    if (index >= 0) {
      const skip = crossedSeparator && list[index + 1]?.kind === 'separator' ? 1 : 0
      list.splice(index + 1 + skip, 0, node)
      return
    }
  }
  if (fallback === 'first') list.unshift(node)
  else list.push(node)
}

/**
 * `layout` with every never-seen entry and built-in group of `defaults` added at its default place.
 * Returns `layout` itself when nothing is missing.
 */
export function completeLayout(layout: MenuLayout, defaults: MenuLayout = DEFAULT_LAYOUT): MenuLayout {
  const places = walkDefaults(defaults.nodes)
  const hidden = new Set<string>(layout.hidden)
  const removed = new Set<string>(layout.removedGroups)
  const placed = placedEntries(layout.nodes)
  const groupIds = new Set(indexGroups(layout.nodes).keys())

  const missing = places.filter(({ node }) => {
    if (node.kind === 'entry') return !placed.has(node.id) && !hidden.has(node.id)
    if (node.kind === 'group') {
      // Only the app's own groups come back; a group a default layout made up does not.
      return Boolean(node.builtin) && !groupIds.has(node.id) && !removed.has(node.id)
    }
    return false
  })
  if (missing.length === 0) return layout

  const nodes = cloneNodes(layout.nodes)
  for (const { node, path, precedingAtLevel } of missing) {
    if (node.kind === 'separator') continue
    if (node.kind === 'entry' && !isContextMenuEntryId(node.id)) continue
    const groups = indexGroups(nodes)
    const fresh: LayoutNode =
      node.kind === 'group'
        ? {
            kind: 'group',
            id: node.id,
            ...(node.builtin ? { builtin: node.builtin } : {}),
            ...(node.label ? { label: node.label } : {}),
            ...(node.icon ? { icon: node.icon } : {}),
            display: node.display,
            children: [],
          }
        : { kind: 'entry', id: node.id }
    // A recreated group must not end up deeper than groups may nest.
    const ownDepth = node.kind === 'group' ? 1 : 0

    // Walk up from the default container until one exists in the layout (the top level always does).
    let level = path.length
    let container: LayoutNode[] | null = null
    while (level >= 0) {
      if (level === 0) {
        container = nodes
        break
      }
      const located = groups.get(path[level - 1])
      if (located && located.depth + ownDepth <= MAX_GROUP_DEPTH) {
        container = located.group.children
        break
      }
      level--
    }
    if (!container) continue
    const direct = level === path.length
    // Walked up: the node's own default siblings come first (an earlier entry of the same removed
    // group was put here a moment ago, so the run keeps its order), then each missing ancestor's.
    const candidates: LayoutNode[] = []
    for (let k = path.length; k >= level; k--) candidates.push(...precedingAtLevel[k])
    insertAfterSibling(container, fresh, candidates, direct ? 'first' : 'end')
  }
  return { ...layout, nodes }
}
