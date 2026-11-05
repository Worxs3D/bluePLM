import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYOUT } from './entries'
import {
  sanitizeContextMenuPrefsByOrg,
  sanitizeLayout,
  sanitizeOrgContextMenu,
  sanitizeUserContextMenuPrefs,
} from './sanitize'
import {
  APP_DEFAULT_TEMPLATE_ID,
  MAX_GROUP_LABEL,
  MAX_LAYOUT_NODES,
  MAX_TEMPLATES,
  MAX_USER_GROUPS,
  type LayoutGroupNode,
  type LayoutNode,
  type MenuLayout,
} from './types'

const ORG = '0b9d1f2e-3c4a-4b5d-8e6f-7a8b9c0d1e2f'

function layout(nodes: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { v: 1, nodes, hidden: [], removedGroups: [], ...extra }
}

function groups(nodes: readonly LayoutNode[]): LayoutGroupNode[] {
  const out: LayoutGroupNode[] = []
  for (const node of nodes) {
    if (node.kind === 'group') out.push(node, ...groups(node.children))
  }
  return out
}

describe('sanitizeLayout', () => {
  it('returns null for what is not a layout', () => {
    expect(sanitizeLayout(null)).toBeNull()
    expect(sanitizeLayout('layout')).toBeNull()
    expect(sanitizeLayout([])).toBeNull()
    expect(sanitizeLayout({ v: 1 })).toBeNull()
    expect(sanitizeLayout({ v: 1, nodes: 'x' })).toBeNull()
    expect(sanitizeLayout({ v: 2, nodes: [] })).toBeNull()
  })

  it('round-trips DEFAULT_LAYOUT unchanged, also through JSON', () => {
    expect(sanitizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT)
    expect(sanitizeLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)))).toEqual(DEFAULT_LAYOUT)
  })

  it('reads a layout without v, hidden or removedGroups', () => {
    expect(sanitizeLayout({ nodes: [{ kind: 'entry', id: 'open.open' }] })).toEqual({
      v: 1,
      nodes: [{ kind: 'entry', id: 'open.open' }],
      hidden: [],
      removedGroups: [],
    })
  })

  it('drops unknown ids, unknown kinds, junk and duplicates (first place wins)', () => {
    const result = sanitizeLayout(
      layout([
        { kind: 'entry', id: 'open.open' },
        { kind: 'entry', id: 'no.such.entry' },
        { kind: 'entry' },
        { kind: 'widget', id: 'open.open' },
        null,
        42,
        'open.open',
        { kind: 'group', id: 'g-one', display: 'submenu', children: [{ kind: 'entry', id: 'open.open' }, { kind: 'entry', id: 'edit.copy' }] },
        { kind: 'entry', id: 'edit.copy' },
        { kind: 'separator', extra: true },
      ]),
    )
    expect(result?.nodes).toEqual([
      { kind: 'entry', id: 'open.open' },
      { kind: 'group', id: 'g-one', display: 'submenu', children: [{ kind: 'entry', id: 'edit.copy' }] },
      { kind: 'separator' },
    ])
  })

  it('dissolves groups deeper than MAX_GROUP_DEPTH into their parent and makes deep collapse inline', () => {
    const result = sanitizeLayout(
      layout([
        {
          kind: 'group',
          id: 'g-1',
          display: 'collapsed',
          children: [
            {
              kind: 'group',
              id: 'g-2',
              display: 'auto',
              children: [
                {
                  kind: 'group',
                  id: 'g-3',
                  display: 'collapsed',
                  children: [
                    { kind: 'entry', id: 'open.open' },
                    {
                      kind: 'group',
                      id: 'g-4',
                      display: 'submenu',
                      children: [
                        { kind: 'entry', id: 'edit.copy' },
                        { kind: 'group', id: 'g-5', display: 'submenu', children: [{ kind: 'entry', id: 'edit.cut' }] },
                      ],
                    },
                    { kind: 'entry', id: 'edit.paste' },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    )
    const g1 = result?.nodes[0] as LayoutGroupNode
    expect(g1.display).toBe('collapsed')
    const g2 = g1.children[0] as LayoutGroupNode
    expect(g2.display).toBe('inline')
    const g3 = g2.children[0] as LayoutGroupNode
    expect(g3.display).toBe('inline')
    expect(g3.children).toEqual([
      { kind: 'entry', id: 'open.open' },
      { kind: 'entry', id: 'edit.copy' },
      { kind: 'entry', id: 'edit.cut' },
      { kind: 'entry', id: 'edit.paste' },
    ])
  })

  it('does not choke on absurdly deep raw nesting', () => {
    let node: Record<string, unknown> = { kind: 'entry', id: 'open.open' }
    for (let i = 0; i < 5000; i++) node = { kind: 'group', id: `g-${i}`, display: 'submenu', children: [node] }
    expect(() => sanitizeLayout(layout([node]))).not.toThrow()
  })

  it('demotes bad built-in claims to user groups with fresh ids', () => {
    const result = sanitizeLayout(
      layout([
        { kind: 'group', id: 'whatever', builtin: 'edit', display: 'submenu', children: [] },
        { kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [] },
        { kind: 'group', id: 'g-x', builtin: 'nonsense', display: 'submenu', children: [] },
        { kind: 'group', id: 'generate', display: 'submenu', children: [] },
        { kind: 'group', id: '__proto__', display: 'submenu', children: [] },
        { kind: 'group', id: 'g-dupe', display: 'submenu', children: [] },
        { kind: 'group', id: 'g-dupe', display: 'submenu', children: [] },
      ]),
    )
    const nodes = result?.nodes as LayoutGroupNode[]
    expect(nodes[0]).toMatchObject({ id: 'edit', builtin: 'edit' })
    // Second claim of `edit`: a user group now.
    expect(nodes[1].builtin).toBeUndefined()
    expect(nodes[1].id).toMatch(/^g-/)
    // A demoted group keeps the built-in's name as its own label.
    expect(nodes[1].label).toBe('Edit')
    expect(nodes[3].label).toBe('Generate')
    expect(nodes[2]).toEqual({ kind: 'group', id: 'g-x', display: 'submenu', children: [] })
    expect(nodes[3].builtin).toBeUndefined()
    expect(nodes[3].id).not.toBe('generate')
    expect(nodes[4].id).not.toBe('__proto__')
    expect(nodes[5].id).toBe('g-dupe')
    expect(nodes[6].id).not.toBe('g-dupe')
    const ids = nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never hands out a fresh id that a later group already uses', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'group', id: 'generate', display: 'submenu', children: [], n: i }))
    const result = sanitizeLayout(layout([...many, { kind: 'group', id: 'g-keep', display: 'submenu', children: [] }]))
    const ids = (result?.nodes as LayoutGroupNode[]).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[ids.length - 1]).toBe('g-keep')
  })

  it('repairs display, label and icon', () => {
    const result = sanitizeLayout(
      layout([
        { kind: 'group', id: 'g-a', display: 'sideways', label: '   ', icon: 'star', children: [] },
        { kind: 'group', id: 'g-b', label: `  ${'x'.repeat(100)}  `, icon: '<script>', children: [] },
        { kind: 'group', id: 'g-c', display: 'inline', label: ' Mine ', icon: 'constructor', children: [] },
      ]),
    )
    const [a, b, c] = result?.nodes as LayoutGroupNode[]
    expect(a).toEqual({ kind: 'group', id: 'g-a', display: 'submenu', icon: 'star', children: [] })
    expect(b.label).toHaveLength(MAX_GROUP_LABEL)
    expect(b.icon).toBeUndefined()
    expect(c).toEqual({ kind: 'group', id: 'g-c', display: 'inline', label: 'Mine', children: [] })
  })

  it('takes placed ids out of hidden and present groups out of removedGroups', () => {
    const result = sanitizeLayout(
      layout(
        [
          { kind: 'entry', id: 'open.open' },
          { kind: 'group', id: 'edit', builtin: 'edit', display: 'submenu', children: [] },
        ],
        {
          hidden: ['open.open', 'edit.copy', 'edit.copy', 'bogus', 7],
          removedGroups: ['edit', 'more', 'more', 'bogus'],
        },
      ),
    )
    expect(result?.hidden).toEqual(['edit.copy'])
    expect(result?.removedGroups).toEqual(['more'])
  })

  it('caps nodes and user groups', () => {
    const seps = Array.from({ length: MAX_LAYOUT_NODES + 50 }, () => ({ kind: 'separator' }))
    expect(sanitizeLayout(layout(seps))?.nodes).toHaveLength(MAX_LAYOUT_NODES)

    const userGroups = Array.from({ length: MAX_USER_GROUPS + 5 }, (_, i) => ({
      kind: 'group',
      id: `g-${i}`,
      display: 'submenu',
      children: i === MAX_USER_GROUPS + 2 ? [{ kind: 'entry', id: 'open.open' }] : [],
    }))
    const result = sanitizeLayout(layout(userGroups)) as MenuLayout
    expect(groups(result.nodes)).toHaveLength(MAX_USER_GROUPS)
    // An extra group is dissolved: its entry is lifted, not lost.
    expect(result.nodes).toContainEqual({ kind: 'entry', id: 'open.open' })
  })

  it('ignores prototype keys in the input', () => {
    const raw = JSON.parse(
      '{"v":1,"__proto__":{"polluted":true},"nodes":[{"kind":"entry","id":"open.open","__proto__":{"polluted":true}}],"hidden":[],"removedGroups":[]}',
    )
    const result = sanitizeLayout(raw)
    expect(result?.nodes).toEqual([{ kind: 'entry', id: 'open.open' }])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(result?.nodes[0] ?? {})).toEqual(['kind', 'id'])
  })

  it('is idempotent', () => {
    const messy = layout(
      [
        { kind: 'group', id: 'edit', display: 'auto', children: [{ kind: 'entry', id: 'edit.copy' }] },
        { kind: 'group', id: 'more', builtin: 'more', display: 'auto', children: [{ kind: 'entry', id: 'collab.watch' }] },
        { kind: 'separator' },
        { kind: 'entry', id: 'edit.copy' },
      ],
      { hidden: ['collab.watch', 'open.open'], removedGroups: ['more', 'edit'] },
    )
    const once = sanitizeLayout(messy)
    expect(sanitizeLayout(once)).toEqual(once)
  })
})

describe('sanitizeOrgContextMenu', () => {
  const okLayout = { v: 1, nodes: [{ kind: 'entry', id: 'open.open' }], hidden: [], removedGroups: [] }
  const template = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Template ${id}`,
    layout: okLayout,
    updated_at: '2026-11-01T10:00:00.000Z',
    ...extra,
  })

  it('returns null for what is not settings, and an empty list for no templates', () => {
    expect(sanitizeOrgContextMenu(undefined)).toBeNull()
    expect(sanitizeOrgContextMenu('x')).toBeNull()
    expect(sanitizeOrgContextMenu({})).toEqual({ templates: [] })
  })

  it('drops unreadable templates and keeps the rest', () => {
    const result = sanitizeOrgContextMenu({
      templates: [
        template('t1', { description: `  ${'d'.repeat(500)}`, updated_by: 'user-1' }),
        template(APP_DEFAULT_TEMPLATE_ID),
        template('t1'),
        template('t2', { name: '   ' }),
        template('t3', { layout: { v: 9, nodes: [] } }),
        template('bad id!'),
        template('t4', { updated_at: 'yesterday' }),
        null,
      ],
      default_template_id: 't2',
      forced_at: 'not a time',
    })
    expect(result?.templates.map((t) => t.id)).toEqual(['t1', 't4'])
    expect(result?.templates[0].description).toHaveLength(200)
    expect(result?.templates[0].updated_by).toBe('user-1')
    expect(result?.templates[1].updated_at).toBe(new Date(0).toISOString())
    expect(result?.default_template_id).toBeUndefined()
    expect(result?.forced_at).toBeUndefined()
  })

  it('keeps a default naming a kept template and a valid forced_at; caps the count', () => {
    const many = Array.from({ length: MAX_TEMPLATES + 3 }, (_, i) => template(`t${i}`))
    const result = sanitizeOrgContextMenu({
      templates: many,
      default_template_id: 't3',
      forced_at: '2026-11-02T08:00:00.000Z',
    })
    expect(result?.templates).toHaveLength(MAX_TEMPLATES)
    expect(result?.default_template_id).toBe('t3')
    expect(result?.forced_at).toBe('2026-11-02T08:00:00.000Z')
  })
})

describe('sanitizeUserContextMenuPrefs / sanitizeContextMenuPrefsByOrg', () => {
  it('reads good prefs as they are', () => {
    const prefs = {
      templateId: 't1',
      pinned: ['generate.local.step'],
      hidden: ['collab.watch'],
      custom: DEFAULT_LAYOUT,
      customizedFrom: { templateId: APP_DEFAULT_TEMPLATE_ID, baseHash: 'v1-abc' },
      updatedAt: '2026-11-01T00:00:00.000Z',
      keptAfterForce: '2026-11-02T00:00:00.000Z',
    }
    expect(sanitizeUserContextMenuPrefs(prefs)).toEqual(prefs)
  })

  it('repairs broken fields', () => {
    expect(
      sanitizeUserContextMenuPrefs({
        templateId: 5,
        pinned: ['open.open', 'open.open', 'nope'],
        hidden: ['open.open', 'edit.cut'],
        custom: { broken: true },
        customizedFrom: { templateId: 't', baseHash: 'x'.repeat(500) },
        updatedAt: 'soon',
      }),
    ).toEqual({ templateId: null, pinned: ['open.open'], hidden: ['edit.cut'], custom: null })
    expect(sanitizeUserContextMenuPrefs('prefs')).toBeNull()
  })

  it('keeps only uuid and no-org keys, and drops unreadable prefs', () => {
    const raw = JSON.parse(
      `{"${ORG}":{"templateId":null,"pinned":[],"hidden":[],"custom":null},"_":{"pinned":["open.open"]},"org-1":{"pinned":[]},"__proto__":{"pinned":[]},"${ORG.replace('0', '1')}":"junk"}`,
    )
    const result = sanitizeContextMenuPrefsByOrg(raw)
    expect(Object.keys(result).sort()).toEqual([ORG, '_'].sort())
    expect(result._).toEqual({ templateId: null, pinned: ['open.open'], hidden: [], custom: null })
    expect(sanitizeContextMenuPrefsByOrg(null)).toEqual({})
    expect(sanitizeContextMenuPrefsByOrg([1, 2])).toEqual({})
  })
})
