import { describe, expect, it } from 'vitest'

import {
  addGroup,
  addSeparator,
  canMoveInto,
  dissolveGroup,
  findEntryPath,
  findGroupPath,
  flattenLayout,
  hideEntry,
  moveNode,
  moveSibling,
  newGroupId,
  nodeAt,
  pinEntry,
  removeNode,
  resetEntry,
  resetGroup,
  showEntry,
  updateGroup,
} from './edit'
import { CONTEXT_MENU_ENTRIES, DEFAULT_LAYOUT, type ContextMenuEntryId } from './entries'
import type { LayoutNode, MenuLayout } from './types'

const e = (id: ContextMenuEntryId): LayoutNode => ({ kind: 'entry', id })

/** A small layout: Open, Download, [Edit: Copy, Cut], separator, Properties. */
const SMALL: MenuLayout = {
  v: 1,
  hidden: [],
  removedGroups: [],
  nodes: [
    e('open.open'),
    e('sync.download'),
    { kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [e('edit.copy'), e('edit.cut')] },
    { kind: 'separator' },
    e('collab.properties'),
  ],
}

/** Entry ids in menu order (depth first), for compact assertions. */
function order(layout: MenuLayout): string[] {
  return flattenLayout(layout).map(({ node }) =>
    node.kind === 'entry' ? node.id : node.kind === 'group' ? `[${node.id}` : '---',
  )
}

/** Every registry id is either placed once or hidden (nothing lost, nothing doubled). */
function expectComplete(layout: MenuLayout) {
  const placed = flattenLayout(layout).flatMap(({ node }) => (node.kind === 'entry' ? [node.id] : []))
  expect(new Set(placed).size).toBe(placed.length)
  for (const { id } of CONTEXT_MENU_ENTRIES) {
    expect(placed.includes(id) !== layout.hidden.includes(id), id).toBe(true)
  }
}

describe('moveNode', () => {
  it('moves down in the same container (index counted before the move)', () => {
    const next = moveNode(SMALL, [0], { parent: [], index: 2 })
    expect(order(next).slice(0, 3)).toEqual(['sync.download', 'open.open', '[edit'])
  })

  it('moves into a group and out again', () => {
    const into = moveNode(SMALL, [4], { parent: [2], index: 0 })
    expect(order(into)).toEqual(['open.open', 'sync.download', '[edit', 'collab.properties', 'edit.copy', 'edit.cut', '---'])
    const out = moveNode(into, [2, 0], { parent: [], index: 0 })
    expect(order(out)[0]).toBe('collab.properties')
  })

  it('moves a node to a container that comes after it', () => {
    const next = moveNode(SMALL, [0], { parent: [2], index: 2 })
    expect(nodeAt(next, [1])).toMatchObject({ kind: 'group', id: 'edit' })
    expect(order(next)).toEqual(['sync.download', '[edit', 'edit.copy', 'edit.cut', 'open.open', '---', 'collab.properties'])
  })

  it('never moves a group into itself and never past the depth limit', () => {
    expect(canMoveInto(SMALL, [2], [2])).toBe(false)
    expect(moveNode(SMALL, [2], { parent: [2], index: 0 })).toBe(SMALL)
    // Generate > On server is two levels; it fits inside one more group, not two.
    const generate = findGroupPath(DEFAULT_LAYOUT, 'generate')!
    const edit = findGroupPath(DEFAULT_LAYOUT, 'edit')!
    expect(canMoveInto(DEFAULT_LAYOUT, generate, edit)).toBe(true)
    const nested = moveNode(DEFAULT_LAYOUT, generate, { parent: edit, index: 0 })
    const editInNested = findGroupPath(nested, 'edit')!
    const fileActions = findGroupPath(nested, 'fileActions')!
    expect(canMoveInto(nested, editInNested, fileActions)).toBe(false)
  })

  it('does not change the input', () => {
    const before = JSON.stringify(SMALL)
    moveNode(SMALL, [0], { parent: [2], index: 0 })
    expect(JSON.stringify(SMALL)).toBe(before)
  })
})

describe('moveSibling', () => {
  it('swaps with the neighbour and steps out of a group at its edge', () => {
    expect(order(moveSibling(SMALL, [1], -1)).slice(0, 2)).toEqual(['sync.download', 'open.open'])
    const out = moveSibling(SMALL, [2, 0], -1)
    expect(order(out).slice(0, 4)).toEqual(['open.open', 'sync.download', 'edit.copy', '[edit'])
    const after = moveSibling(SMALL, [2, 1], 1)
    expect(order(after)).toEqual(['open.open', 'sync.download', '[edit', 'edit.copy', 'edit.cut', '---', 'collab.properties'])
  })

  it('skips siblings the person cannot see', () => {
    const next = moveSibling(SMALL, [0], 1, (node) => node.kind === 'entry' && node.id === 'sync.download')
    // Past the hidden Download and then past the next visible node, the Edit group.
    expect(order(next).slice(0, 5)).toEqual(['sync.download', '[edit', 'edit.copy', 'edit.cut', 'open.open'])
  })

  it('stays put at the top of the menu', () => {
    expect(moveSibling(SMALL, [0], -1)).toBe(SMALL)
  })
})

describe('hide, show, pin, reset', () => {
  it('hiding takes an entry out and lists it as hidden', () => {
    const next = hideEntry(SMALL, 'sync.download')
    expect(findEntryPath(next, 'sync.download')).toBeNull()
    expect(next.hidden).toEqual(['sync.download'])
    expect(removeNode(SMALL, [1]).hidden).toEqual(['sync.download'])
  })

  it('showing puts it at a given place, or back at its default place', () => {
    const hidden = hideEntry(DEFAULT_LAYOUT, 'sync.download')
    const back = showEntry(hidden, 'sync.download')
    expect(back.hidden).toEqual([])
    expect(findEntryPath(back, 'sync.download')).toEqual(findEntryPath(DEFAULT_LAYOUT, 'sync.download'))
    const top = showEntry(hidden, 'sync.download', { parent: [], index: 0 })
    expect(findEntryPath(top, 'sync.download')).toEqual([0])
    expectComplete(back)
  })

  it('pins an entry from deep inside a group to the very top', () => {
    const next = pinEntry(DEFAULT_LAYOUT, 'generate.local.step')
    expect(findEntryPath(next, 'generate.local.step')).toEqual([0])
    expectComplete(next)
    // A hidden entry can be pinned too.
    const hidden = hideEntry(DEFAULT_LAYOUT, 'generate.local.step')
    expect(findEntryPath(pinEntry(hidden, 'generate.local.step'), 'generate.local.step')).toEqual([0])
  })

  it('reset puts an entry back where the defaults have it', () => {
    const pinned = pinEntry(DEFAULT_LAYOUT, 'generate.local.step')
    const back = resetEntry(pinned, 'generate.local.step')
    expect(findEntryPath(back, 'generate.local.step')).toEqual(findEntryPath(DEFAULT_LAYOUT, 'generate.local.step'))
    expectComplete(back)
  })
})

describe('groups', () => {
  it('adds a named group with entries in it', () => {
    const id = newGroupId(DEFAULT_LAYOUT)
    const next = addGroup(DEFAULT_LAYOUT, {
      id,
      label: 'Export to',
      icon: 'export',
      display: 'submenu',
      at: { parent: [], index: 0 },
      entries: ['generate.local.step', 'generate.local.pdf'],
    })
    const group = nodeAt(next, [0])
    expect(group).toMatchObject({ kind: 'group', id, label: 'Export to', icon: 'export', display: 'submenu' })
    expect(group?.kind === 'group' && group.children.map((c) => (c.kind === 'entry' ? c.id : c.kind))).toEqual([
      'generate.local.step',
      'generate.local.pdf',
    ])
    expectComplete(next)
  })

  it('keeps an empty group (the person fills it next)', () => {
    const next = addGroup(SMALL, { id: 'g-empty01', label: 'Mine', display: 'inline' })
    expect(nodeAt(next, [5])).toMatchObject({ kind: 'group', id: 'g-empty01', children: [] })
  })

  it('renames, changes icon and display; an empty name clears the label', () => {
    const renamed = updateGroup(SMALL, [2], { label: '  Clipboard  ', icon: 'clipboard', display: 'inline' })
    expect(nodeAt(renamed, [2])).toMatchObject({ label: 'Clipboard', icon: 'clipboard', display: 'inline' })
    const cleared = updateGroup(renamed, [2], { label: '', icon: null })
    const node = nodeAt(cleared, [2])
    expect(node?.kind === 'group' && node.label).toBeFalsy()
    expect(node?.kind === 'group' && node.icon).toBeFalsy()
  })

  it('dissolving puts the children in its place and remembers a built-in group', () => {
    const next = dissolveGroup(SMALL, [2])
    expect(order(next)).toEqual(['open.open', 'sync.download', 'edit.copy', 'edit.cut', '---', 'collab.properties'])
    expect(next.removedGroups).toEqual(['edit'])
    expect(removeNode(SMALL, [2]).removedGroups).toEqual(['edit'])
  })

  it('resetting a built-in group brings back its entries, order and nested groups', () => {
    const generate = findGroupPath(DEFAULT_LAYOUT, 'generate')!
    let changed = pinEntry(DEFAULT_LAYOUT, 'generate.local.step')
    changed = hideEntry(changed, 'generate.server.pdf')
    changed = dissolveGroup(changed, findGroupPath(changed, 'generateLocal')!)
    changed = updateGroup(changed, findGroupPath(changed, 'generate')!, { label: 'Make', display: 'inline' })
    const reset = resetGroup(changed, 'generate')
    const path = findGroupPath(reset, 'generate')!
    expect(nodeAt(reset, path)).toEqual(nodeAt(DEFAULT_LAYOUT, generate))
    expect(reset.hidden).toEqual([])
    expect(reset.removedGroups).toEqual([])
    expectComplete(reset)
  })

  it('a group that is not built in cannot be reset', () => {
    const next = addGroup(SMALL, { id: 'g-mine0001', label: 'Mine', display: 'submenu' })
    expect(resetGroup(next, 'g-mine0001')).toBe(next)
  })
})

describe('separators', () => {
  it('adds and removes one', () => {
    const next = addSeparator(SMALL, { parent: [], index: 1 })
    expect(order(next).slice(0, 3)).toEqual(['open.open', '---', 'sync.download'])
    expect(order(removeNode(next, [1]))).toEqual(order(SMALL))
  })
})
