import { describe, expect, it } from 'vitest'

import { completeLayout } from './complete'
import { CONTEXT_MENU_ENTRIES, DEFAULT_LAYOUT, type ContextMenuEntryId } from './entries'
import type { LayoutGroupNode, LayoutNode, MenuLayout } from './types'

const e = (id: ContextMenuEntryId): LayoutNode => ({ kind: 'entry', id })
const sep: LayoutNode = { kind: 'separator' }

function clone(layout: MenuLayout): MenuLayout {
  return JSON.parse(JSON.stringify(layout)) as MenuLayout
}

/** `layout` without these entries and groups (as an older app version would have saved it). */
function without(layout: MenuLayout, ids: readonly string[]): MenuLayout {
  const drop = new Set(ids)
  const strip = (nodes: LayoutNode[]): LayoutNode[] =>
    nodes
      .filter((node) => node.kind === 'separator' || !drop.has(node.id))
      .map((node) => (node.kind === 'group' ? { ...node, children: strip(node.children) } : node))
  return { ...clone(layout), nodes: strip(clone(layout).nodes) }
}

function findGroup(nodes: readonly LayoutNode[], id: string): LayoutGroupNode | undefined {
  for (const node of nodes) {
    if (node.kind !== 'group') continue
    if (node.id === id) return node
    const inner = findGroup(node.children, id)
    if (inner) return inner
  }
  return undefined
}

function ids(nodes: readonly LayoutNode[]): string[] {
  return nodes.map((node) => (node.kind === 'separator' ? '|' : node.id))
}

function allEntries(nodes: readonly LayoutNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'entry' ? [node.id] : node.kind === 'group' ? allEntries(node.children) : [],
  )
}

describe('completeLayout with the app default', () => {
  it('is the identity on DEFAULT_LAYOUT (same object back)', () => {
    expect(completeLayout(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT)
    expect(completeLayout(clone(DEFAULT_LAYOUT))).toEqual(DEFAULT_LAYOUT)
  })

  it('places every registry entry exactly once', () => {
    const placed = allEntries(DEFAULT_LAYOUT.nodes)
    expect([...placed].sort()).toEqual(CONTEXT_MENU_ENTRIES.map((entry) => entry.id).sort())
  })

  it('puts a new entry back after its nearest preceding default sibling', () => {
    const old = without(DEFAULT_LAYOUT, ['sync.getLatest'])
    expect(completeLayout(old)).toEqual(DEFAULT_LAYOUT)
  })

  it('puts a new first entry of a group first in that group', () => {
    const old = without(DEFAULT_LAYOUT, ['generate.local.table'])
    expect(completeLayout(old)).toEqual(DEFAULT_LAYOUT)
  })

  it('keeps a run of new entries in their default order', () => {
    const old = without(DEFAULT_LAYOUT, ['delete.removeLocal', 'delete.deleteLocal', 'delete.serverKeepLocal'])
    expect(completeLayout(old)).toEqual(DEFAULT_LAYOUT)
  })

  it('leaves hidden entries hidden', () => {
    const layout = { ...without(DEFAULT_LAYOUT, ['sync.getLatest', 'collab.watch']), hidden: ['sync.getLatest', 'collab.watch'] as ContextMenuEntryId[] }
    const done = completeLayout(layout)
    expect(done).toBe(layout)
    expect(allEntries(done.nodes)).not.toContain('sync.getLatest')
  })

  it('does not mutate its input', () => {
    const old = without(DEFAULT_LAYOUT, ['edit.cut'])
    const snapshot = clone(old)
    completeLayout(old)
    expect(old).toEqual(snapshot)
  })

  it('recreates a built-in group the layout has never seen, at its default place, with its entries', () => {
    const old = without(DEFAULT_LAYOUT, ['edit', 'edit.copy', 'edit.cut', 'edit.paste'])
    expect(completeLayout(old)).toEqual(DEFAULT_LAYOUT)
  })

  it('recreates a nested built-in group inside its parent', () => {
    const old = without(DEFAULT_LAYOUT, ['generateServer', 'generate.server.pdf', 'generate.server.step', 'generate.server.inspectionReport'])
    expect(completeLayout(old)).toEqual(DEFAULT_LAYOUT)
  })

  it('does not recreate a removed built-in group: its new entries go after its preceding top-level sibling', () => {
    const old = {
      ...without(DEFAULT_LAYOUT, ['edit', 'edit.copy', 'edit.cut', 'edit.paste']),
      removedGroups: ['edit' as const],
    }
    const done = completeLayout(old)
    expect(findGroup(done.nodes, 'edit')).toBeUndefined()
    const top = ids(done.nodes)
    const at = top.indexOf('fileActions')
    expect(top.slice(at, at + 4)).toEqual(['fileActions', 'edit.copy', 'edit.cut', 'edit.paste'])
  })

  it('puts entries of a removed group at the end when no preceding top-level sibling is left', () => {
    const defaults: MenuLayout = {
      v: 1,
      hidden: [],
      removedGroups: [],
      nodes: [{ kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [e('edit.copy'), e('edit.cut')] }, e('open.open')],
    }
    const layout: MenuLayout = { v: 1, hidden: [], removedGroups: ['edit'], nodes: [e('open.open')] }
    expect(ids(completeLayout(layout, defaults).nodes)).toEqual(['open.open', 'edit.copy', 'edit.cut'])
  })

  it('never nests a recreated group deeper than allowed', () => {
    // generate sits at depth 3 (inside two user groups), so generateServer cannot go inside it.
    const base = without(DEFAULT_LAYOUT, ['generateServer', 'generate.server.pdf', 'generate.server.step', 'generate.server.inspectionReport'])
    const generate = findGroup(base.nodes, 'generate') as LayoutGroupNode
    const rest = base.nodes.filter((node) => node !== generate)
    const layout: MenuLayout = {
      ...base,
      nodes: [
        {
          kind: 'group',
          id: 'g-outer',
          display: 'submenu',
          children: [{ kind: 'group', id: 'g-inner', display: 'submenu', children: [generate] }],
        },
        ...rest,
      ],
    }
    const done = completeLayout(layout)
    const top = ids(done.nodes)
    // Up at the top level, after generate's nearest preceding default sibling there.
    expect(top[top.indexOf('checkout.syncMetadata') + 1]).toBe('generateServer')
    expect(ids((findGroup(done.nodes, 'generateServer') as LayoutGroupNode).children)).toEqual([
      'generate.server.pdf',
      'generate.server.step',
      'generate.server.inspectionReport',
    ])
  })
})

describe('completeLayout placement rules (small defaults)', () => {
  const defaults: MenuLayout = {
    v: 1,
    hidden: [],
    removedGroups: [],
    nodes: [
      e('open.open'),
      e('open.goToFolder'),
      e('sync.download'),
      sep,
      {
        kind: 'group',
        id: 'edit',
        builtin: 'edit',
        display: 'submenu',
        children: [e('edit.copy'), e('edit.cut'), e('edit.paste')],
      },
    ],
  }

  it('skips a default sibling moved into a user group (stays in the default container)', () => {
    const layout: MenuLayout = {
      v: 1,
      hidden: [],
      removedGroups: [],
      nodes: [
        { kind: 'group', id: 'g-mine', display: 'submenu', children: [e('open.goToFolder')] },
        e('open.open'),
        { kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [e('edit.copy'), e('edit.cut'), e('edit.paste')] },
      ],
    }
    const done = completeLayout(layout, defaults)
    expect(ids(done.nodes)).toEqual(['g-mine', 'open.open', 'sync.download', 'edit'])
    expect(ids((done.nodes[0] as LayoutGroupNode).children)).toEqual(['open.goToFolder'])
  })

  it('skips a hidden default sibling', () => {
    const layout: MenuLayout = {
      v: 1,
      hidden: ['open.goToFolder'],
      removedGroups: [],
      nodes: [
        e('open.open'),
        e('edit.copy'),
        { kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [e('edit.cut'), e('edit.paste')] },
      ],
    }
    expect(ids(completeLayout(layout, defaults).nodes)).toEqual(['open.open', 'sync.download', 'edit.copy', 'edit'])
  })

  it('puts a new entry first in its container when no preceding sibling is there', () => {
    const layout: MenuLayout = {
      v: 1,
      hidden: [],
      removedGroups: [],
      nodes: [
        e('sync.download'),
        e('open.goToFolder'),
        { kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [e('edit.paste'), e('edit.cut')] },
      ],
    }
    const done = completeLayout(layout, defaults)
    expect(ids(done.nodes)).toEqual(['open.open', 'sync.download', 'open.goToFolder', 'edit'])
    expect(ids((done.nodes[3] as LayoutGroupNode).children)).toEqual(['edit.copy', 'edit.paste', 'edit.cut'])
  })

  it('places a new entry in its default group wherever the person moved that group', () => {
    const layout: MenuLayout = {
      v: 1,
      hidden: [],
      removedGroups: [],
      nodes: [
        { kind: 'group', id: 'g-mine', display: 'inline', children: [{ kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [e('edit.copy'), e('edit.paste')] }] },
        e('open.open'),
        e('open.goToFolder'),
        e('sync.download'),
      ],
    }
    const done = completeLayout(layout, defaults)
    expect(ids((findGroup(done.nodes, 'edit') as LayoutGroupNode).children)).toEqual(['edit.copy', 'edit.cut', 'edit.paste'])
  })
})
