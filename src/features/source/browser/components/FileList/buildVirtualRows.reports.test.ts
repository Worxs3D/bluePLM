import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'
import type { InspectionReport } from '@/types/inspectionReports'

import { drawingIdsToLoad } from '../../hooks/drawingReportsToLoad'
import { buildVirtualRows, MAX_DRAWING_REPORT_ROWS, type BuildVirtualRowsOptions } from './buildVirtualRows'

function drawing(path: string, id: string | null): LocalFile {
  return {
    name: path,
    path,
    relativePath: path,
    isDirectory: false,
    extension: '.slddrw',
    size: 0,
    modifiedTime: '',
    pdmData: id ? { id } : undefined,
  } as unknown as LocalFile
}

function report(id: string): InspectionReport {
  return { id, fileId: 'd1', fileVersionId: 'v1', reportNumber: id, status: 'issued' } as InspectionReport
}

const ref = { id: 'ref1', file_path: 'part.sldprt', file_name: 'part.sldprt', file_type: 'part' } as DrawingRefItem

function options(over: Partial<BuildVirtualRowsOptions>): BuildVirtualRowsOptions {
  const empty = new Set<string>()
  return {
    displayFiles: [],
    files: [],
    isCreatingFolder: false,
    selectedFiles: [],
    clipboard: null,
    dragOverFolder: null,
    userId: undefined,
    isBeingProcessed: () => false,
    expandedConfigFiles: empty,
    fileConfigurations: new Map(),
    selectedConfigs: empty,
    expandedConfigSections: empty,
    expandedConfigDrawings: empty,
    configDrawingData: new Map(),
    loadingConfigDrawings: empty,
    expandedConfigBoms: empty,
    configBomData: new Map(),
    loadingConfigBoms: empty,
    expandedDrawingRefs: empty,
    drawingRefData: new Map(),
    expandedDrawingRefFiles: empty,
    ...over,
  }
}

describe('drawing report rows', () => {
  it('lists reports after the referenced files of an expanded drawing', () => {
    const file = drawing('a.slddrw', 'd1')
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [file],
        files: [file],
        expandedDrawingRefs: new Set([file.path]),
        drawingRefData: new Map([[file.path, [ref]]]),
        drawingInspectionReports: new Map([['d1', [report('r1'), report('r2')]]]),
      }),
    )
    // Each group sits under its section header: the drawing's models, then its reports.
    expect(rows.map((r) => r.type)).toEqual([
      'file',
      'file-section',
      'drawing-ref',
      'file-section',
      'drawing-report',
      'drawing-report',
    ])
  })

  it('shows reports of a drawing with no references', () => {
    const file = drawing('a.slddrw', 'd1')
    const { rows, selectableRows } = buildVirtualRows(
      options({
        displayFiles: [file],
        expandedDrawingRefs: new Set([file.path]),
        drawingRefData: new Map([[file.path, []]]),
        drawingInspectionReports: new Map([['d1', [report('r1')]]]),
      }),
    )
    // No models: that section is not shown.
    expect(rows.map((r) => r.type)).toEqual(['file', 'file-section', 'drawing-report'])
    expect(selectableRows).toHaveLength(1)
  })

  it('lists a regenerated report in place of the one it supersedes', () => {
    const file = drawing('a.slddrw', 'd1')
    const regenerated = { ...report('r2'), supersedesReportId: 'r1' } as InspectionReport
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [file],
        files: [file],
        expandedDrawingRefs: new Set([file.path]),
        drawingInspectionReports: new Map([['d1', [regenerated, report('r1'), report('copy')]]]),
      }),
    )
    const listed = rows.flatMap((r) => (r.type === 'drawing-report' ? [r.report.id] : []))
    expect(listed).toEqual(['r2', 'copy'])
  })

  it('caps the list with a "more" row', () => {
    const file = drawing('a.slddrw', 'd1')
    const many = Array.from({ length: MAX_DRAWING_REPORT_ROWS + 3 }, (_, i) => report(`r${i}`))
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [file],
        expandedDrawingRefs: new Set([file.path]),
        drawingInspectionReports: new Map([['d1', many]]),
      }),
    )
    expect(rows.filter((r) => r.type === 'drawing-report')).toHaveLength(MAX_DRAWING_REPORT_ROWS)
    const more = rows[rows.length - 1]
    expect(more.type === 'drawing-report-more' && more.hiddenCount).toBe(3)
  })

  it('lists nothing for a collapsed drawing', () => {
    const file = drawing('a.slddrw', 'd1')
    const { rows } = buildVirtualRows(
      options({ displayFiles: [file], drawingInspectionReports: new Map([['d1', [report('r1')]]]) }),
    )
    expect(rows.map((r) => r.type)).toEqual(['file'])
  })
})

describe('drawingIdsToLoad', () => {
  const a = drawing('a.slddrw', 'd1')
  const b = drawing('b.slddrw', 'd2')
  const local = drawing('c.slddrw', null)

  it('loads newly expanded or never-loaded drawings with an id', () => {
    const expanded = new Set([a.path, b.path, local.path])
    expect(drawingIdsToLoad([a, b, local], expanded, new Set(), new Map(), new Set())).toEqual(['d1', 'd2'])
    // b stays expanded and is loaded: not read again; a was just re-expanded: read again.
    expect(drawingIdsToLoad([a, b], expanded, new Set([b.path]), new Map([['d1', []], ['d2', []]]), new Set())).toEqual(
      ['d1'],
    )
  })

  it('skips drawings already being loaded', () => {
    expect(drawingIdsToLoad([a], new Set([a.path]), new Set(), new Map(), new Set(['d1']))).toEqual([])
  })
})
