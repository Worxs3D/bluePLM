import { describe, expect, it } from 'vitest'

import {
  buildManifest,
  indexRetargetResults,
  manifestToCsv,
  manifestToJson,
  MANIFEST_CSV_COLUMNS,
  previousPackagedHashes,
} from './manifest'
import type { MergedClosure, PackageFile, StagedFile } from './types'

function file(partial: Partial<PackageFile>): PackageFile {
  return {
    fileVersionId: 'v',
    fileId: 'f',
    filePath: 'Parts/P.sldprt',
    fileName: 'P.sldprt',
    version: 2,
    revision: 'B',
    contentHash: 'hash-p',
    fileSize: 100,
    exact: true,
    isRoot: false,
    deleted: false,
    ...partial,
  }
}

const drawing = file({
  fileVersionId: 'd-3',
  filePath: 'Drawings/A.SLDDRW',
  fileName: 'A.SLDDRW',
  version: 3,
  revision: 'C',
  contentHash: 'hash-d',
  isRoot: true,
})
const part = file({ fileVersionId: 'p-2' })

function staged(f: PackageFile, status: StagedFile['status'] = 'downloaded'): StagedFile {
  return { file: f, localPath: `C:\\Pkg\\${f.filePath}`, packagePath: f.filePath, status }
}

const closure: MergedClosure = {
  files: [drawing, part],
  missing: [
    {
      referencePath: 'C:\\Toolbox\\bolt=M6.sldprt',
      parentPath: 'Drawings/A.SLDDRW',
      parentVersionId: 'd-3',
      referenceType: 'reference',
    },
  ],
  conflicts: [],
  exact: false,
  totalBytes: 200,
}

describe('indexRetargetResults', () => {
  it('keys the service results by package path and keeps unresolved references', () => {
    const index = indexRetargetResults('C:\\Pkg\\', [
      {
        filePath: 'C:\\Pkg\\Drawings\\A.SLDDRW',
        status: 'retargeted',
        references: [
          { oldPath: 'C:\\Vault\\Parts\\P.sldprt', status: 'retargeted' },
          { oldPath: 'C:\\Toolbox\\bolt.sldprt', status: 'missing' },
          { oldPath: 'D:\\x\\Q.sldprt', status: 'ambiguous' },
        ],
      },
      { filePath: 'D:\\Elsewhere\\B.SLDASM', status: 'failed', references: [] },
    ])
    expect([...index.keys()]).toEqual(['drawings/a.slddrw'])
    expect(index.get('drawings/a.slddrw')).toEqual({
      status: 'retargeted',
      missingReferences: ['C:\\Toolbox\\bolt.sldprt', 'D:\\x\\Q.sldprt'],
      error: undefined,
    })
  })
})

describe('buildManifest', () => {
  it('records original and packaged hashes, retarget status and missing references', () => {
    const retarget = indexRetargetResults('C:\\Pkg', [
      {
        filePath: 'C:\\Pkg\\Drawings\\A.SLDDRW',
        status: 'retargeted',
        references: [{ oldPath: 'C:\\Toolbox\\bolt.sldprt', status: 'missing' }],
      },
    ])
    const manifest = buildManifest({
      reviewId: 'r1',
      title: 'Bracket review',
      generatedAt: '2026-10-28T00:00:00.000Z',
      closure,
      staged: [staged(drawing), staged(part, 'skipped')],
      retarget,
      packagedHashes: new Map([['drawings/a.slddrw', 'hash-d-retargeted']]),
    })
    expect(manifest.exact).toBe(false)
    expect(manifest.files).toEqual([
      {
        file: 'Drawings/A.SLDDRW',
        fileName: 'A.SLDDRW',
        version: 3,
        revision: 'C',
        originalHash: 'hash-d',
        packagedHash: 'hash-d-retargeted',
        exact: true,
        isReviewItem: true,
        deleted: false,
        stageStatus: 'downloaded',
        retargetStatus: 'retargeted',
        missingReferences: ['C:\\Toolbox\\bolt.sldprt'],
      },
      expect.objectContaining({
        file: 'Parts/P.sldprt',
        packagedHash: null,
        stageStatus: 'skipped',
        retargetStatus: 'not_applicable',
      }),
    ])
    expect(manifest.missingReferences).toHaveLength(1)
  })

  it('says not_run for assemblies and drawings when retargeting did not run', () => {
    const manifest = buildManifest({
      reviewId: null,
      title: 't',
      generatedAt: 'now',
      closure: { ...closure, missing: [], exact: true },
      staged: [staged(drawing)],
      retarget: null,
    })
    expect(manifest.files[0].retargetStatus).toBe('not_run')
    expect(manifest.exact).toBe(true)
  })
})

describe('manifestToCsv', () => {
  it('writes a header, one row per file and one per missing reference, escaped', () => {
    const manifest = buildManifest({
      reviewId: 'r1',
      title: 't',
      generatedAt: 'now',
      closure,
      staged: [staged(file({ filePath: 'Parts/"Quoted", part.sldprt', revision: '=1+1' }))],
      retarget: null,
    })
    const lines = manifestToCsv(manifest).trimEnd().split('\r\n')
    expect(lines[0]).toBe(MANIFEST_CSV_COLUMNS.join(','))
    expect(lines[1]).toBe(
      '"Parts/""Quoted"", part.sldprt",2,\'=1+1,hash-p,,true,false,false,downloaded,not_applicable,',
    )
    expect(lines[2]).toBe(
      'C:\\Toolbox\\bolt=M6.sldprt,,,,,false,false,false,missing,,Drawings/A.SLDDRW',
    )
    expect(lines).toHaveLength(3)
  })
})

describe('previousPackagedHashes', () => {
  it('reads path|original hash -> packaged hash from an earlier manifest', () => {
    const json = manifestToJson(
      buildManifest({
        reviewId: 'r1',
        title: 't',
        generatedAt: 'now',
        closure,
        staged: [staged(drawing)],
        retarget: null,
        packagedHashes: new Map([['drawings/a.slddrw', 'after']]),
      }),
    )
    expect(previousPackagedHashes(json)).toEqual(new Map([['drawings/a.slddrw|hash-d', 'after']]))
  })

  it('returns nothing for a missing or unreadable manifest', () => {
    expect(previousPackagedHashes(null).size).toBe(0)
    expect(previousPackagedHashes('{not json').size).toBe(0)
    expect(previousPackagedHashes('{"files": 3}').size).toBe(0)
  })
})
