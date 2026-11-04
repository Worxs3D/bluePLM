import { describe, expect, it } from 'vitest'

import { completeLayout } from './complete'
import { applyQuickPrefs, effectiveLayout, layoutHash, orgKey, orgTemplates } from './effective'
import { DEFAULT_LAYOUT, type ContextMenuEntryId } from './entries'
import { resolveLayout, resolvedEntryIds } from './resolve'
import {
  APP_DEFAULT_TEMPLATE_ID,
  NO_ORG_KEY,
  type LayoutNode,
  type MenuLayout,
  type OrgContextMenuSettings,
  type OrgMenuTemplate,
  type UserContextMenuPrefs,
} from './types'

const ORG = '0b9d1f2e-3c4a-4b5d-8e6f-7a8b9c0d1e2f'
const e = (id: ContextMenuEntryId): LayoutNode => ({ kind: 'entry', id })

function layoutOf(nodes: LayoutNode[], hidden: ContextMenuEntryId[] = []): MenuLayout {
  return { v: 1, nodes, hidden, removedGroups: [] }
}

/** A template that knows only Export as STEP and Open; the rest is completed in. */
const EXPORT_FIRST = layoutOf([e('generate.local.step'), { kind: 'separator' }, e('open.open')])
const SHORT = layoutOf([e('open.open'), e('edit.copy')])

function template(id: string, layout: MenuLayout, updatedAt = '2026-11-01T10:00:00.000Z'): OrgMenuTemplate {
  return { id, name: id, layout, updated_at: updatedAt }
}

function org(settings: OrgContextMenuSettings | unknown) {
  return { settings: { context_menu: settings } }
}

function prefs(patch: Partial<UserContextMenuPrefs> = {}): UserContextMenuPrefs {
  return { templateId: null, pinned: [], hidden: [], custom: null, ...patch }
}

const ORG_SETTINGS: OrgContextMenuSettings = {
  templates: [template('export', EXPORT_FIRST), template('short', SHORT)],
  default_template_id: 'export',
}

describe('orgKey / orgTemplates', () => {
  it('keys prefs by organization id, or NO_ORG_KEY', () => {
    expect(orgKey(ORG)).toBe(ORG)
    expect(orgKey(null)).toBe(NO_ORG_KEY)
    expect(orgKey(undefined)).toBe(NO_ORG_KEY)
    expect(orgKey('__proto__')).toBe(NO_ORG_KEY)
  })

  it('sanitizes what the organization stores', () => {
    expect(orgTemplates(null)).toEqual({ settings: null, templates: [] })
    expect(orgTemplates(org('junk'))).toEqual({ settings: null, templates: [] })
    const read = orgTemplates(org({ templates: [template('ok', SHORT), { id: 'bad' }], default_template_id: 'bad' }))
    expect(read.templates.map((t) => t.id)).toEqual(['ok'])
    expect(read.settings?.default_template_id).toBeUndefined()
  })

  it('returns the same sanitized object for the same stored settings', () => {
    const o = org(ORG_SETTINGS)
    expect(orgTemplates(o).settings).toBe(orgTemplates(o).settings)
  })
})

describe('effectiveLayout layers', () => {
  it('is the app default with no organization and no prefs', () => {
    const result = effectiveLayout(null, undefined)
    expect(result.source).toBe('app')
    expect(result.layout).toBe(DEFAULT_LAYOUT)
    expect(result.template).toBeNull()
    expect(result.baseHash).toBe(layoutHash(DEFAULT_LAYOUT))
    expect(result.setAsideByForce).toBe(false)
  })

  it('follows the organization default, completed', () => {
    const result = effectiveLayout(org(ORG_SETTINGS), undefined)
    expect(result.source).toBe('org-default')
    expect(result.template?.id).toBe('export')
    expect(result.layout.nodes.slice(0, 3)).toEqual(EXPORT_FIRST.nodes)
    expect(result.layout).toEqual(completeLayout(EXPORT_FIRST))
    expect(result.baseHash).toBe(layoutHash(EXPORT_FIRST))
    // Export first in the resolved menu, as the colleague asked.
    expect(resolvedEntryIds(resolveLayout(result.layout, () => true))[0]).toBe('generate.local.step')
  })

  it('follows a picked template over the organization default', () => {
    const result = effectiveLayout(org(ORG_SETTINGS), prefs({ templateId: 'short' }))
    expect(result.source).toBe('template')
    expect(result.template?.id).toBe('short')
  })

  it('falls back to the organization default when the picked template is gone', () => {
    const result = effectiveLayout(org(ORG_SETTINGS), prefs({ templateId: 'deleted' }))
    expect(result.source).toBe('org-default')
    expect(result.template?.id).toBe('export')
  })

  it('falls back to the app default when neither exists', () => {
    const result = effectiveLayout(org({ templates: [] }), prefs({ templateId: 'deleted' }))
    expect(result.source).toBe('app')
    expect(result.layout).toBe(DEFAULT_LAYOUT)
  })

  it('picks the app default on purpose with APP_DEFAULT_TEMPLATE_ID', () => {
    const result = effectiveLayout(org(ORG_SETTINGS), prefs({ templateId: APP_DEFAULT_TEMPLATE_ID }))
    expect(result.source).toBe('app')
    expect(result.template).toBeNull()
    expect(result.layout).toBe(DEFAULT_LAYOUT)
  })

  it('uses the person\'s own layout over every template, completed', () => {
    const custom = layoutOf([e('edit.paste')])
    const result = effectiveLayout(
      org(ORG_SETTINGS),
      prefs({ custom, customizedFrom: { templateId: 'export', baseHash: layoutHash(EXPORT_FIRST) } }),
    )
    expect(result.source).toBe('custom')
    // The person's own placement survives completion (top level, not back in Edit).
    expect(result.layout.nodes).toContainEqual(e('edit.paste'))
    expect(result.layout).toEqual(completeLayout(custom))
    expect(result.template?.id).toBe('export')
    expect(result.templateChangedSinceCustomized).toBe(false)
  })

  it('says when the template a custom layout came from has changed since', () => {
    const custom = layoutOf([e('edit.paste')])
    const result = effectiveLayout(
      org({ ...ORG_SETTINGS, templates: [template('export', SHORT, '2026-11-03T00:00:00.000Z')] }),
      prefs({ custom, customizedFrom: { templateId: 'export', baseHash: layoutHash(EXPORT_FIRST) } }),
    )
    expect(result.templateChangedSinceCustomized).toBe(true)
    expect(result.baseHash).toBe(layoutHash(SHORT))
  })

  it('compares a copy of the app default with the app default', () => {
    const custom = layoutOf([e('edit.paste')])
    const from = { templateId: APP_DEFAULT_TEMPLATE_ID, baseHash: layoutHash(DEFAULT_LAYOUT) }
    expect(effectiveLayout(org(ORG_SETTINGS), prefs({ custom, customizedFrom: from })).templateChangedSinceCustomized).toBe(false)
    const stale = { ...from, baseHash: 'v1-00000000000000' }
    const result = effectiveLayout(org(ORG_SETTINGS), prefs({ custom, customizedFrom: stale }))
    expect(result.templateChangedSinceCustomized).toBe(true)
    expect(result.template).toBeNull()
  })

  it('does not claim a change when the template a custom layout came from was deleted', () => {
    const custom = layoutOf([e('edit.paste')])
    const result = effectiveLayout(
      org(ORG_SETTINGS),
      prefs({ templateId: 'short', custom, customizedFrom: { templateId: 'gone', baseHash: 'v1-x' } }),
    )
    expect(result.source).toBe('custom')
    expect(result.templateChangedSinceCustomized).toBe(false)
    expect(result.template?.id).toBe('short')
  })

  it('applies quick pins and hidden over the live template', () => {
    const result = effectiveLayout(
      org(ORG_SETTINGS),
      prefs({ pinned: ['edit.copy', 'collab.watch'], hidden: ['open.open'] }),
    )
    expect(result.source).toBe('quick')
    expect(result.template?.id).toBe('export')
    expect(result.layout.nodes.slice(0, 3)).toEqual([e('edit.copy'), e('collab.watch'), { kind: 'separator' }])
    expect(result.layout.hidden).toContain('open.open')
    const ids = resolvedEntryIds(resolveLayout(result.layout, () => true))
    expect(ids.filter((id) => id === 'edit.copy')).toHaveLength(1)
    expect(ids).not.toContain('open.open')
  })

  it('ignores the picked template\'s pins only when custom exists', () => {
    const custom = layoutOf([e('edit.paste')])
    const result = effectiveLayout(org(ORG_SETTINGS), prefs({ custom, pinned: ['edit.copy'] }))
    expect(result.source).toBe('custom')
    // The person's own placement survives completion (top level, not back in Edit).
    expect(result.layout.nodes).toContainEqual(e('edit.paste'))
  })
})

describe('effectiveLayout and "Apply to everyone now"', () => {
  const forced: OrgContextMenuSettings = { ...ORG_SETTINGS, forced_at: '2026-11-02T12:00:00.000Z' }
  const custom = layoutOf([e('edit.paste')])

  it('sets aside a custom layout made before the force', () => {
    const result = effectiveLayout(org(forced), prefs({ custom, updatedAt: '2026-11-01T00:00:00.000Z' }))
    expect(result.setAsideByForce).toBe(true)
    expect(result.source).toBe('org-default')
  })

  it('sets aside pins and hidden made before the force, and one with no time at all', () => {
    const old = effectiveLayout(org(forced), prefs({ pinned: ['edit.copy'], updatedAt: '2026-11-01T00:00:00.000Z' }))
    expect(old.setAsideByForce).toBe(true)
    expect(old.source).toBe('org-default')
    const undated = effectiveLayout(org(forced), prefs({ hidden: ['open.open'] }))
    expect(undated.setAsideByForce).toBe(true)
  })

  it('keeps the picked template through a force', () => {
    const result = effectiveLayout(org(forced), prefs({ templateId: 'short', custom, updatedAt: '2026-11-01T00:00:00.000Z' }))
    expect(result.source).toBe('template')
    expect(result.template?.id).toBe('short')
  })

  it('keeps a layout changed after the force, or kept after it', () => {
    const newer = effectiveLayout(org(forced), prefs({ custom, updatedAt: '2026-11-03T00:00:00.000Z' }))
    expect(newer.source).toBe('custom')
    expect(newer.setAsideByForce).toBe(false)
    const kept = effectiveLayout(
      org(forced),
      prefs({ custom, updatedAt: '2026-11-01T00:00:00.000Z', keptAfterForce: '2026-11-02T12:00:00.000Z' }),
    )
    expect(kept.source).toBe('custom')
  })

  it('sets aside again after a second force', () => {
    const later = { ...forced, forced_at: '2026-11-04T00:00:00.000Z' }
    const result = effectiveLayout(
      org(later),
      prefs({ custom, updatedAt: '2026-11-01T00:00:00.000Z', keptAfterForce: '2026-11-02T12:00:00.000Z' }),
    )
    expect(result.setAsideByForce).toBe(true)
  })

  it('reports nothing set aside when the person has no layout of their own', () => {
    expect(effectiveLayout(org(forced), prefs({ templateId: 'short' })).setAsideByForce).toBe(false)
  })
})

describe('applyQuickPrefs', () => {
  it('moves pins to the top from inside groups, then a separator', () => {
    const out = applyQuickPrefs(DEFAULT_LAYOUT, ['generate.local.step', 'edit.cut'], [])
    expect(out.nodes.slice(0, 3)).toEqual([e('generate.local.step'), e('edit.cut'), { kind: 'separator' }])
    const ids = resolvedEntryIds(resolveLayout(out, () => true))
    expect(ids.filter((id) => id === 'generate.local.step')).toHaveLength(1)
    expect(ids.filter((id) => id === 'edit.cut')).toHaveLength(1)
  })

  it('hides without a separator when nothing is pinned, and a pin wins over hide', () => {
    const out = applyQuickPrefs(DEFAULT_LAYOUT, ['open.open'], ['open.open', 'collab.watch'])
    expect(out.hidden).toEqual(['collab.watch'])
    const hiddenOnly = applyQuickPrefs(DEFAULT_LAYOUT, [], ['open.open'])
    expect(hiddenOnly.nodes[0]).toEqual(e('open.goToFolder'))
    expect(hiddenOnly.hidden).toEqual(['open.open'])
  })

  it('pins an entry the template hid', () => {
    const out = applyQuickPrefs(layoutOf([e('open.open')], ['edit.copy']), ['edit.copy'], [])
    expect(out.hidden).toEqual([])
    expect(out.nodes[0]).toEqual(e('edit.copy'))
  })

  it('returns the layout itself with nothing to apply', () => {
    expect(applyQuickPrefs(DEFAULT_LAYOUT, [], [])).toBe(DEFAULT_LAYOUT)
  })
})

describe('layoutHash', () => {
  it('ignores key order and changes with the layout', () => {
    const a = layoutOf([e('open.open'), e('edit.copy')])
    const reordered = JSON.parse('{"removedGroups":[],"hidden":[],"nodes":[{"id":"open.open","kind":"entry"},{"id":"edit.copy","kind":"entry"}],"v":1}')
    expect(layoutHash(reordered)).toBe(layoutHash(a))
    expect(layoutHash(layoutOf([e('edit.copy'), e('open.open')]))).not.toBe(layoutHash(a))
    expect(layoutHash(layoutOf([e('open.open'), e('edit.copy')], ['edit.cut']))).not.toBe(layoutHash(a))
    expect(layoutHash(a)).toMatch(/^v1-[0-9a-f]{14}$/)
  })
})
