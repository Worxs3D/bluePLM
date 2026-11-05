import { describe, expect, it } from 'vitest'

import { addGroup } from '@/lib/contextMenu/edit'
import { DEFAULT_LAYOUT, type ContextMenuEntryId } from '@/lib/contextMenu/entries'

import { previewAvailable } from '../previewAvailability'
import { visibleRows } from './visibleRows'

const keys = (rows: ReturnType<typeof visibleRows>) => rows.map((row) => row.key)

describe('visibleRows', () => {
  it('lists admin-only entries for admins only', () => {
    const admin = keys(visibleRows(DEFAULT_LAYOUT, { isAdmin: true, open: new Set(), matches: null }))
    const member = keys(visibleRows(DEFAULT_LAYOUT, { isAdmin: false, open: new Set(), matches: null }))
    expect(admin).toContain('e:checkout.forceRelease')
    expect(member).not.toContain('e:checkout.forceRelease')
  })

  it('shows a group’s children only while it is open', () => {
    const closed = keys(visibleRows(DEFAULT_LAYOUT, { isAdmin: true, open: new Set(), matches: null }))
    expect(closed).toContain('g:generate')
    expect(closed).not.toContain('g:generateLocal')
    const open = keys(
      visibleRows(DEFAULT_LAYOUT, { isAdmin: true, open: new Set(['generate', 'generateLocal']), matches: null }),
    )
    expect(open).toContain('e:generate.local.step')
    expect(open).not.toContain('e:generate.server.pdf')
  })

  it('while searching, shows the matches and the groups around them, open', () => {
    const matches = new Set<ContextMenuEntryId>(['generate.local.step'])
    expect(keys(visibleRows(DEFAULT_LAYOUT, { isAdmin: true, open: new Set(), matches }))).toEqual([
      'g:generate',
      'g:generateLocal',
      'e:generate.local.step',
    ])
  })

  it('stands in for an empty group', () => {
    const layout = addGroup(DEFAULT_LAYOUT, { id: 'g-empty001', label: 'Mine', display: 'submenu', at: { parent: [], index: 0 } })
    const rows = visibleRows(layout, { isAdmin: true, open: new Set(['g-empty001']), matches: null })
    expect(rows[1]).toMatchObject({ kind: 'empty', groupPath: [0] })
  })
})

describe('previewAvailable', () => {
  const opts = { isAdmin: false, desktop: true }
  const shown = (kind: Parameters<typeof previewAvailable>[1], state: Parameters<typeof previewAvailable>[2], o = opts) =>
    (['sync.download', 'sync.getLatest', 'sync.firstCheckIn', 'sync.keepLocalOnly', 'checkout.checkOut', 'checkout.checkIn',
      'checkout.discard', 'checkout.forceRelease', 'collab.requestCheckout', 'open.open'] as const).filter((id) =>
      previewAvailable(id, kind, state, o),
    )

  it('follows the registry’s file kinds and the file list surface', () => {
    expect(previewAvailable('generate.local.step', 'part', 'checkedIn', opts)).toBe(true)
    expect(previewAvailable('generate.local.step', 'drawing', 'checkedIn', opts)).toBe(false)
    expect(previewAvailable('fileActions.newFolder', 'folder', 'checkedIn', opts)).toBe(false)
  })

  it('shows the sync and checkout entries of the picked state only', () => {
    expect(shown('part', 'checkedIn')).toEqual(['checkout.checkOut', 'open.open'])
    expect(shown('part', 'mine')).toEqual(['checkout.checkIn', 'checkout.discard', 'open.open'])
    expect(shown('part', 'others')).toEqual(['collab.requestCheckout', 'open.open'])
    expect(shown('part', 'others', { ...opts, isAdmin: true })).toEqual(['checkout.forceRelease', 'collab.requestCheckout', 'open.open'])
    expect(shown('part', 'cloud')).toEqual(['sync.download'])
    expect(shown('part', 'local')).toEqual(['sync.firstCheckIn', 'sync.keepLocalOnly', 'open.open'])
    expect(shown('part', 'outdated')).toEqual(['sync.getLatest', 'open.open'])
  })

  it('leaves out desktop-only entries on the web, and vault entries for a file not checked in', () => {
    expect(previewAvailable('checkout.checkOut', 'part', 'checkedIn', { ...opts, desktop: false })).toBe(false)
    expect(previewAvailable('reviews', 'part', 'local', opts)).toBe(false)
    expect(previewAvailable('reviews', 'part', 'checkedIn', opts)).toBe(true)
  })
})
