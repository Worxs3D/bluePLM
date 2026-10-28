import { describe, expect, it } from 'vitest'

import {
  isRetargetable,
  isStorageHash,
  joinLocalPath,
  openDocumentNameClashes,
  packageRelativePath,
  sanitizeFolderName,
  sanitizePathSegment,
} from './layout'

describe('sanitizeFolderName', () => {
  it('replaces characters Windows refuses and trims trailing dots and spaces', () => {
    expect(sanitizeFolderName('BR-107: Bracket / rev "B"?. ')).toBe('BR-107_ Bracket _ rev _B__')
  })

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFolderName('...')).toBe('Review')
    expect(sanitizeFolderName(null, 'Package')).toBe('Package')
  })

  it('prefixes reserved device names', () => {
    expect(sanitizeFolderName('CON')).toBe('_CON')
    expect(sanitizeFolderName('lpt1.txt')).toBe('_lpt1.txt')
  })

  it('caps the length', () => {
    expect(sanitizeFolderName('x'.repeat(300))).toHaveLength(80)
  })
})

describe('packageRelativePath', () => {
  it('keeps the vault folder structure with forward slashes', () => {
    expect(packageRelativePath('Projects\\BR-107\\Bracket.SLDPRT')).toBe(
      'Projects/BR-107/Bracket.SLDPRT',
    )
  })

  it('never climbs out of the package', () => {
    expect(packageRelativePath('../../Windows/evil.sldprt')).toBe('_/_/Windows/evil.sldprt')
    expect(packageRelativePath('/./a//b')).toBe('a/b')
  })

  it('sanitizes each segment', () => {
    expect(packageRelativePath('A:B/c?.sldprt')).toBe('A_B/c_.sldprt')
    expect(sanitizePathSegment('   ')).toBe('_')
  })
})

describe('joinLocalPath', () => {
  it('uses backslashes under a Windows root', () => {
    expect(joinLocalPath('C:\\Reviews\\', 'Pkg/Parts/P.sldprt')).toBe(
      'C:\\Reviews\\Pkg\\Parts\\P.sldprt',
    )
  })

  it('uses forward slashes under a POSIX root', () => {
    expect(joinLocalPath('/tmp/x', 'a/b')).toBe('/tmp/x/a/b')
    expect(joinLocalPath('/tmp/x/', '')).toBe('/tmp/x')
  })
})

describe('isRetargetable', () => {
  it('covers assemblies and drawings only', () => {
    expect(isRetargetable('a/B.SLDASM')).toBe(true)
    expect(isRetargetable('a/B.slddrw')).toBe(true)
    expect(isRetargetable('a/B.sldprt')).toBe(false)
  })
})

describe('openDocumentNameClashes', () => {
  it('names open documents outside the staging folder that share a staged file name', () => {
    expect(
      openDocumentNameClashes(
        ['Bracket.SLDPRT', 'A.SLDDRW'],
        [
          'C:\\Vault\\Parts\\bracket.sldprt',
          'C:\\Temp\\blueplm-review-1\\A.SLDDRW',
          'C:\\x\\Other.sldprt',
        ],
        'C:\\Temp\\blueplm-review-1',
      ),
    ).toEqual(['C:\\Vault\\Parts\\bracket.sldprt'])
  })
})

describe('isStorageHash', () => {
  it('accepts a plain hash and refuses anything that could leave the cache folder', () => {
    expect(isStorageHash('a'.repeat(64))).toBe(true)
    expect(isStorageHash('a'.repeat(40) + '\\..\\evil')).toBe(false)
    expect(isStorageHash('../' + 'a'.repeat(64))).toBe(false)
    expect(isStorageHash('')).toBe(false)
  })
})
