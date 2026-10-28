import { describe, expect, it } from 'vitest'

import type { DependencyClosureRow } from '@/types/reviews'

import { groupByContentHash, mergeClosures } from './closure'

function row(partial: Partial<DependencyClosureRow>): DependencyClosureRow {
  return {
    depth: 1,
    parentVersionId: 'root-v',
    fileId: 'f',
    fileVersionId: 'v',
    referencePath: null,
    configuration: null,
    referenceType: 'reference',
    quantity: 1,
    exact: true,
    edgeSource: 'recorded',
    missing: false,
    version: 1,
    revision: 'A',
    contentHash: 'h',
    fileSize: 10,
    fileName: null,
    filePath: 'x.sldprt',
    extension: '.sldprt',
    vaultId: 'vault',
    deleted: false,
    ...partial,
  }
}

const drawingA = row({
  depth: 0,
  parentVersionId: null,
  fileId: 'dA',
  fileVersionId: 'dA-3',
  filePath: 'Drawings/A.SLDDRW',
  contentHash: 'hdA',
  version: 3,
  edgeSource: 'root',
})
const drawingB = row({
  depth: 0,
  parentVersionId: null,
  fileId: 'dB',
  fileVersionId: 'dB-1',
  filePath: 'Drawings/B.SLDDRW',
  contentHash: 'hdB',
  version: 1,
  edgeSource: 'root',
})

describe('mergeClosures', () => {
  it('lists a version reached by two items once, exact when any edge was exact', () => {
    const part = {
      fileId: 'p',
      fileVersionId: 'p-2',
      filePath: 'Parts/P.SLDPRT',
      contentHash: 'hp',
    }
    const merged = mergeClosures([
      [drawingA, row({ ...part, parentVersionId: 'dA-3', exact: false })],
      [drawingB, row({ ...part, parentVersionId: 'dB-1', exact: true })],
    ])
    expect(merged.files.map((f) => f.fileVersionId)).toEqual(['dA-3', 'dB-1', 'p-2'])
    const p = merged.files.find((f) => f.fileVersionId === 'p-2')!
    expect(p.exact).toBe(true)
    expect(p.isRoot).toBe(false)
    expect(merged.exact).toBe(true)
    expect(merged.totalBytes).toBe(30)
  })

  it('marks the package approximate when a version was only reached approximately', () => {
    const merged = mergeClosures([
      [drawingA, row({ fileVersionId: 'p-2', filePath: 'P.sldprt', exact: false })],
    ])
    expect(merged.exact).toBe(false)
  })

  it('keeps one version per path: review item first, then exact, then higher version', () => {
    const merged = mergeClosures([
      [
        drawingA,
        row({
          fileId: 'p',
          fileVersionId: 'p-5',
          filePath: 'Parts/P.sldprt',
          version: 5,
          exact: false,
        }),
      ],
      [
        drawingB,
        row({
          fileId: 'p',
          fileVersionId: 'p-4',
          filePath: 'parts\\p.SLDPRT',
          version: 4,
          exact: true,
        }),
      ],
    ])
    const kept = merged.files.filter((f) => f.fileId === 'p')
    expect(kept.map((f) => f.fileVersionId)).toEqual(['p-4'])
    expect(merged.conflicts).toEqual([
      {
        filePath: 'parts/p.SLDPRT',
        keptFileVersionId: 'p-4',
        keptVersion: 4,
        droppedFileVersionId: 'p-5',
        droppedVersion: 5,
      },
    ])
    expect(merged.exact).toBe(false)
  })

  it('prefers a review item over a dependency at the same path', () => {
    const asItem = row({
      depth: 0,
      parentVersionId: null,
      fileId: 'p',
      fileVersionId: 'p-1',
      filePath: 'P.sldprt',
      version: 1,
    })
    const merged = mergeClosures([
      [asItem],
      [drawingA, row({ fileId: 'p', fileVersionId: 'p-9', filePath: 'P.sldprt', version: 9 })],
    ])
    expect(merged.files.find((f) => f.fileId === 'p')!.fileVersionId).toBe('p-1')
  })

  it('reports unresolved rows as missing, once per parent and path, with the parent path', () => {
    const missing = row({
      fileId: null,
      fileVersionId: null,
      contentHash: null,
      filePath: null,
      missing: true,
      parentVersionId: 'dA-3',
      referencePath: 'C:\\SOLIDWORKS Data\\Toolbox\\bolt.sldprt',
    })
    const merged = mergeClosures([[drawingA, missing, { ...missing }]])
    expect(merged.missing).toEqual([
      {
        referencePath: 'C:\\SOLIDWORKS Data\\Toolbox\\bolt.sldprt',
        parentPath: 'Drawings/A.SLDDRW',
        parentVersionId: 'dA-3',
        referenceType: 'reference',
      },
    ])
    expect(merged.files).toHaveLength(1)
    expect(merged.exact).toBe(false)
  })

  it('normalises paths to forward slashes without a leading slash', () => {
    const merged = mergeClosures([[{ ...drawingA, filePath: '\\Drawings\\A.SLDDRW' }]])
    expect(merged.files[0].filePath).toBe('Drawings/A.SLDDRW')
    expect(merged.files[0].fileName).toBe('A.SLDDRW')
  })

  it('keeps one file where two paths land on the same package path', () => {
    const lower = row({ fileId: 'p1', fileVersionId: 'p1-2', filePath: 'Parts/bracket.sldprt', version: 2 })
    const upper = row({ fileId: 'p2', fileVersionId: 'p2-5', filePath: 'Parts/BRACKET.SLDPRT', version: 5 })
    const merged = mergeClosures([[drawingA, lower, upper]])
    expect(merged.files.filter((f) => !f.isRoot)).toHaveLength(1)
    expect(merged.conflicts).toHaveLength(1)
    expect(merged.exact).toBe(false)
  })
})

describe('groupByContentHash', () => {
  it('groups files that share content', () => {
    const merged = mergeClosures([
      [
        drawingA,
        row({ fileId: 'a', fileVersionId: 'a-1', filePath: 'a.sldprt', contentHash: 'same' }),
        row({ fileId: 'b', fileVersionId: 'b-1', filePath: 'b.sldprt', contentHash: 'same' }),
      ],
    ])
    const groups = groupByContentHash(merged.files)
    expect(groups.map((g) => g.map((f) => f.fileId))).toEqual([['dA'], ['a', 'b']])
  })
})
