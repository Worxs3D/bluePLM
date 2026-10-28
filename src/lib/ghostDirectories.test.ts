import { describe, expect, it } from 'vitest'
import type { LocalFile } from '@/stores/types'
import { getUnassertedEmptyDirectories, selectGhostDirectories } from './ghostDirectories'

const VAULT = 'C:/Vault'

function dir(relativePath: string, modifiedTime = '2026-10-01T00:00:00.000Z'): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `${VAULT}/${relativePath}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime,
  }
}

function file(relativePath: string, diffStatus?: LocalFile['diffStatus']): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `${VAULT}/${relativePath}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '2026-10-01T00:00:00.000Z',
    diffStatus,
  }
}

describe('getUnassertedEmptyDirectories', () => {
  it('nominates an empty directory the server no longer lists', () => {
    const files = [dir('WLC'), file('WLC/a.sldprt'), dir('WLC Fibre')]
    const result = getUnassertedEmptyDirectories(files, new Set(['WLC']))
    expect(result.map((f) => f.relativePath)).toEqual(['WLC Fibre'])
  })

  it('keeps a directory with any file beneath it, whatever its status', () => {
    const files = [dir('A'), dir('A/B'), file('A/B/x.sldprt', 'deleted_remote')]
    expect(getUnassertedEmptyDirectories(files, new Set())).toEqual([])
  })

  it('keeps a directory the server asserts, compared without regard to case', () => {
    const files = [dir('Fibre')]
    expect(getUnassertedEmptyDirectories(files, new Set(['FIBRE']))).toEqual([])
  })

  it('keeps the parents of a server-asserted folder', () => {
    const files = [dir('A'), dir('A/B')]
    expect(getUnassertedEmptyDirectories(files, new Set(['A/B']))).toEqual([])
  })

  it('ignores cloud-only directory rows, which have nothing on disk', () => {
    const cloudDir = { ...dir('Cloud'), diffStatus: 'cloud' as const }
    expect(getUnassertedEmptyDirectories([cloudDir], new Set())).toEqual([])
  })
})

describe('selectGhostDirectories', () => {
  const deletedAt = '2026-10-20T12:00:00.000Z'

  it('selects a directory unchanged since its folder row was deleted', () => {
    const candidates = [dir('WLC Fibre', '2026-10-15T09:00:00.000Z')]
    const result = selectGhostDirectories(candidates, [
      { folder_path: 'WLC Fibre', deleted_at: deletedAt },
    ])
    expect(result.map((f) => f.relativePath)).toEqual(['WLC Fibre'])
  })

  it('keeps an empty folder with no deleted row: the user made it here', () => {
    expect(selectGhostDirectories([dir('Mine')], [])).toEqual([])
  })

  it('keeps a folder recreated or touched after the deletion', () => {
    const candidates = [dir('WLC Fibre', '2026-10-21T00:00:00.000Z')]
    expect(
      selectGhostDirectories(candidates, [{ folder_path: 'WLC Fibre', deleted_at: deletedAt }]),
    ).toEqual([])
  })

  it('judges against the latest deletion of the path', () => {
    const candidates = [dir('X', '2026-10-21T00:00:00.000Z')]
    const rows = [
      { folder_path: 'X', deleted_at: deletedAt },
      { folder_path: 'x', deleted_at: '2026-10-22T00:00:00.000Z' },
    ]
    expect(selectGhostDirectories(candidates, rows).map((f) => f.relativePath)).toEqual(['X'])
  })

  it('keeps a directory whose mtime cannot be read', () => {
    const candidates = [dir('X', '')]
    expect(selectGhostDirectories(candidates, [{ folder_path: 'X', deleted_at: deletedAt }])).toEqual(
      [],
    )
  })
})
