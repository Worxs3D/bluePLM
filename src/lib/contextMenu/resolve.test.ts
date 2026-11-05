import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYOUT, type ContextMenuEntryId } from './entries'
import { resolveLayout, resolvedEntryIds, type ResolvedGroup, type ResolvedNode } from './resolve'
import { AUTO_COLLAPSE_ROWS, type LayoutNode, type MenuLayout } from './types'

const e = (id: ContextMenuEntryId): LayoutNode => ({ kind: 'entry', id })
const sep: LayoutNode = { kind: 'separator' }

function only(...ids: ContextMenuEntryId[]): (id: ContextMenuEntryId) => boolean {
  const set = new Set<string>(ids)
  return (id) => set.has(id)
}

const all = () => true

function shape(nodes: readonly ResolvedNode[]): unknown[] {
  return nodes.map((node) =>
    node.kind === 'separator'
      ? '|'
      : node.kind === 'entry'
        ? node.id
        : { [`${node.id}:${node.display}:${node.count}`]: shape(node.children) },
  )
}

function layoutOf(nodes: LayoutNode[], hidden: ContextMenuEntryId[] = []): MenuLayout {
  return { v: 1, nodes, hidden, removedGroups: [] }
}

/** A flat run of distinct entries, for row counts. */
const RUN: ContextMenuEntryId[] = [
  'open.open',
  'open.goToFolder',
  'sync.download',
  'sync.getLatest',
  'sync.firstCheckIn',
  'checkout.checkOut',
  'checkout.checkIn',
  'checkout.discard',
  'checkout.changeState',
  'fileActions.copyName',
  'fileActions.copyPath',
  'fileActions.pin',
  'fileActions.rename',
  'edit.copy',
  'edit.cut',
  'edit.paste',
  'delete.removeLocal',
]

function autoMenu(topEntries: number, autoChildren: number): MenuLayout {
  const top = RUN.slice(0, topEntries).map(e)
  const children = RUN.slice(topEntries, topEntries + autoChildren).map(e)
  return layoutOf([...top, { kind: 'group', id: 'more', builtin: 'more', display: 'auto', children }])
}

describe('resolveLayout', () => {
  it('collapses More on the full default menu', () => {
    const resolved = resolveLayout(DEFAULT_LAYOUT, all)
    const more = resolved.find((n) => n.kind === 'group' && n.id === 'more') as ResolvedGroup
    expect(more.display).toBe('collapsed')
    expect(more.count).toBe(10)
    // Set apart by a separator before it, and nothing after it.
    expect(resolved[resolved.length - 1]).toBe(more)
    expect(resolved[resolved.length - 2]).toEqual({ kind: 'separator' })
  })

  it('keeps More inline on a short menu, and drops everything that does not apply', () => {
    const resolved = resolveLayout(DEFAULT_LAYOUT, only('open.open', 'checkout.checkOut', 'collab.properties'))
    // The empty SOLIDWORKS group (inline) takes its separators with it: Open, Check out.
    expect(shape(resolved)).toEqual([
      'open.open',
      'checkout.checkOut',
      '|',
      { 'more:inline:1': ['collab.properties'] },
    ])
  })

  it('drops empty groups, nested ones included, and counts entries at any depth', () => {
    const resolved = resolveLayout(DEFAULT_LAYOUT, only('generate.local.step', 'generate.local.iges', 'reviews'))
    expect(shape(resolved)).toEqual([
      { 'generate:submenu:2': [{ 'generateLocal:submenu:2': ['generate.local.step', 'generate.local.iges'] }] },
      'reviews',
    ])
  })

  it('normalises separators inside a flyout', () => {
    const one = resolveLayout(DEFAULT_LAYOUT, only('fileActions.copyName', 'fileActions.pin'))
    expect(shape(one)).toEqual([{ 'fileActions:submenu:2': ['fileActions.copyName', '|', 'fileActions.pin'] }])
    const two = resolveLayout(DEFAULT_LAYOUT, only('fileActions.pin'))
    expect(shape(two)).toEqual([{ 'fileActions:submenu:1': ['fileActions.pin'] }])
  })

  it('never puts a separator first, last or twice', () => {
    const layout = layoutOf([sep, sep, e('open.open'), sep, sep, e('edit.copy'), sep, e('edit.cut'), sep, sep])
    expect(shape(resolveLayout(layout, only('open.open', 'edit.cut')))).toEqual(['open.open', '|', 'edit.cut'])
    expect(resolveLayout(layout, only())).toEqual([])
  })

  it('sets an inline group apart with separators on both sides', () => {
    const layout = layoutOf([
      e('open.open'),
      { kind: 'group', id: 'g-mine', label: 'Mine', display: 'inline', children: [sep, e('edit.copy'), e('edit.cut'), sep] },
      e('edit.paste'),
    ])
    expect(shape(resolveLayout(layout, all))).toEqual([
      'open.open',
      '|',
      { 'g-mine:inline:2': ['edit.copy', 'edit.cut'] },
      '|',
      'edit.paste',
    ])
    const group = resolveLayout(layout, all)[2] as ResolvedGroup
    expect(group.label).toBe('Mine')
  })

  it(`stays inline at exactly ${AUTO_COLLAPSE_ROWS} rows and collapses at one more`, () => {
    const atLimit = resolveLayout(autoMenu(AUTO_COLLAPSE_ROWS - 2, 2), all)
    expect((atLimit[atLimit.length - 1] as ResolvedGroup).display).toBe('inline')
    const over = resolveLayout(autoMenu(AUTO_COLLAPSE_ROWS - 2, 3), all)
    expect((over[over.length - 1] as ResolvedGroup).display).toBe('collapsed')
  })

  it('counts a submenu as one row and an inline group by its rows', () => {
    const many = RUN.slice(0, 10).map(e)
    const asSubmenu = layoutOf([
      { kind: 'group', id: 'g-big', display: 'submenu', children: many },
      e('delete.removeLocal'),
      { kind: 'group', id: 'more', builtin: 'more', display: 'auto', children: [e('collab.properties')] },
    ])
    const short = resolveLayout(asSubmenu, all)
    expect((short[short.length - 1] as ResolvedGroup).display).toBe('inline')

    const asInline = layoutOf([
      { kind: 'group', id: 'g-big', display: 'inline', children: [...many, ...RUN.slice(10, 15).map(e)] },
      e('delete.removeLocal'),
      { kind: 'group', id: 'more', builtin: 'more', display: 'auto', children: [e('collab.properties')] },
    ])
    const resolved = resolveLayout(asInline, all)
    expect((resolved[resolved.length - 1] as ResolvedGroup).display).toBe('collapsed')
  })

  it('reads auto and collapsed below the top level as inline', () => {
    const layout = layoutOf([
      {
        kind: 'group',
        id: 'g-outer',
        display: 'submenu',
        children: [
          e('open.open'),
          { kind: 'group', id: 'g-auto', display: 'auto', children: [e('edit.copy')] },
          { kind: 'group', id: 'g-col', display: 'collapsed', children: [e('edit.cut')] },
        ],
      },
    ])
    expect(shape(resolveLayout(layout, all))).toEqual([
      {
        'g-outer:submenu:3': ['open.open', '|', { 'g-auto:inline:1': ['edit.copy'] }, '|', { 'g-col:inline:1': ['edit.cut'] }],
      },
    ])
  })

  it('drops hidden entries and repeats even when a layout still names them', () => {
    const layout = layoutOf([e('open.open'), e('edit.copy'), e('open.open')], ['edit.copy'])
    expect(resolvedEntryIds(resolveLayout(layout, all))).toEqual(['open.open'])
  })

  it('lists entry ids in menu order', () => {
    const ids = resolvedEntryIds(resolveLayout(DEFAULT_LAYOUT, only('open.open', 'edit.copy', 'collab.watch')))
    expect(ids).toEqual(['open.open', 'edit.copy', 'collab.watch'])
  })
})
