import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionOutput } from '@/types/versionOutputs'
import type { ChildPreviewTarget } from '@/features/source/outputs/preview/childPreviewModel'

import {
  NOTHING_FOLLOWED,
  childRows,
  diffPopoutUi,
  findFileForNavigation,
  followSelection,
  popoutStorePatch,
  popoutTabOf,
  samePopoutState,
  type PopoutState,
  type PopoutUi,
} from './panelPopout'

const file = (path: string, extension: string, isDirectory = false): LocalFile => ({
  name: path,
  path,
  relativePath: `rel/${path}`,
  isDirectory,
  extension,
  size: 1,
  modifiedTime: '2026-11-03T00:00:00Z',
})

const output = { id: 'o1', fileVersionId: 'v1' } as unknown as VersionOutput
const outputChild: ChildPreviewTarget = {
  kind: 'output',
  filePath: 'b.sldprt',
  fileId: 'f-b',
  version: 2,
  output,
}
const report = { id: 'r1' } as unknown as InspectionReport
const reportChild: ChildPreviewTarget = {
  kind: 'report',
  filePath: 'a.slddrw',
  fileId: 'f-a',
  version: 1,
  report,
}

describe('followSelection', () => {
  const files = [
    file('a.slddrw', '.SLDDRW'),
    file('b.sldprt', '.sldprt'),
    file('c.slddrw', '.slddrw'),
    file('dir', '', true),
  ]

  it('Inspection follows the single selected drawing only', () => {
    const prev = { path: 'a.slddrw', child: null }
    expect(followSelection('inspection', ['c.slddrw'], files, null, prev).path).toBe('c.slddrw')
    expect(followSelection('inspection', ['b.sldprt'], files, null, prev)).toBe(prev)
    expect(followSelection('inspection', ['dir'], files, null, prev)).toBe(prev)
  })

  it('other tabs follow any single selection, and keep the last one otherwise', () => {
    const prev = { path: 'a.slddrw', child: null }
    expect(followSelection('vendors', ['b.sldprt'], files, null, prev).path).toBe('b.sldprt')
    expect(followSelection('properties', ['dir'], files, null, prev).path).toBe('dir')
    expect(followSelection('whereused', [], files, null, prev)).toBe(prev)
    expect(followSelection('whereused', ['a.slddrw', 'b.sldprt'], files, null, prev)).toBe(prev)
    expect(followSelection('preview', ['gone'], files, null, NOTHING_FOLLOWED)).toBe(
      NOTHING_FOLLOWED,
    )
  })

  it('Preview carries the child row selected under the file, only while it is anchored', () => {
    const selected = ['b.sldprt']
    const anchored = { target: outputChild, anchor: selected }
    expect(followSelection('preview', selected, files, anchored, NOTHING_FOLLOWED)).toEqual({
      path: 'b.sldprt',
      child: outputChild,
    })
    // A new selection array (a click on the file itself) drops the child.
    expect(followSelection('preview', ['b.sldprt'], files, anchored, NOTHING_FOLLOWED)).toEqual({
      path: 'b.sldprt',
      child: null,
    })
    // Other tabs never carry it.
    expect(followSelection('vendors', selected, files, anchored, NOTHING_FOLLOWED).child).toBeNull()
  })

  it('returns the previous object when nothing changed, so the host sends nothing', () => {
    const prev = { path: 'b.sldprt', child: null }
    expect(followSelection('vendors', ['b.sldprt'], files, null, prev)).toBe(prev)
  })
})

describe('childRows and popoutStorePatch', () => {
  const outputs = new Map([['v1', [output]]])
  const reports = new Map([['f-a', [report]]])

  it('sends only the rows behind the followed child', () => {
    expect(childRows(outputChild, outputs, reports)).toEqual({ outputs: [output], reports: [] })
    expect(childRows(reportChild, outputs, reports)).toEqual({ outputs: [], reports: [report] })
    expect(childRows(null, outputs, reports)).toEqual({ outputs: [], reports: [] })
  })

  it('rebuilds a store in which the child is the active selection', () => {
    const f = file('b.sldprt', '.sldprt')
    const patch = popoutStorePatch({
      ...baseState,
      file: f,
      child: outputChild,
      outputs: [output],
    })
    expect(patch.files).toEqual([f])
    expect(patch.selectedFiles).toEqual(['b.sldprt'])
    expect(patch.childSelection?.anchor).toBe(patch.selectedFiles)
    expect(patch.versionOutputs.get('v1')).toEqual([output])
    expect(patch.drawingInspectionReports.size).toBe(0)
  })
})

const ui: PopoutUi = {
  inspectionColumnPrefs: null,
  inspectionShowFilters: false,
  inspectionAutoSync: true,
  inspectionDrawingSync: {},
}

const baseState: PopoutState = {
  file: null,
  child: null,
  outputs: [],
  reports: [],
  user: null,
  organization: null,
  ui,
}

describe('diffPopoutUi and samePopoutState', () => {
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

  it('compares states by reference', () => {
    expect(samePopoutState(baseState, { ...baseState, ui: { ...ui } })).toBe(true)
    expect(samePopoutState(baseState, { ...baseState, outputs: [] })).toBe(false)
    expect(samePopoutState(baseState, { ...baseState, child: reportChild })).toBe(false)
  })
})

it('recognises a popped-out tab window from its data', () => {
  expect(popoutTabOf({ panel: 'inspection' })).toBe('inspection')
  expect(popoutTabOf({ panel: 'preview' })).toBe('preview')
  expect(popoutTabOf({ panel: 'other' })).toBeNull()
  expect(popoutTabOf(undefined)).toBeNull()
})

it('finds the file a Where Used row names by full or relative path, in any case', () => {
  const files = [file('C:/v/A.sldasm', '.sldasm')]
  expect(findFileForNavigation(files, 'c:/v/a.SLDASM')?.path).toBe('C:/v/A.sldasm')
  expect(findFileForNavigation(files, 'REL/C:/v/A.sldasm')?.path).toBe('C:/v/A.sldasm')
  expect(findFileForNavigation(files, 'nope')).toBeNull()
})
