import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { DependencyClosureRow } from '@/types/reviews'

import { itemPreviewKind, summarizeClosure } from './itemInfo'
import { localCopyWarnings, reviewableFiles } from './localCopy'

function local(extra: Partial<LocalFile>): LocalFile {
  return {
    name: 'a.slddrw',
    path: 'C:/v/a.slddrw',
    relativePath: 'a.slddrw',
    isDirectory: false,
    extension: '.slddrw',
    size: 1,
    modifiedTime: '',
    ...extra,
  } as LocalFile
}

function pdm(checkedOutBy: string | null): LocalFile['pdmData'] {
  return { id: 'f1', checked_out_by: checkedOutBy } as LocalFile['pdmData']
}

describe('localCopyWarnings', () => {
  it('warns the requester about their own checkout and local edits', () => {
    expect(localCopyWarnings({ pdmData: pdm('me'), diffStatus: 'modified' }, 'me', 4, 4)).toEqual([
      'checked_out_by_me',
      'modified',
    ])
  })

  it('warns when someone else holds the file or a newer version exists', () => {
    expect(localCopyWarnings({ pdmData: pdm('them') }, 'me', 3, 5)).toEqual([
      'checked_out_by_other',
      'older_version',
    ])
  })

  it('says nothing for a clean, latest, checked-in file or no local copy', () => {
    expect(localCopyWarnings({ pdmData: pdm(null) }, 'me', 5, 5)).toEqual([])
    expect(localCopyWarnings(undefined, 'me', 5, 5)).toEqual([])
  })
})

describe('reviewableFiles', () => {
  it('keeps synced files and drops folders, local-only files and move stubs', () => {
    const files = [
      local({ name: 'ok', pdmData: pdm(null) }),
      local({ name: 'folder', isDirectory: true, pdmData: pdm(null) }),
      local({ name: 'local-only' }),
      local({ name: 'stub', pdmData: pdm(null), diffStatus: 'moved_away' }),
    ]
    expect(reviewableFiles(files).map((f) => f.name)).toEqual(['ok'])
  })
})

function closureRow(extra: Partial<DependencyClosureRow>): DependencyClosureRow {
  return {
    depth: 1,
    parentVersionId: 'root',
    fileId: 'f',
    fileVersionId: 'fv',
    referencePath: 'p',
    configuration: null,
    referenceType: 'component',
    quantity: 1,
    exact: true,
    edgeSource: 'recorded',
    missing: false,
    version: 1,
    revision: null,
    contentHash: 'h',
    fileSize: 1,
    fileName: 'n',
    filePath: 'p',
    extension: '.sldprt',
    vaultId: 'v',
    deleted: false,
    ...extra,
  }
}

describe('summarizeClosure', () => {
  it('counts distinct referenced versions below the root, with exactness and missing references', () => {
    const summary = summarizeClosure([
      closureRow({ depth: 0, fileVersionId: 'root', edgeSource: 'root' }),
      closureRow({ fileVersionId: 'a' }),
      closureRow({ fileVersionId: 'a', depth: 2 }),
      closureRow({ fileVersionId: 'b', exact: false, edgeSource: 'fallback' }),
      closureRow({ fileVersionId: null, missing: true }),
    ])
    expect(summary).toEqual({ count: 2, exact: false, missing: 1 })
  })

  it('is exact with no references', () => {
    expect(summarizeClosure([closureRow({ depth: 0 })])).toEqual({ count: 0, exact: true, missing: 0 })
  })
})

describe('itemPreviewKind', () => {
  it('recognises drawings and PDFs with or without the dot', () => {
    expect(itemPreviewKind('.SLDDRW')).toBe('drawing')
    expect(itemPreviewKind('pdf')).toBe('pdf')
    expect(itemPreviewKind('.sldprt')).toBe('other')
    expect(itemPreviewKind(null)).toBe('other')
  })
})
