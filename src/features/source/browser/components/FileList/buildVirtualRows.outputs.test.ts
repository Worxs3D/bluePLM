import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'
import { outputJobKey, type OutputJob } from '@/stores/slices/outputsSlice'
import type { DrawingRefItem } from '@/stores/types'
import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionOutput } from '@/types/versionOutputs'

import type { ConfigWithDepth } from '../../types'
import { buildVirtualRows, type BuildVirtualRowsOptions } from './buildVirtualRows'

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

function pdf(fileId: string, fileVersionId: string): VersionOutput {
  return {
    id: `${fileVersionId}-pdf`,
    kind: 'pdf',
    fileId,
    fileVersionId,
    configuration: null,
    storageHash: 'a'.repeat(64),
    fileSize: 1,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: '2026-11-03T00:00:00Z',
  }
}

const ref = { id: 'ref1', file_path: 'part.sldprt', file_name: 'part.sldprt', file_type: 'part' } as DrawingRefItem
const report = { id: 'r1', fileId: 'd1', fileVersionId: 'dv3', reportNumber: 'r1', status: 'issued' } as InspectionReport

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

describe('output rows', () => {
  it('lists a drawing PDF after the referenced files and before the inspection reports', () => {
    const d = file('a.slddrw', 'd1')
    const { rows, selectableRows } = buildVirtualRows(
      options({
        displayFiles: [d],
        files: [d],
        expandedDrawingRefs: new Set([d.path]),
        drawingRefData: new Map([[d.path, [ref]]]),
        drawingInspectionReports: new Map([['d1', [report]]]),
        outputs: {
          versions: new Map([['d1', { version: 3, fileVersionId: 'dv3' }]]),
          byVersion: new Map([['dv3', [pdf('d1', 'dv3')]]]),
          jobs: new Map(),
          canGenerate: false,
        },
      }),
    )
    expect(rows.map((r) => r.type)).toEqual(['file', 'drawing-ref', 'file-output', 'drawing-report'])
    const out = rows[2]
    expect(out.type === 'file-output' && [out.entry.state, out.version]).toEqual(['ready', 3])
    // Output rows are not selectable files.
    expect(selectableRows).toHaveLength(1)
  })

  it('lists a part STEP ghost after its configurations', () => {
    const p = file('p.sldprt', 'p1', 2)
    const configs = [{ name: 'Default', depth: 0 }] as unknown as ConfigWithDepth[]
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [p],
        files: [p],
        expandedConfigFiles: new Set([p.path]),
        fileConfigurations: new Map([[p.path, configs]]),
        outputs: {
          versions: new Map([['p1', { version: 2, fileVersionId: 'pv2' }]]),
          byVersion: new Map([['pv2', []]]),
          jobs: new Map(),
          canGenerate: true,
        },
      }),
    )
    expect(rows.map((r) => r.type)).toEqual(['file', 'config', 'file-output'])
    const out = rows[2]
    expect(out.type === 'file-output' && [out.entry.kind, out.entry.state]).toEqual(['step', 'missing'])
  })

  it('shows a queued job before the version is resolved, and nothing stale after a new check-in', () => {
    const d = file('a.slddrw', 'd1', 4)
    const queued: OutputJob = {
      key: outputJobKey('d1', 'pdf', null),
      fileId: 'd1',
      fileVersionId: null,
      kind: 'pdf',
      configuration: null,
      fileName: 'a.slddrw',
      status: 'queued',
      detail: null,
      auto: true,
      updatedAt: 0,
    }
    const base = {
      displayFiles: [d],
      files: [d],
      expandedDrawingRefs: new Set([d.path]),
    }
    const { rows } = buildVirtualRows(
      options({
        ...base,
        outputs: {
          // Version 3 is what was resolved; the file is now at 4, so v3's PDF is not shown.
          versions: new Map([['d1', { version: 3, fileVersionId: 'dv3' }]]),
          byVersion: new Map([['dv3', [pdf('d1', 'dv3')]]]),
          jobs: new Map([[queued.key, queued]]),
          canGenerate: true,
        },
      }),
    )
    const outs = rows.filter((r) => r.type === 'file-output')
    expect(outs).toHaveLength(1)
    expect(outs[0].type === 'file-output' && [outs[0].entry.state, outs[0].entry.output]).toEqual(['queued', null])
  })

  it('lists nothing for a collapsed file', () => {
    const d = file('a.slddrw', 'd1')
    const { rows } = buildVirtualRows(
      options({
        displayFiles: [d],
        outputs: {
          versions: new Map([['d1', { version: 3, fileVersionId: 'dv3' }]]),
          byVersion: new Map([['dv3', [pdf('d1', 'dv3')]]]),
          jobs: new Map(),
          canGenerate: true,
        },
      }),
    )
    expect(rows.map((r) => r.type)).toEqual(['file'])
  })
})
