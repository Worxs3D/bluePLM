import { describe, expect, it } from 'vitest'

import { pinEntry } from '@/lib/contextMenu/edit'
import { effectiveLayout } from '@/lib/contextMenu/effective'
import { DEFAULT_LAYOUT } from '@/lib/contextMenu/entries'
import type { OrgContextMenuSettings, UserContextMenuPrefs } from '@/lib/contextMenu/types'

import { editablePrefs, keptPrefs, prefsToStore } from './prefsModel'

const FORCED = '2026-11-02T10:00:00.000Z'
const TEMPLATE_ID = '00000000-0000-4000-8000-c0a7e0000001'
const org = (forced?: string) => ({
  settings: {
    context_menu: {
      templates: [{ id: TEMPLATE_ID, name: 'Drafting', layout: DEFAULT_LAYOUT, updated_at: '2026-11-01T00:00:00.000Z' }],
      ...(forced ? { forced_at: forced } : {}),
    } satisfies OrgContextMenuSettings,
  },
})

/** A person's own layout made before the admin's force. */
const before: UserContextMenuPrefs = {
  templateId: null,
  pinned: ['sync.download'],
  hidden: ['edit.cut'],
  custom: pinEntry(DEFAULT_LAYOUT, 'generate.local.step'),
  customizedFrom: { templateId: 'app-default', baseHash: 'x' },
  updatedAt: '2026-11-01T00:00:00.000Z',
}

describe('prefs while an admin has set them aside', () => {
  it('the page edits without the set-aside layout', () => {
    expect(effectiveLayout(org(FORCED), before).setAsideByForce).toBe(true)
    const edit = editablePrefs(before, true)
    expect(edit).toMatchObject({ custom: null, pinned: [], hidden: [], customizedFrom: undefined })
    expect(editablePrefs(before, false)).toBe(before)
  })

  it('a template change cannot bring the old layout back', () => {
    const written = prefsToStore({ ...editablePrefs(before, true), templateId: TEMPLATE_ID })!
    const after = effectiveLayout(org(FORCED), written)
    expect(after.source).toBe('template')
    expect(after.setAsideByForce).toBe(false)
    expect(written.custom).toBeNull()
  })

  it('"Keep my layout" keeps it', () => {
    const kept = keptPrefs(before, FORCED)
    const after = effectiveLayout(org(FORCED), kept)
    expect(after.source).toBe('custom')
    expect(after.setAsideByForce).toBe(false)
  })

  it('nothing left to remember is stored as nothing', () => {
    expect(prefsToStore(editablePrefs(before, true))).toBeNull()
  })
})
