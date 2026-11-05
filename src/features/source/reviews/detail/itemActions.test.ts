import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'

import { canCheckOut } from './itemActions'

const file = (patch: Partial<LocalFile> = {}, checkedOutBy: string | null = null): LocalFile =>
  ({
    name: 'PMP-2001.SLDDRW',
    path: 'C:\vault\PMP-2001.SLDDRW',
    relativePath: 'PMP-2001.SLDDRW',
    isDirectory: false,
    extension: '.slddrw',
    size: 1,
    modifiedTime: '2026-11-01T00:00:00Z',
    pdmData: { id: 'f1', checked_out_by: checkedOutBy },
    ...patch,
  }) as unknown as LocalFile

describe('Check out from a review', () => {
  it('is offered on a downloaded file nobody holds, in the desktop app', () => {
    expect(canCheckOut(file(), true)).toBe(true)
  })

  it('is never offered on the web, on a cloud-only row, a held file or a missing one', () => {
    expect(canCheckOut(file(), false)).toBe(false)
    expect(canCheckOut(file({ diffStatus: 'cloud' }), true)).toBe(false)
    expect(canCheckOut(file({}, 'someone'), true)).toBe(false)
    expect(canCheckOut(null, true)).toBe(false)
  })
})
