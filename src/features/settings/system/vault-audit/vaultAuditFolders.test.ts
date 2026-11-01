import { describe, expect, it } from 'vitest'

import {
  ancestorKeys,
  buildFolderIndex,
  findFolder,
  folderScopeBlocksRun,
  folderScopeStatus,
  suggestFolders,
  type VaultFolderSourceEntry,
} from './vaultAuditFolders'

const VAULT = 'C:\\BluePLM\\vault'

function folder(relativePath: string, diffStatus?: string): VaultFolderSourceEntry {
  const name = relativePath.split('/').pop() ?? relativePath
  return { name, relativePath, isDirectory: true, extension: '', diffStatus }
}

function model(
  relativePath: string,
  options: { id?: string; diffStatus?: string; recordedPath?: string } = {},
): VaultFolderSourceEntry {
  const name = relativePath.split('/').pop() ?? relativePath
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  return {
    name,
    relativePath,
    isDirectory: false,
    extension,
    diffStatus: options.diffStatus,
    pdmData: { id: options.id ?? relativePath, file_path: options.recordedPath ?? relativePath },
  }
}

const ENTRIES: VaultFolderSourceEntry[] = [
  folder('0 - SHARED'),
  folder('0 - SHARED/00 - REGRESSION TESTS'),
  folder('Parts'),
  folder('Parts/Fasteners'),
  folder('Parts-Old'),
  model('0 - SHARED/00 - REGRESSION TESTS/ORING.SLDPRT'),
  model('Parts/BRACKET.SLDPRT'),
  model('Parts/Fasteners/M3.SLDPRT'),
  model('Parts/Fasteners/M4.sldprt', { diffStatus: 'cloud' }),
  model('Parts/RIG.SLDASM'),
  model('Parts/BRACKET.SLDDRW'),
  model('Parts-Old/BRACKET.SLDPRT'),
  // Local-only: no row, so the scan will not see it.
  {
    name: 'NEW.SLDPRT',
    relativePath: 'Parts/NEW.SLDPRT',
    isDirectory: false,
    extension: '.sldprt',
  },
]

describe('buildFolderIndex', () => {
  const index = buildFolderIndex(ENTRIES)

  it('counts parts and assemblies with a row, at and beneath each folder', () => {
    expect(index.byKey.get('parts')?.modelCount).toBe(4)
    expect(index.byKey.get('parts/fasteners')?.modelCount).toBe(2)
    expect(index.byKey.get('0 - shared')?.modelCount).toBe(1)
    // Its name starts like `Parts`, but nothing of it is counted there.
    expect(index.byKey.get('parts-old')?.modelCount).toBe(1)
  })

  it('separates what this machine can open from what is only on the server', () => {
    expect(index.byKey.get('parts/fasteners')?.onDiskCount).toBe(1)
    expect(index.byKey.get('parts')?.onDiskCount).toBe(3)
  })

  it('counts a moved row once, at the path BluePLM records', () => {
    const moved = buildFolderIndex([
      folder('Old'),
      folder('New'),
      model('Old/PLATE.SLDPRT', { id: 'row-1', diffStatus: 'moved_away' }),
      model('New/PLATE.SLDPRT', {
        id: 'row-1',
        diffStatus: 'moved',
        recordedPath: 'Old/PLATE.SLDPRT',
      }),
    ])
    expect(moved.byKey.get('old')?.modelCount).toBe(1)
    expect(moved.byKey.get('old')?.onDiskCount).toBe(1)
    expect(moved.byKey.get('new')?.modelCount).toBe(0)
  })

  it('offers a folder known only from a row path', () => {
    const index2 = buildFolderIndex([model('Cloud/Deep/PART.SLDPRT', { diffStatus: 'cloud' })])
    expect(index2.byKey.get('cloud/deep')).toMatchObject({ relativePath: 'Cloud/Deep', depth: 1 })
    expect(index2.children.get('')?.map((f) => f.name)).toEqual(['Cloud'])
  })

  it('builds children in path order', () => {
    expect(index.children.get('')?.map((f) => f.name)).toEqual(['0 - SHARED', 'Parts', 'Parts-Old'])
    expect(index.children.get('parts')?.map((f) => f.name)).toEqual(['Fasteners'])
  })
})

describe('findFolder and folderScopeStatus', () => {
  const index = buildFolderIndex(ENTRIES)

  it('finds a folder however its path is written', () => {
    for (const input of [
      'Parts/Fasteners',
      'parts\\fasteners',
      '/Parts/Fasteners/',
      'C:\\BluePLM\\vault\\Parts\\Fasteners\\',
      '"C:\\BluePLM\\vault\\Parts\\Fasteners"',
    ]) {
      expect(findFolder(index, input, VAULT)?.relativePath).toBe('Parts/Fasteners')
    }
  })

  it('reports why a scope cannot run', () => {
    expect(folderScopeStatus(index, '', VAULT).kind).toBe('empty')
    expect(folderScopeStatus(index, VAULT, VAULT).kind).toBe('empty')
    expect(folderScopeStatus(index, 'D:\\Elsewhere\\Parts', VAULT).kind).toBe('outside-vault')
    expect(folderScopeStatus(index, 'Partz', VAULT).kind).toBe('not-found')
    expect(folderScopeStatus(index, 'parts', VAULT)).toMatchObject({ kind: 'found' })
  })

  it('says nothing either way before the folders have loaded', () => {
    const empty = buildFolderIndex([])
    expect(folderScopeStatus(empty, 'Parts', VAULT).kind).toBe('unknown')
    expect(folderScopeBlocksRun(folderScopeStatus(empty, 'Parts', VAULT))).toBe(false)
  })

  it('blocks a run that would scan nothing or the whole vault', () => {
    expect(folderScopeBlocksRun({ kind: 'empty' })).toBe(true)
    expect(folderScopeBlocksRun({ kind: 'not-found' })).toBe(true)
    expect(folderScopeBlocksRun({ kind: 'outside-vault' })).toBe(true)
    expect(folderScopeBlocksRun(folderScopeStatus(index, 'Parts', VAULT))).toBe(false)
  })
})

describe('suggestFolders', () => {
  const index = buildFolderIndex(ENTRIES)
  const names = (input: string) => suggestFolders(index, input, VAULT).map((f) => f.relativePath)

  it('offers the top-level folders for an empty box', () => {
    expect(names('')).toEqual(['0 - SHARED', 'Parts', 'Parts-Old'])
  })

  it('ranks a name match before a match elsewhere in the path', () => {
    expect(names('fast')).toEqual(['Parts/Fasteners'])
    expect(names('parts')[0]).toBe('Parts')
    expect(names('regression')).toEqual(['0 - SHARED/00 - REGRESSION TESTS'])
  })

  it('reads a query with a separator as a path prefix', () => {
    expect(names('parts/f')).toEqual(['Parts/Fasteners'])
    expect(names('C:\\BluePLM\\vault\\Parts\\')).toContain('Parts')
  })

  it('stops at the limit', () => {
    expect(suggestFolders(index, 'a', VAULT, 2)).toHaveLength(2)
  })
})

describe('ancestorKeys', () => {
  it('lists the folders above, nearest first', () => {
    expect(ancestorKeys('A/B/C')).toEqual(['a/b', 'a'])
    expect(ancestorKeys('A')).toEqual([])
  })
})
