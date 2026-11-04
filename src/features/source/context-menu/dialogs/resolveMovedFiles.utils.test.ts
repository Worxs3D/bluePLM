/**
 * `ResolveMovedFilesDialog`'s own logic is entirely in these two functions: which pending moves
 * to list, and which of them a given scope selection covers. Everything else in the dialog is
 * rendering and calling the two commands' own preflights, which are already tested where they
 * live.
 */

import { describe, expect, it } from 'vitest'

import type { PDMFile } from '@/types/pdm'
import type { LocalFile } from '@/stores/pdmStore'

import {
  buildMovedPairs,
  buildScope,
  filterByScope,
  inferDefaultScopeType,
  isInScope,
  countSelected,
  splitPathDifference,
  statusByFileId,
  type MovedPair,
} from './resolveMovedFiles.utils'

function baseFile(overrides: Partial<LocalFile>): LocalFile {
  return {
    name: 'part.sldprt',
    path: 'C:/vault/part.sldprt',
    relativePath: 'part.sldprt',
    isDirectory: false,
    extension: 'sldprt',
    size: 0,
    modifiedTime: '',
    ...overrides,
  }
}

function pdm(overrides: Partial<PDMFile>): PDMFile {
  return { id: 'file-1', file_path: 'old/part.sldprt', file_name: 'part.sldprt', ...overrides } as PDMFile
}

describe('buildMovedPairs', () => {
  it('builds a pair from a moved row using the server path and the current relative path', () => {
    const pairs = buildMovedPairs([
      baseFile({
        relativePath: 'new/part.sldprt',
        diffStatus: 'moved',
        pdmData: pdm({ id: 'file-1', file_path: 'old/part.sldprt' }),
      }),
    ])

    expect(pairs).toMatchObject<Partial<MovedPair>[]>([
      { fileId: 'file-1', name: 'part.sldprt', serverPath: 'old/part.sldprt', localPath: 'new/part.sldprt' },
    ])
  })

  it('builds a pair from a lone moved_away stub using its destination field', () => {
    const pairs = buildMovedPairs([
      baseFile({
        relativePath: 'old/part.sldprt',
        diffStatus: 'moved_away',
        movedToRelativePath: 'new/part.sldprt',
        pdmData: pdm({ id: 'file-1', file_path: 'old/part.sldprt' }),
      }),
    ])

    expect(pairs).toMatchObject<Partial<MovedPair>[]>([
      { fileId: 'file-1', name: 'part.sldprt', serverPath: 'old/part.sldprt', localPath: 'new/part.sldprt' },
    ])
  })

  it('prefers the moved row over its moved_away partner rather than listing the move twice', () => {
    const pairs = buildMovedPairs([
      baseFile({
        relativePath: 'new/part.sldprt',
        diffStatus: 'moved',
        pdmData: pdm({ id: 'file-1', file_path: 'old/part.sldprt' }),
      }),
      baseFile({
        relativePath: 'old/part.sldprt',
        diffStatus: 'moved_away',
        movedToRelativePath: 'new/part.sldprt',
        pdmData: pdm({ id: 'file-1', file_path: 'old/part.sldprt' }),
      }),
    ])

    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.fileId).toBe('file-1')
  })

  it('ignores files that are not part of a pending move', () => {
    const pairs = buildMovedPairs([
      baseFile({ diffStatus: 'modified', pdmData: pdm({}) }),
      baseFile({ diffStatus: 'cloud', pdmData: pdm({}) }),
      baseFile({ diffStatus: undefined }),
    ])

    expect(pairs).toEqual([])
  })

  it('normalizes backslashes so scope matching never depends on separator style', () => {
    const pairs = buildMovedPairs([
      baseFile({
        relativePath: 'new\\part.sldprt',
        diffStatus: 'moved',
        pdmData: pdm({ id: 'file-1', file_path: 'old\\part.sldprt' }),
      }),
    ])

    expect(pairs[0]).toMatchObject({ serverPath: 'old/part.sldprt', localPath: 'new/part.sldprt' })
  })
})

describe('isInScope', () => {
  const item = { fileId: 'file-1', serverPath: 'Fixed Lens Models/a.sldprt', localPath: 'athom/a.sldprt' }

  it('matches everything for a vault scope', () => {
    expect(isInScope(item, { type: 'vault' })).toBe(true)
  })

  it('matches only the exact file for a file scope', () => {
    expect(isInScope(item, { type: 'file', fileId: 'file-1' })).toBe(true)
    expect(isInScope(item, { type: 'file', fileId: 'file-2' })).toBe(false)
    expect(isInScope(item, { type: 'file', fileId: null })).toBe(false)
  })

  it('matches a folder scope against either the server path or the local path', () => {
    expect(isInScope(item, { type: 'folder', folderPath: 'Fixed Lens Models' })).toBe(true)
    expect(isInScope(item, { type: 'folder', folderPath: 'athom' })).toBe(true)
    expect(isInScope(item, { type: 'folder', folderPath: 'Fixed Lens' })).toBe(false)
  })

  it('treats an empty folder path (the vault root) as matching everything', () => {
    expect(isInScope(item, { type: 'folder', folderPath: '' })).toBe(true)
  })
})

describe('filterByScope', () => {
  it('keeps only the items the scope covers', () => {
    const items = [
      { fileId: 'a', serverPath: 'x/a.sldprt', localPath: 'y/a.sldprt' },
      { fileId: 'b', serverPath: 'z/b.sldprt', localPath: 'w/b.sldprt' },
    ]

    expect(filterByScope(items, { type: 'folder', folderPath: 'x' })).toEqual([items[0]])
    expect(filterByScope(items, { type: 'vault' })).toEqual(items)
  })
})

describe('inferDefaultScopeType', () => {
  it('defaults to folder for a directory, file for a file, and vault for no context', () => {
    expect(inferDefaultScopeType(baseFile({ isDirectory: true, relativePath: 'a' }))).toBe('folder')
    expect(inferDefaultScopeType(baseFile({ isDirectory: false }))).toBe('file')
    expect(inferDefaultScopeType(null)).toBe('vault')
  })
})

describe('buildScope', () => {
  it('builds a file scope from the context file’s own pdmData id', () => {
    const file = baseFile({ pdmData: pdm({ id: 'file-9' }) })
    expect(buildScope('file', file)).toEqual({ type: 'file', fileId: 'file-9' })
  })

  it('builds a file scope with a null id when the context file has no server row', () => {
    expect(buildScope('file', baseFile({ pdmData: undefined }))).toEqual({
      type: 'file',
      fileId: null,
    })
  })

  it('builds a folder scope from a directory’s own path', () => {
    const folder = baseFile({ isDirectory: true, relativePath: 'a/b' })
    expect(buildScope('folder', folder)).toEqual({ type: 'folder', folderPath: 'a/b' })
  })

  it('builds a folder scope from a file’s parent directory', () => {
    const file = baseFile({ isDirectory: false, relativePath: 'a/b/c.sldprt' })
    expect(buildScope('folder', file)).toEqual({ type: 'folder', folderPath: 'a/b' })
  })

  it('builds a root folder scope for a root-level file', () => {
    const file = baseFile({ isDirectory: false, relativePath: 'c.sldprt' })
    expect(buildScope('folder', file)).toEqual({ type: 'folder', folderPath: '' })
  })

  it('always builds a vault scope regardless of context', () => {
    expect(buildScope('vault', baseFile({}))).toEqual({ type: 'vault' })
    expect(buildScope('vault', null)).toEqual({ type: 'vault' })
  })
})

describe('buildMovedPairs facts', () => {
  it('carries the dates, version and checkout a row shows', () => {
    const [pair] = buildMovedPairs([
      baseFile({
        relativePath: 'new/part.sldprt',
        modifiedTime: '2026-11-02T10:00:00Z',
        diffStatus: 'moved',
        pdmData: pdm({
          id: 'file-1',
          file_path: 'old/part.sldprt',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          updated_by: 'user-2',
          version: 4,
          checked_out_by: 'user-3',
        }),
      }),
    ])
    expect(pair).toMatchObject({
      localModifiedAt: '2026-11-02T10:00:00Z',
      vaultCreatedAt: '2026-01-01T00:00:00Z',
      vaultUpdatedAt: '2026-10-01T00:00:00Z',
      vaultUpdatedBy: 'user-2',
      version: 4,
      checkedOutBy: 'user-3',
    })
  })

  it('has no disk date for a lone moved_away stub', () => {
    const [pair] = buildMovedPairs([
      baseFile({
        relativePath: 'old/part.sldprt',
        modifiedTime: '2026-11-02T10:00:00Z',
        diffStatus: 'moved_away',
        movedToRelativePath: 'new/part.sldprt',
        pdmData: pdm({ id: 'file-1', file_path: 'old/part.sldprt' }),
      }),
    ])
    expect(pair.localModifiedAt).toBeNull()
  })
})

describe('splitPathDifference', () => {
  const join = (parts: { prefix: string; serverMiddle: string; localMiddle: string; suffix: string }) => [
    parts.prefix + parts.serverMiddle + parts.suffix,
    parts.prefix + parts.localMiddle + parts.suffix,
  ]

  it('isolates a folder inserted in the middle', () => {
    const parts = splitPathDifference('P00/Assy/x.sldasm', 'P00/Released/Rev A/Assy/x.sldasm')
    expect(parts).toEqual({
      prefix: 'P00/',
      serverMiddle: '',
      localMiddle: 'Released/Rev A/',
      suffix: 'Assy/x.sldasm',
    })
  })

  it('isolates a removed folder and a rename', () => {
    expect(splitPathDifference('A/B/_ARCHIVE/x.sldprt', 'A/B/x.sldprt')).toEqual({
      prefix: 'A/B/',
      serverMiddle: '_ARCHIVE/',
      localMiddle: '',
      suffix: 'x.sldprt',
    })
    expect(splitPathDifference('a/old.sldprt', 'a/new.sldprt')).toEqual({
      prefix: 'a/',
      serverMiddle: 'old.sldprt',
      localMiddle: 'new.sldprt',
      suffix: '',
    })
  })

  it('matches whole segments only, ignoring case', () => {
    expect(splitPathDifference('Fixed Lens/a.sldprt', 'Fixed Lens Models/a.sldprt').prefix).toBe('')
    expect(splitPathDifference('dev/A/a.sldprt', 'DEV/B/a.sldprt').prefix).toBe('dev/')
  })

  it('always reassembles both paths exactly', () => {
    const cases: Array<[string, string]> = [
      ['x.sldprt', 'y.sldprt'],
      ['a/x.sldprt', 'a/x.sldprt'],
      ['a/b/c/x.sldprt', 'q/x.sldprt'],
      ['a/x.sldprt', 'a/b/b/x.sldprt'],
      ['0 - SHARED/02-TEMPLATES/Archive/BR-NUMBER.SLDDRW', 'WTE/release/wte5/BR-102614.SLDDRW'],
    ]
    for (const [server, local] of cases) {
      expect(join(splitPathDifference(server, local))).toEqual([server, local])
    }
  })
})

describe('statusByFileId', () => {
  it('maps each bucket to a row status', () => {
    const map = statusByFileId({
      eligible: [{ fileId: 'a' }],
      blocked: [{ fileId: 'b', holderName: 'Sam' }],
      skipped: [
        { fileId: 'c', reason: 'conflict' },
        { fileId: 'd', reason: 'unverified' },
      ],
    })
    expect(map.get('a')).toEqual({ kind: 'ready' })
    expect(map.get('b')).toEqual({ kind: 'held', holderName: 'Sam' })
    expect(map.get('c')).toEqual({ kind: 'conflict' })
    expect(map.get('d')).toEqual({ kind: 'unverified' })
    expect(map.get('e')).toBeUndefined()
  })
})

describe('countSelected', () => {
  it('counts only the ticked rows and groups holders', () => {
    const counts = countSelected(
      {
        eligible: [{ fileId: 'a' }, { fileId: 'x' }],
        blocked: [
          { fileId: 'b', holderName: 'Sam' },
          { fileId: 'c', holderName: 'Sam' },
          { fileId: 'y', holderName: 'Kim' },
        ],
        skipped: [
          { fileId: 'd', reason: 'conflict' },
          { fileId: 'e', reason: 'unverified' },
        ],
      },
      new Set(['a', 'b', 'c', 'd', 'e']),
    )
    expect(counts).toEqual({
      eligible: 1,
      blocked: 2,
      conflicts: 1,
      unverified: 1,
      holders: [{ holderName: 'Sam', count: 2 }],
    })
  })
})
