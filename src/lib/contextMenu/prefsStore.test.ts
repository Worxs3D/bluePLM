/**
 * `contextMenuPrefs` in the real store: the setter sanitizes and stamps, the persisted value is
 * part of `partialize`, and the persist merge survives corrupt local storage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'
import { CURRENT_STORE_VERSION } from '@/stores/migrations'
import { resetPDMStore } from '@/test/pdmStoreReset'

import { DEFAULT_LAYOUT } from './entries'
import { NO_ORG_KEY, type UserContextMenuPrefs } from './types'

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const ORG = '0b9d1f2e-3c4a-4b5d-8e6f-7a8b9c0d1e2f'

function prefs(patch: Partial<UserContextMenuPrefs> = {}): UserContextMenuPrefs {
  return { templateId: null, pinned: [], hidden: [], custom: null, ...patch }
}

function merge(persisted: Record<string, unknown>) {
  const options = usePDMStore.persist.getOptions()
  if (!options.merge) throw new Error('the store has no merge')
  return options.merge({ _storeVersion: CURRENT_STORE_VERSION, ...persisted }, usePDMStore.getState())
}

beforeEach(() => resetPDMStore())

describe('setContextMenuPrefs', () => {
  it('stores, sanitizes and stamps one organization\'s prefs', () => {
    usePDMStore
      .getState()
      .setContextMenuPrefs(ORG, prefs({ pinned: ['open.open', 'no.such' as never, 'open.open'] }))
    const stored = usePDMStore.getState().contextMenuPrefs[ORG]
    expect(stored.pinned).toEqual(['open.open'])
    expect(Number.isFinite(Date.parse(stored.updatedAt ?? ''))).toBe(true)
  })

  it('keeps a given time and leaves other organizations alone', () => {
    const { setContextMenuPrefs } = usePDMStore.getState()
    setContextMenuPrefs(NO_ORG_KEY, prefs({ hidden: ['edit.cut'] }))
    setContextMenuPrefs(ORG, prefs({ custom: DEFAULT_LAYOUT, updatedAt: '2026-11-01T00:00:00.000Z' }))
    const all = usePDMStore.getState().contextMenuPrefs
    expect(all[ORG].updatedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(all[ORG].custom).toEqual(DEFAULT_LAYOUT)
    expect(all[NO_ORG_KEY].hidden).toEqual(['edit.cut'])
  })

  it('removes with null and ignores keys that are not organizations', () => {
    const { setContextMenuPrefs } = usePDMStore.getState()
    setContextMenuPrefs(ORG, prefs())
    setContextMenuPrefs(ORG, null)
    setContextMenuPrefs('__proto__', prefs())
    setContextMenuPrefs('org-1', prefs())
    expect(usePDMStore.getState().contextMenuPrefs).toEqual({})
  })

  it('is persisted', () => {
    usePDMStore.getState().setContextMenuPrefs(ORG, prefs({ pinned: ['edit.copy'] }))
    const partialize = usePDMStore.persist.getOptions().partialize
    if (!partialize) throw new Error('the store has no partialize')
    const state = partialize(usePDMStore.getState()) as Record<string, unknown>
    expect(state.contextMenuPrefs).toBe(usePDMStore.getState().contextMenuPrefs)
  })
})

describe('persist merge of contextMenuPrefs', () => {
  it('restores good prefs', () => {
    const good = { [ORG]: prefs({ pinned: ['edit.copy'], updatedAt: '2026-11-01T00:00:00.000Z' }) }
    expect(merge({ contextMenuPrefs: good }).contextMenuPrefs).toEqual(good)
  })

  it('survives corrupt storage', () => {
    for (const corrupt of [undefined, null, 'x', 42, [], [prefs()]]) {
      expect(merge({ contextMenuPrefs: corrupt }).contextMenuPrefs).toEqual({})
    }
    const mixed = JSON.parse(
      `{"${ORG}":{"pinned":["open.open","bogus"],"hidden":"all","custom":{"v":1,"nodes":[{"kind":"group","id":"g-a","display":"weird","children":[{"kind":"entry","id":"edit.copy"},{"kind":"entry","id":"edit.copy"}]}]}},"__proto__":{"pinned":[]},"not-an-org":{}}`,
    )
    const merged = merge({ contextMenuPrefs: mixed }).contextMenuPrefs
    expect(Object.keys(merged)).toEqual([ORG])
    expect(merged[ORG]).toEqual({
      templateId: null,
      pinned: ['open.open'],
      hidden: [],
      custom: {
        v: 1,
        nodes: [{ kind: 'group', id: 'g-a', display: 'submenu', children: [{ kind: 'entry', id: 'edit.copy' }] }],
        hidden: [],
        removedGroups: [],
      },
    })
  })
})
