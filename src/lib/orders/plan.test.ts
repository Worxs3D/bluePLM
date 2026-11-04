import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('@/lib/supabase/reviews', () => ({
  getLatestCheckedInVersions: vi.fn(),
  getVersionDependencyClosure: vi.fn(),
}))

import type { LatestFileVersion } from '@/lib/supabase/reviews'
import type { LocalFile } from '@/stores/types'
import type { DependencyClosureRow } from '@/types/reviews'

import {
  closureChildLines,
  latestDrawingRefs,
  pickDrawingModel,
  pickModelDrawing,
  planOrderLinesForFiles,
  type DrawingModelRef,
  type ModelDrawingRef,
  type ParentReferenceRow,
  type PlanDeps,
} from './plan'

function local(path: string, id: string | null, isDirectory = false): LocalFile {
  return {
    name: path.split('/').pop()!,
    path: `C:/vault/${path}`,
    relativePath: path,
    isDirectory,
    extension: path.includes('.') ? `.${path.split('.').pop()}` : '',
    size: 1,
    modifiedTime: 'now',
    pdmData: id ? ({ id } as LocalFile['pdmData']) : undefined,
  }
}

function version(fileId: string, path: string, v = 1): LatestFileVersion {
  return {
    fileId,
    fileVersionId: `${fileId}-v${v}`,
    version: v,
    revision: 'A',
    state: null,
    fileName: path.split('/').pop()!,
    filePath: path,
    extension: null,
    vaultId: 'vault',
  }
}

function closureRow(p: Partial<DependencyClosureRow> & { fileId: string; filePath: string }): DependencyClosureRow {
  return {
    depth: 1,
    parentVersionId: 'asm-v1',
    fileVersionId: `${p.fileId}-v1`,
    referencePath: p.filePath,
    configuration: null,
    referenceType: 'component',
    quantity: 1,
    exact: true,
    edgeSource: 'recorded',
    missing: false,
    version: 1,
    revision: 'A',
    contentHash: 'h',
    fileSize: 1,
    fileName: p.filePath.split('/').pop()!,
    extension: null,
    vaultId: 'vault',
    deleted: false,
    ...p,
  } as DependencyClosureRow
}

function deps(overrides: {
  versions: LatestFileVersion[]
  drawingRefs?: DrawingModelRef[]
  modelRefs?: ModelDrawingRef[]
  closures?: Record<string, DependencyClosureRow[]>
}): PlanDeps {
  return {
    latestVersions: async (ids) => overrides.versions.filter((v) => ids.includes(v.fileId)),
    drawingModelRefs: async (ids) => (overrides.drawingRefs ?? []).filter((r) => ids.includes(r.drawingVersionId)),
    modelDrawingRefs: async (ids) => (overrides.modelRefs ?? []).filter((r) => ids.includes(r.modelFileId)),
    closure: async (id) => overrides.closures?.[id] ?? [],
  }
}

describe('planOrderLinesForFiles', () => {
  it('skips folders, unsupported files and files never checked in', async () => {
    const result = await planOrderLinesForFiles(
      [local('Parts', 'folder', true), local('notes.txt', 't'), local('new.sldprt', null), local('gone.sldprt', 'g')],
      {},
      deps({ versions: [] }),
    )
    expect(result.lines).toEqual([])
    expect(result.skipped).toEqual([
      { path: 'Parts', reason: 'folder' },
      { path: 'notes.txt', reason: 'unsupported' },
      { path: 'new.sldprt', reason: 'not-checked-in' },
      { path: 'gone.sldprt', reason: 'not-checked-in' },
    ])
  })

  it('makes a drawing a line for the model it shows, pinned to the version it recorded', async () => {
    const result = await planOrderLinesForFiles(
      [local('A.slddrw', 'drw')],
      {},
      deps({
        versions: [version('drw', 'A.slddrw', 3), version('part', 'A.sldprt', 5)],
        drawingRefs: [
          { drawingVersionId: 'drw-v3', childFileId: 'sheet', childVersionId: 'sheet-v1', childPath: 'Sheet.slddrt', referenceType: 'reference' },
          { drawingVersionId: 'drw-v3', childFileId: 'part', childVersionId: 'part-v4', childPath: 'A.sldprt', referenceType: 'reference' },
        ],
      }),
    )
    expect(result.lines).toEqual([{ fileVersionId: 'part-v4', drawingVersionId: 'drw-v3', outputKinds: ['pdf', 'step'] }])
  })

  it('makes a drawing with no readable model a drawing-only PDF line', async () => {
    const result = await planOrderLinesForFiles(
      [local('A.slddrw', 'drw')],
      {},
      deps({
        versions: [version('drw', 'A.slddrw')],
        drawingRefs: [{ drawingVersionId: 'drw-v1', childFileId: 'hidden', childVersionId: null, childPath: 'A.sldprt', referenceType: 'reference' }],
      }),
    )
    expect(result.lines).toEqual([{ fileVersionId: 'drw-v1', outputKinds: ['pdf'] }])
  })

  it('attaches the only drawing whose latest version references a model', async () => {
    const result = await planOrderLinesForFiles(
      [local('A.sldprt', 'part')],
      {},
      deps({
        versions: [version('part', 'A.sldprt')],
        modelRefs: [{ modelFileId: 'part', drawingFileId: 'drw', drawingVersionId: 'drw-v2', drawingFileName: 'Other.slddrw' }],
      }),
    )
    expect(result.lines).toEqual([{ fileVersionId: 'part-v1', drawingVersionId: 'drw-v2', outputKinds: ['pdf', 'step'] }])
  })

  it('picks the same-named drawing among several, and none when that is ambiguous', async () => {
    const versions = [version('part', 'A.sldprt')]
    const refs = (a: string, b: string): ModelDrawingRef[] => [
      { modelFileId: 'part', drawingFileId: 'd1', drawingVersionId: 'd1-v1', drawingFileName: a },
      { modelFileId: 'part', drawingFileId: 'd2', drawingVersionId: 'd2-v1', drawingFileName: b },
    ]
    const named = await planOrderLinesForFiles([local('A.sldprt', 'part')], {}, deps({ versions, modelRefs: refs('A.slddrw', 'B.slddrw') }))
    expect(named.lines).toEqual([{ fileVersionId: 'part-v1', drawingVersionId: 'd1-v1', outputKinds: ['pdf', 'step'] }])

    const ambiguous = await planOrderLinesForFiles(
      [local('A.sldprt', 'part')],
      {},
      deps({ versions, modelRefs: refs('X.slddrw', 'Y.slddrw') }),
    )
    expect(ambiguous.lines).toEqual([{ fileVersionId: 'part-v1', outputKinds: ['step'] }])
  })

  it('makes one line when a drawing and its model are both selected', async () => {
    const result = await planOrderLinesForFiles(
      [local('A.sldprt', 'part'), local('A.slddrw', 'drw')],
      {},
      deps({
        versions: [version('part', 'A.sldprt'), version('drw', 'A.slddrw')],
        drawingRefs: [{ drawingVersionId: 'drw-v1', childFileId: 'part', childVersionId: null, childPath: 'A.sldprt', referenceType: 'reference' }],
      }),
    )
    expect(result.lines).toEqual([{ fileVersionId: 'part-v1', drawingVersionId: 'drw-v1', outputKinds: ['pdf', 'step'] }])
  })

  it('adds the referenced parts of an assembly at the closure versions', async () => {
    const result = await planOrderLinesForFiles(
      [local('Top.sldasm', 'asm')],
      { withReferencedParts: true },
      deps({
        versions: [version('asm', 'Top.sldasm', 2), version('bolt', 'Bolt.sldprt', 9), version('bd', 'Bolt.slddrw', 1)],
        modelRefs: [{ modelFileId: 'bolt', drawingFileId: 'bd', drawingVersionId: 'bd-v1', drawingFileName: 'Bolt.slddrw' }],
        closures: {
          'asm-v2': [
            closureRow({ depth: 0, fileId: 'asm', fileVersionId: 'asm-v2', filePath: 'Top.sldasm' }),
            closureRow({ fileId: 'bolt', fileVersionId: 'bolt-v7', version: 7, filePath: 'Bolt.sldprt', configuration: 'Default' }),
            closureRow({ fileId: 'plate', filePath: 'Plate.sldprt' }),
            closureRow({ fileId: 'missing', filePath: 'Gone.sldprt', missing: true }),
          ],
        },
      }),
    )
    expect(result.lines).toEqual([
      { fileVersionId: 'asm-v2', outputKinds: ['step'] },
      { fileVersionId: 'bolt-v7', drawingVersionId: 'bd-v1', outputKinds: ['pdf', 'step'] },
      { fileVersionId: 'plate-v1', outputKinds: ['step'] },
    ])
  })

  it('leaves the closure out without the option', async () => {
    const closure = vi.fn(async () => [])
    const d = { ...deps({ versions: [version('asm', 'Top.sldasm')] }), closure }
    const result = await planOrderLinesForFiles([local('Top.sldasm', 'asm')], {}, d)
    expect(result.lines).toEqual([{ fileVersionId: 'asm-v1', outputKinds: ['step'] }])
    expect(closure).not.toHaveBeenCalled()
  })
})

describe('closureChildLines', () => {
  it('orders a part referenced in one configuration in its saved one, and splits several', () => {
    const lines = closureChildLines([
      [
        closureRow({ fileId: 'p', filePath: 'P.sldprt', configuration: 'Default' }),
        closureRow({ fileId: 'q', filePath: 'Q.sldprt', configuration: 'Short' }),
        closureRow({ fileId: 'q', filePath: 'Q.sldprt', configuration: 'Long' }),
      ],
    ])
    expect(lines.map((l) => [l.fileId, l.configuration])).toEqual([
      ['p', null],
      ['q', 'Long'],
      ['q', 'Short'],
    ])
  })

  it('pins the newer version when two closures disagree, and skips drawings and deleted rows', () => {
    const lines = closureChildLines([
      [closureRow({ fileId: 'p', fileVersionId: 'p-v2', version: 2, filePath: 'P.sldprt' })],
      [
        closureRow({ fileId: 'p', fileVersionId: 'p-v3', version: 3, filePath: 'P.sldprt' }),
        closureRow({ fileId: 'd', filePath: 'P.slddrw' }),
        closureRow({ fileId: 'x', filePath: 'X.sldprt', deleted: true }),
      ],
    ])
    expect(lines.map((l) => l.fileVersionId)).toEqual(['p-v3'])
  })
})

describe('latestDrawingRefs', () => {
  const row = (p: Partial<ParentReferenceRow> & { parent_file_id: string }): ParentReferenceRow => ({
    child_file_id: 'part',
    parent_version_id: `${p.parent_file_id}-v2`,
    parent: { file_name: `${p.parent_file_id}.SLDDRW`, file_path: null, extension: '.slddrw', version: 2, deleted_at: null },
    parent_version: { version: 2 },
    ...p,
  })

  it('keeps only live drawings at their latest version', () => {
    const refs = latestDrawingRefs([
      row({ parent_file_id: 'drw' }),
      // An older version of a drawing that no longer references the part.
      row({ parent_file_id: 'old', parent_version_id: 'old-v1', parent_version: { version: 1 } }),
      // An assembly parent.
      row({
        parent_file_id: 'asm',
        parent: { file_name: 'Top.SLDASM', file_path: null, extension: '.sldasm', version: 2, deleted_at: null },
      }),
      row({
        parent_file_id: 'gone',
        parent: { file_name: 'Gone.SLDDRW', file_path: null, extension: '.slddrw', version: 2, deleted_at: 'yesterday' },
      }),
      // The same drawing twice (two configurations referenced) is one candidate.
      row({ parent_file_id: 'drw' }),
    ])
    expect(refs).toEqual([{ modelFileId: 'part', drawingFileId: 'drw', drawingVersionId: 'drw-v2', drawingFileName: 'drw.SLDDRW' }])
  })
})

describe('pickDrawingModel / pickModelDrawing', () => {
  it('prefers a reference edge to a part or assembly', () => {
    const refs: DrawingModelRef[] = [
      { drawingVersionId: 'd', childFileId: 'c', childVersionId: null, childPath: 'Comp.sldprt', referenceType: 'component' },
      { drawingVersionId: 'd', childFileId: 'm', childVersionId: null, childPath: 'Model.sldasm', referenceType: 'reference' },
    ]
    expect(pickDrawingModel(refs)?.childFileId).toBe('m')
    expect(pickDrawingModel([])).toBeNull()
  })

  it('takes the only drawing, else the only one with the base name', () => {
    expect(pickModelDrawing('A.sldprt', [{ fileId: 'd', fileName: 'Z.slddrw', fileVersionId: 'd1' }])).toBe('d1')
    expect(
      pickModelDrawing('dir/a.SLDPRT', [
        { fileId: 'd', fileName: 'A.slddrw', fileVersionId: 'd1' },
        { fileId: 'e', fileName: 'B.slddrw', fileVersionId: 'e1' },
      ]),
    ).toBe('d1')
    expect(pickModelDrawing('A.sldprt', [])).toBeNull()
  })
})
