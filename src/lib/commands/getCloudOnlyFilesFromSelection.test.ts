import { describe, expect, it } from 'vitest'

import { getCloudOnlyFilesFromSelection, withResolvableDownloadHash } from './types'
import type { LocalFile } from './types'
import type { ServerFile } from '../../stores/types'
import type { PDMFile } from '../../types/pdm'

const VAULT = 'C:/vault'

function folder(relativePath: string): LocalFile {
  return {
    name: relativePath.split('/').pop() || '',
    path: `${VAULT}/${relativePath}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: '',
    diffStatus: 'cloud',
    isSynced: false,
  }
}

function cloudFile(
  relativePath: string,
  options: { hash?: string | null; pdmData?: boolean } = {},
): LocalFile {
  const name = relativePath.split('/').pop() || ''
  const includePdm = options.pdmData !== false
  const hash = options.hash === undefined ? `hash-${name}` : options.hash
  return {
    name,
    path: `${VAULT}/${relativePath}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 100,
    modifiedTime: '',
    diffStatus: 'cloud',
    isSynced: false,
    pdmData: includePdm
      ? ({
          id: `row-${name}`,
          file_path: relativePath,
          file_name: name,
          content_hash: hash,
        } as unknown as PDMFile)
      : undefined,
  }
}

function serverFile(filePath: string, hash = 'server-hash'): ServerFile {
  return {
    id: `s-${filePath}`,
    file_path: filePath,
    name: filePath.split('/').pop() || '',
    extension: '.sldprt',
    content_hash: hash,
  }
}

describe('getCloudOnlyFilesFromSelection', () => {
  const parent = folder('0 - SHARED')
  const hashed = cloudFile('0 - SHARED/real.sldprt')
  const ghost = cloudFile('0 - SHARED/ghost.sldprt', { pdmData: false })

  const files = [parent, hashed, ghost]

  it('includes hashless cloud files in a folder when serverFiles is omitted (Move still sees them)', () => {
    const result = getCloudOnlyFilesFromSelection(files, [parent])
    expect(result.map((f) => f.relativePath)).toEqual([
      '0 - SHARED/real.sldprt',
      '0 - SHARED/ghost.sldprt',
    ])
  })

  it('skips hashless leftovers when serverFiles is passed and has no hash for that path', () => {
    const result = getCloudOnlyFilesFromSelection(files, [parent], [
      serverFile('0 - SHARED/real.sldprt', 'hash-real.sldprt'),
    ])
    expect(result.map((f) => f.relativePath)).toEqual(['0 - SHARED/real.sldprt'])
  })

  it('fills a missing hash from serverFiles by path so Download can fetch the file', () => {
    const result = getCloudOnlyFilesFromSelection(files, [parent], [
      serverFile('0 - SHARED/ghost.sldprt', 'from-server'),
    ])
    const ghostRow = result.find((f) => f.relativePath === '0 - SHARED/ghost.sldprt')
    expect(ghostRow?.pdmData?.content_hash).toBe('from-server')
    expect(ghostRow?.pdmData?.id).toBe('s-0 - SHARED/ghost.sldprt')
  })

  it('skips a single-file selection that has no resolvable hash', () => {
    const result = getCloudOnlyFilesFromSelection(files, [ghost], [])
    expect(result).toEqual([])
  })
})

describe('withResolvableDownloadHash', () => {
  it('returns the file unchanged when it already has a hash', () => {
    const file = cloudFile('a/b.sldprt')
    expect(withResolvableDownloadHash(file)).toBe(file)
  })

  it('returns null when neither the row nor the server index has a hash', () => {
    const file = cloudFile('a/b.sldprt', { pdmData: false })
    expect(withResolvableDownloadHash(file, new Map())).toBeNull()
  })
})
