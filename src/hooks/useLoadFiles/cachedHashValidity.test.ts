import { describe, expect, it } from 'vitest'
import { buildHashStamps, judgeCachedHash, stampOf } from './cachedHashValidity'

const T0 = '2026-10-25T10:00:00.000Z'
const T1 = '2026-10-25T10:05:00.000Z'
const T0_MS = new Date(T0).getTime()

describe('buildHashStamps', () => {
  it('stamps hashed rows by lowercase path and skips folders and unhashed rows', () => {
    const stamps = buildHashStamps(new Map(), [
      {
        relativePath: 'A/Part.SLDPRT',
        isDirectory: false,
        size: 10,
        modifiedTime: T0,
        localHash: 'h',
      },
      { relativePath: 'A/NoHash.SLDPRT', isDirectory: false, size: 10, modifiedTime: T0 },
      { relativePath: 'A', isDirectory: true, size: 0, modifiedTime: T0, localHash: 'h' },
    ])
    expect([...stamps.entries()]).toEqual([['a/part.sldprt', { size: 10, mtimeMs: T0_MS }]])
  })

  it('seeds from the sync index and lets the store row win', () => {
    const saved = new Map([
      ['a/part.sldprt', { localHash: 'h', hashStamp: { size: 5, mtimeMs: 1 } }],
      ['a/other.sldprt', { localHash: 'h', hashStamp: { size: 7, mtimeMs: 2 } }],
      ['a/legacy.sldprt', { localHash: 'h' }],
    ])
    const stamps = buildHashStamps(saved, [
      {
        relativePath: 'A/Part.SLDPRT',
        isDirectory: false,
        size: 10,
        modifiedTime: T0,
        localHash: 'h',
      },
    ])
    expect(stamps.get('a/part.sldprt')).toEqual({ size: 10, mtimeMs: T0_MS })
    expect(stamps.get('a/other.sldprt')).toEqual({ size: 7, mtimeMs: 2 })
    expect(stamps.has('a/legacy.sldprt')).toBe(false)
  })
})

describe('judgeCachedHash', () => {
  const stamp = { size: 10, mtimeMs: T0_MS }

  it('trusts a hash whose file is unchanged, whatever the timestamp format', () => {
    expect(judgeCachedHash('h', stamp, { size: 10, modifiedTime: '2026-10-25T10:00:00Z' })).toBe(
      'trusted',
    )
  })

  it('drops the hash after a save in place (same size, new modified time)', () => {
    expect(judgeCachedHash('h', stamp, { size: 10, modifiedTime: T1 })).toBe('stale')
  })

  it('drops the hash when the size changed', () => {
    expect(judgeCachedHash('h', stamp, { size: 11, modifiedTime: T0 })).toBe('stale')
  })

  it('drops the hash when the scanned time cannot be read', () => {
    expect(judgeCachedHash('h', stamp, { size: 10, modifiedTime: 'garbage' })).toBe('stale')
  })

  it('marks a hash with no stamp as unverified (written before stamps existed)', () => {
    expect(judgeCachedHash('h', undefined, { size: 10, modifiedTime: T0 })).toBe('unverified')
  })

  it('reports nothing cached', () => {
    expect(judgeCachedHash(undefined, stamp, { size: 10, modifiedTime: T0 })).toBe('none')
  })
})

describe('stampOf', () => {
  it('returns undefined for an unreadable time', () => {
    expect(stampOf({ size: 1, modifiedTime: 'nope' })).toBeUndefined()
  })
})
