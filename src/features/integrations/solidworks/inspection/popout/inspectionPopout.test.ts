import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'

import {
  diffPopoutUi,
  followedDrawingPath,
  isInspectionPopoutData,
  type PopoutUi,
} from './inspectionPopout'

const file = (path: string, extension: string): LocalFile => ({
  name: path,
  path,
  relativePath: path,
  isDirectory: false,
  extension,
  size: 1,
  modifiedTime: '2026-11-03T00:00:00Z',
})

describe('followedDrawingPath', () => {
  const files = [
    file('a.slddrw', '.SLDDRW'),
    file('b.sldprt', '.sldprt'),
    file('c.slddrw', '.slddrw'),
  ]

  it('follows the single selected drawing', () => {
    expect(followedDrawingPath(['c.slddrw'], files, 'a.slddrw')).toBe('c.slddrw')
    expect(followedDrawingPath(['a.slddrw'], files, null)).toBe('a.slddrw')
  })

  it('keeps the previous drawing when the selection is not one drawing', () => {
    expect(followedDrawingPath(['b.sldprt'], files, 'a.slddrw')).toBe('a.slddrw')
    expect(followedDrawingPath(['a.slddrw', 'c.slddrw'], files, 'c.slddrw')).toBe('c.slddrw')
    expect(followedDrawingPath([], files, null)).toBeNull()
  })
})

describe('diffPopoutUi', () => {
  const ui: PopoutUi = {
    inspectionColumnPrefs: null,
    inspectionShowFilters: false,
    inspectionAutoSync: true,
    inspectionDrawingSync: {},
  }

  it('sends only what changed, by reference', () => {
    expect(diffPopoutUi(ui, { ...ui })).toEqual({})
    const stamps = { f: { extractHash: 'h', balloonHash: null, serviceVersion: null, at: 1 } }
    expect(
      diffPopoutUi(ui, { ...ui, inspectionAutoSync: false, inspectionDrawingSync: stamps }),
    ).toEqual({
      inspectionAutoSync: false,
      inspectionDrawingSync: stamps,
    })
  })
})

it('recognises the popped-out Inspection window data', () => {
  expect(isInspectionPopoutData({ panel: 'inspection' })).toBe(true)
  expect(isInspectionPopoutData({ panel: 'other' })).toBe(false)
  expect(isInspectionPopoutData(undefined)).toBe(false)
})
