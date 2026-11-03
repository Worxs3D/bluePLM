import { describe, expect, it } from 'vitest'

import { versionOutputStrings } from '@/lib/i18n/locales/versionOutputs'
import type { LocalFile } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'
import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionedOutput } from '@/types/versionOutputs'

import type { ConfigWithDepth } from '../../types'
import { buildVirtualRows, SECTION_DRAWINGS, SECTION_USED_IN, type BuildVirtualRowsOptions } from './buildVirtualRows'
import {
  fileSectionExpanded,
  fileSectionKey,
  fileSectionLabelKey,
  uniqueParents,
} from './fileSections'
import { assembliesUsingModel, modelSectionsToLoad } from './modelSectionsToLoad'
import type { VirtualRow } from './rowTypes'

function file(path: string, id: string | null, version = 3): LocalFile {
  return {
    name: path,
    path,
    relativePath: path,
    isDirectory: false,
    extension: path.slice(path.lastIndexOf('.')).toLowerCase(),
    size: 0,
    modifiedTime: '',
    pdmData: id ? { id, version } : undefined,
  } as unknown as LocalFile
}

function item(id: string, path: string, type: DrawingRefItem['file_type'], configuration: string | null = null) {
  return {
    id: `ref-${id}-${configuration ?? ''}`,
    file_id: id,
    file_path: path,
    file_name: path,
    file_type: type,
    configuration,
    in_database: true,
  } as DrawingRefItem
}

function out(fileId: string, kind: VersionedOutput['kind'], version: number): VersionedOutput {
  return {
    id: `${fileId}-${kind}-${version}`,
    kind,
    fileId,
    fileVersionId: `${fileId}v${version}`,
    version,
    configuration: null,
    storageHash: 'a'.repeat(64),
    fileSize: 1,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: '2026-11-03T00:00:00Z',
  }
}

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

const shape = (rows: VirtualRow[]) =>
  rows.map((r) =>
    r.type === 'file-section'
      ? `section:${r.section}`
      : r.type === 'config-drawing'
        ? `${r.configName === SECTION_DRAWINGS ? 'drawing' : r.configName === SECTION_USED_IN ? 'used-in' : 'config-drawing'}:${r.item.file_path}`
        : r.type === 'file-output'
          ? `output:${r.entry.kind}`
          : r.type === 'drawing-report'
            ? `${r.received ? 'received' : 'report'}:${r.report.id}`
            : r.type,
  )

describe('fileSections', () => {
  it('opens every section by default except Used in, and flips on a toggle', () => {
    const none = new Set<string>()
    expect(fileSectionExpanded(none, 'p.sldprt', 'exports')).toBe(true)
    expect(fileSectionExpanded(none, 'p.sldprt', 'usedIn')).toBe(false)
    const flipped = new Set([fileSectionKey('p.sldprt', 'exports'), fileSectionKey('p.sldprt', 'usedIn')])
    expect(fileSectionExpanded(flipped, 'p.sldprt', 'exports')).toBe(false)
    expect(fileSectionExpanded(flipped, 'p.sldprt', 'usedIn')).toBe(true)
    expect(fileSectionExpanded(flipped, 'q.sldprt', 'exports')).toBe(true)
  })

  it('names a drawing models section Parent, or Parents for more than one', () => {
    const name = (count: number | null) =>
      versionOutputStrings[fileSectionLabelKey('parents', count).replace('source.outputs.', '')]
    expect(name(1)).toBe('Parent')
    expect(name(2)).toBe('Parents')
    expect(name(null)).toBe('Parents')
  })

  it('has an English name for every section', () => {
    for (const section of ['configurations', 'drawings', 'usedIn', 'exports', 'reports', 'received'] as const) {
      expect(versionOutputStrings[fileSectionLabelKey(section).replace('source.outputs.', '')]).toBeTruthy()
    }
  })

  it('lists each referencing file once, merging its configurations', () => {
    const merged = uniqueParents([
      item('d2', 'z.slddrw', 'drawing', 'Long'),
      item('d1', 'a.slddrw', 'drawing', 'Default'),
      item('d1', 'a.slddrw', 'drawing', 'Long'),
    ])
    expect(merged.map((m) => [m.file_path, m.configurations])).toEqual([
      ['a.slddrw', ['Default', 'Long']],
      ['z.slddrw', ['Long']],
    ])
  })
})

describe('chevron sections', () => {
  const p = file('p.sldprt', 'p1', 2)
  const d = file('d.slddrw', 'dw1', 1)
  const configs = [{ name: 'Default', depth: 0 }] as unknown as ConfigWithDepth[]
  const outputs = (over: Partial<NonNullable<BuildVirtualRowsOptions['outputs']>> = {}) => ({
    versions: new Map(),
    heads: new Map([['p1', [out('p1', 'step', 2)]]]),
    jobs: new Map(),
    canGenerate: false,
    ...over,
  })

  it('orders a part: Configurations, Drawings, Used in, Exports; drawings in the vault are selectable', () => {
    const { rows, selectableRows } = buildVirtualRows(
      options({
        displayFiles: [p, d],
        files: [p, d],
        expandedConfigFiles: new Set([p.path]),
        fileConfigurations: new Map([[p.path, configs]]),
        outputs: outputs(),
        sections: {
          toggles: new Set(),
          modelDrawings: new Map([['p1', [item('dw1', 'd.slddrw', 'drawing')]]]),
          usedIn: new Map([['p1', [item('a1', 'top.sldasm', 'assembly')]]]),
        },
      }),
    )
    expect(shape(rows)).toEqual([
      'file',
      'section:configurations',
      'config',
      'section:drawings',
      'drawing:d.slddrw',
      'section:usedIn',
      'section:exports',
      'output:step',
      'file',
    ])
    expect(selectableRows.map((r) => r.path)).toEqual(['p.sldprt', 'd.slddrw', 'd.slddrw'])
  })

  it('hides empty sections, a closed section keeps its header only', () => {
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [p],
        files: [p],
        expandedConfigFiles: new Set([p.path]),
        fileConfigurations: new Map([[p.path, configs]]),
        outputs: outputs(),
        sections: {
          toggles: new Set([fileSectionKey(p.path, 'configurations'), fileSectionKey(p.path, 'usedIn')]),
          modelDrawings: new Map([['p1', []]]),
          usedIn: new Map([['p1', [item('a1', 'top.sldasm', 'assembly')]]]),
        },
      }),
    )
    expect(shape(rows)).toEqual([
      'file',
      'section:configurations',
      'section:usedIn',
      'used-in:top.sldasm',
      'section:exports',
      'output:step',
    ])
  })

  it('keeps an opened Used in with nothing in it, and shows it loading until read', () => {
    const open = new Set([fileSectionKey(p.path, 'usedIn')])
    const build = (usedIn: Map<string, DrawingRefItem[]>, toggles: Set<string>) =>
      buildVirtualRows(
        options({
          displayFiles: [p],
          expandedConfigFiles: new Set([p.path]),
          fileConfigurations: new Map([[p.path, []]]),
          sections: { toggles, modelDrawings: new Map([['p1', []]]), usedIn },
        }),
      ).rows.flatMap((r) => (r.type === 'file-section' ? [[r.section, r.count, r.isLoading]] : []))
    expect(build(new Map(), open)).toEqual([['usedIn', null, true]])
    expect(build(new Map([['p1', []]]), open)).toEqual([['usedIn', 0, false]])
    expect(build(new Map([['p1', []]]), new Set())).toEqual([])
  })

  it('orders a drawing: models, Exports (PDF, DXF, STEP, Generate…), reports, received', () => {
    const returned = {
      id: 'r0',
      fileId: 'dw1',
      fileVersionId: 'dw1v1',
      reportNumber: 'r0',
      status: 'returned',
      returnedHash: 'b'.repeat(64),
      returnedAt: '2026-11-02T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z',
      createdAt: '2026-11-01T00:00:00Z',
    } as InspectionReport
    const newer = { ...returned, id: 'r1', returnedHash: null, returnedAt: null, supersedesReportId: 'r0' } as InspectionReport
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [d],
        files: [d],
        expandedDrawingRefs: new Set([d.path]),
        drawingRefData: new Map([[d.path, [item('p1', 'p.sldprt', 'part')]]]),
        drawingInspectionReports: new Map([['dw1', [newer, returned]]]),
        outputs: outputs({
          heads: new Map([['dw1', [out('dw1', 'pdf', 1), out('dw1', 'step', 1), out('dw1', 'dxf', 1)]]]),
          canGenerate: true,
        }),
      }),
    )
    expect(shape(rows)).toEqual([
      'file',
      'section:parents',
      'drawing-ref',
      'section:exports',
      'output:pdf',
      'output:dxf',
      'output:step',
      'section:reports',
      'report:r1',
      'section:received',
      'received:r0',
    ])
    const parents = rows[1]
    expect(parents.type === 'file-section' && parents.count).toBe(1)
  })

  it('lists the released export first, the newer work in progress after it, stale only on the newest', () => {
    const d4 = file('d.slddrw', 'dw1', 4)
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [d4],
        expandedDrawingRefs: new Set([d4.path]),
        drawingRefData: new Map([[d4.path, []]]),
        outputs: outputs({
          heads: new Map([['dw1', [out('dw1', 'pdf', 3)]]]),
          releases: new Map([
            [
              'dw1',
              [
                {
                  fileId: 'dw1',
                  fileVersionId: 'dw1v2',
                  version: 2,
                  revision: 'B',
                  releasedAt: '2026-11-01T00:00:00Z',
                  releasedBy: null,
                  forced: false,
                  reviewId: null,
                  note: null,
                },
              ],
            ],
          ]),
          versionOutputs: new Map([['dw1v2', [out('dw1', 'pdf', 2)]]]),
        }),
      }),
    )
    const outs = rows.flatMap((r) =>
      r.type === 'file-output' ? [[r.version, r.entry.released?.revision ?? null, r.entry.secondary, r.entry.stale]] : [],
    )
    expect(outs).toEqual([
      [2, 'B', false, false],
      [3, null, true, true],
    ])
  })
})

describe('modelSectionsToLoad', () => {
  const p = file('p.sldprt', 'p1')
  const d = file('d.slddrw', 'd1')
  const none = { drawings: new Set<string>(), usedIn: new Set<string>() }

  it('reads drawings of a newly expanded model, and Used in only once opened', () => {
    const expanded = new Set([p.path, d.path])
    expect(modelSectionsToLoad([p, d], expanded, new Set(), new Set(), new Map(), new Map(), none)).toEqual({
      drawings: ['p1'],
      usedIn: [],
    })
    const open = new Set([fileSectionKey(p.path, 'usedIn')])
    expect(modelSectionsToLoad([p], expanded, expanded, open, new Map([['p1', []]]), new Map(), none)).toEqual({
      drawings: [],
      usedIn: ['p1'],
    })
    expect(
      modelSectionsToLoad([p], expanded, expanded, open, new Map([['p1', []]]), new Map([['p1', []]]), {
        drawings: new Set(),
        usedIn: new Set(['p1']),
      }),
    ).toEqual({ drawings: [], usedIn: [] })
  })

  it('keeps the assemblies of the where-used rows, one each', () => {
    const parent = (id: string, name: string) => ({
      id,
      file_name: name,
      file_path: name,
      part_number: null,
      revision: null,
      state: null,
    })
    const items = assembliesUsingModel([
      { id: 'r1', configuration: 'A', parent: parent('a1', 'top.sldasm') },
      { id: 'r2', configuration: 'B', parent: parent('a1', 'top.sldasm') },
      { id: 'r3', parent: parent('d1', 'p.slddrw') },
      { id: 'r4', parent: null },
    ])
    expect(items.map((i) => [i.file_id, i.file_type, i.configurations])).toEqual([['a1', 'assembly', ['A', 'B']]])
  })
})
