import { describe, expect, it } from 'vitest'
import { buildHashStamps, isCachedHashStale } from './cachedHashValidity'

const T0 = '2026-10-25T10:00:00.000Z'
const T1 = '2026-10-25T10:05:00.000Z'

describe('buildHashStamps', () => {
  it('stamps hashed files by lowercase path and skips folders and unhashed files', () => {
    const stamps = buildHashStamps([
      { relativePath: 'A/Part.SLDPRT', isDirectory: false, size: 10, modifiedTime: T0, localHash: 'h' },
      { relativePath: 'A/NoHash.SLDPRT', isDirectory: false, size: 10, modifiedTime: T0 },
      { relativePath: 'A', isDirectory: true, size: 0, modifiedTime: T0, localHash: 'h' },
    ])
    expect([...stamps.keys()]).toEqual(['a/part.sldprt'])
  })
})

describe('isCachedHashStale', () => {
  it('keeps a hash whose file is unchanged on disk', () => {
    expect(isCachedHashStale({ size: 10, modifiedTime: T0 }, { size: 10, modifiedTime: T0 })).toBe(
      false,
    )
  })

  it('keeps a hash when the timestamps differ only in format', () => {
    expect(
      isCachedHashStale(
        { size: 10, modifiedTime: T0 },
        { size: 10, modifiedTime: '2026-10-25T10:00:00Z' },
      ),
    ).toBe(false)
  })

  it('drops the hash after a save in place (same size, new modified time)', () => {
    expect(isCachedHashStale({ size: 10, modifiedTime: T0 }, { size: 10, modifiedTime: T1 })).toBe(
      true,
    )
  })

  it('drops the hash when the size changed', () => {
    expect(isCachedHashStale({ size: 10, modifiedTime: T0 }, { size: 11, modifiedTime: T0 })).toBe(
      true,
    )
  })

  it('drops the hash when a timestamp cannot be read', () => {
    expect(
      isCachedHashStale({ size: 10, modifiedTime: 'garbage' }, { size: 10, modifiedTime: T0 }),
    ).toBe(true)
  })

  it('keeps a hash with no in-memory stamp (restored from the sync index)', () => {
    expect(isCachedHashStale(undefined, { size: 10, modifiedTime: T0 })).toBe(false)
  })
})
