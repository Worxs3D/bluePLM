import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'

import { getFilesInFolder } from './filtering'
import { getFolderChildren } from './folderIndex'

function row(relativePath: string, isDirectory = false): LocalFile {
  return {
    name: relativePath.split(/[\\/]/).pop() ?? relativePath,
    path: `C:\\vault\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory,
    extension: '',
    size: 0,
    modifiedTime: '2026-01-01T00:00:00Z',
  }
}

const FIXTURE: LocalFile[] = [
  row('Parts', true),
  row('Parts/Brackets', true),
  row('Parts/Brackets/a.sldprt'),
  row('Parts/Brackets/B.sldprt'),
  row('Parts/Brackets/Deep', true),
  row('Parts/Brackets/Deep/x.sldprt'),
  row('Parts/other.sldprt'),
  row('parts/lower-case-twin.sldprt'),
  row('PARTS/BRACKETS/upper.sldprt'),
  row('Parts\\Brackets\\backslash.sldprt'),
  row('Assemblies', true),
  row('Assemblies/top.sldasm'),
  row('root-file.pdf'),
  row('Root-Folder', true),
  row('/leading-slash.sldprt'),
  row('Parts/Brackets/', true),
  row('Parts/Brackets//double.sldprt'),
]

const FOLDERS = [
  '',
  'Parts',
  'parts',
  'PARTS/Brackets',
  'Parts/Brackets',
  'Parts\\Brackets',
  'Parts/Brackets/Deep',
  'Assemblies',
  'Parts/Brackets/',
  'Parts/Missing',
  'Root-Folder',
]

describe('getFolderChildren', () => {
  it.each(FOLDERS)('returns exactly what getFilesInFolder returns for %j', (folder) => {
    const files = [...FIXTURE]
    const expected = getFilesInFolder(FIXTURE, folder)

    // First lookup on an array is the plain scan, the second builds and reads the index.
    expect(getFolderChildren(files, folder)).toEqual(expected)
    expect(getFolderChildren(files, folder)).toEqual(expected)
    expect(getFolderChildren(files, folder)).toEqual(expected)
  })

  it('agrees with getFilesInFolder over a large shuffled tree, for every folder', () => {
    const rows: LocalFile[] = []
    const folders = new Set<string>([''])
    let seed = 7
    const next = (limit: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0
      return seed % limit
    }
    for (let i = 0; i < 3000; i++) {
      const depth = 1 + next(4)
      const parts = Array.from({ length: depth }, () => `d${next(4)}${next(2) === 0 ? 'X' : 'x'}`)
      const separator = next(10) === 0 ? '\\' : '/'
      const path = `${parts.join(separator)}${separator}f${i}.sldprt`
      rows.push(row(path))
      for (let end = 1; end <= depth; end++) folders.add(parts.slice(0, end).join('/'))
    }
    // Deliberately unsorted: runs of siblings are broken up.
    rows.sort(() => next(3) - 1)

    // The first lookup on an array is the plain scan; this one makes every later lookup indexed.
    getFolderChildren(rows, 'warm-up')

    for (const folder of folders) {
      expect(getFolderChildren(rows, folder)).toEqual(getFilesInFolder(rows, folder))
    }
  })

  it('keeps the order rows have in the files array', () => {
    const files = [...FIXTURE]
    getFolderChildren(files, 'warm-up')
    const names = getFolderChildren(files, 'Parts/Brackets').map((file) => file.relativePath)

    expect(names).toEqual([
      'Parts/Brackets/a.sldprt',
      'Parts/Brackets/B.sldprt',
      'Parts/Brackets/Deep',
      'PARTS/BRACKETS/upper.sldprt',
      'Parts\\Brackets\\backslash.sldprt',
      // An empty trailing part still counts as one level, as it does for getFilesInFolder.
      'Parts/Brackets/',
    ])
  })

  it('builds the index once per files array and rebuilds for a new array', () => {
    const files = [...FIXTURE]
    const first = getFolderChildren(files, 'Parts')
    const second = getFolderChildren(files, 'Parts')
    expect(second).toEqual(first)
    // From the second lookup on, the answer is the index's own bucket.
    expect(getFolderChildren(files, 'Parts')).toBe(second)

    const changed = [...files, row('Parts/new.sldprt')]
    expect(getFolderChildren(changed, 'Parts')).toHaveLength(first.length + 1)
    expect(getFolderChildren(changed, 'Parts')).toHaveLength(first.length + 1)
    // The old array's answer is unchanged.
    expect(getFolderChildren(files, 'Parts')).toHaveLength(first.length)
  })

  it('skips rows with no path instead of throwing', () => {
    const files = [row('a/b.sldprt'), undefined, { ...row('c'), relativePath: undefined }] as unknown as LocalFile[]

    // Once on the plain scan, once on the index.
    for (let pass = 0; pass < 2; pass++) {
      expect(getFolderChildren(files, 'a')).toHaveLength(1)
      expect(getFolderChildren(files, '')).toHaveLength(0)
    }
  })

  it('answers an unknown folder with an empty list', () => {
    expect(getFolderChildren(FIXTURE, 'Nope/Nothing')).toEqual([])
  })
})
