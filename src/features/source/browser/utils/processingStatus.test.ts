import { describe, expect, it } from 'vitest'
import type { OperationType } from '@/stores/types'
import { getFolderDescendantOperations, sameOperationSet } from './processingStatus'

describe('getFolderDescendantOperations', () => {
  it('finds a file-list Get Latest under every ancestor folder', () => {
    // Get Latest from the vault header tracks only file paths, never the folders
    const ops = new Map<string, OperationType>([
      ['BAR-XT/CAD/part.sldprt', 'sync'],
      ['BALLAST/top.sldasm', 'sync'],
    ])

    expect([...(getFolderDescendantOperations('BAR-XT', ops) ?? [])]).toEqual(['sync'])
    expect([...(getFolderDescendantOperations('BAR-XT/CAD', ops) ?? [])]).toEqual(['sync'])
    expect([...(getFolderDescendantOperations('BALLAST', ops) ?? [])]).toEqual(['sync'])
  })

  it('leaves folders with nothing in flight beneath them alone', () => {
    const ops = new Map<string, OperationType>([['BAR-XT/CAD/part.sldprt', 'sync']])

    expect(getFolderDescendantOperations('BAR', ops)).toBeNull()
    expect(getFolderDescendantOperations('BAR-X', ops)).toBeNull()
    // The file itself is not a folder above anything
    expect(getFolderDescendantOperations('BAR-XT/CAD/part.sldprt', ops)).toBeNull()
    expect(getFolderDescendantOperations('BAR-XT', new Map())).toBeNull()
  })

  it('does not count the folder itself as its own descendant', () => {
    const ops = new Map<string, OperationType>([['BAR-XT', 'download']])

    expect(getFolderDescendantOperations('BAR-XT', ops)).toBeNull()
  })

  it('collects every operation running beneath a folder', () => {
    const ops = new Map<string, OperationType>([
      ['A/B/one.sldprt', 'sync'],
      ['A/two.sldprt', 'download'],
      ['A/B/C/three.sldprt', 'sync'],
    ])

    expect(new Set(getFolderDescendantOperations('A', ops))).toEqual(
      new Set<OperationType>(['sync', 'download']),
    )
    expect(new Set(getFolderDescendantOperations('A/B', ops))).toEqual(
      new Set<OperationType>(['sync']),
    )
  })

  it('normalizes backslash paths', () => {
    const ops = new Map<string, OperationType>([['A\\B\\one.sldprt', 'checkin']])

    expect(getFolderDescendantOperations('A\\B', ops)?.has('checkin')).toBe(true)
    expect(getFolderDescendantOperations('A', ops)?.has('checkin')).toBe(true)
  })

  it('returns the same set for the same processing map', () => {
    const ops = new Map<string, OperationType>([['A/one.sldprt', 'sync']])

    expect(getFolderDescendantOperations('A', ops)).toBe(getFolderDescendantOperations('A', ops))
  })
})

describe('sameOperationSet', () => {
  it('compares by content and treats empty as null', () => {
    expect(
      sameOperationSet(new Set<OperationType>(['sync']), new Set<OperationType>(['sync'])),
    ).toBe(true)
    expect(
      sameOperationSet(new Set<OperationType>(['sync']), new Set<OperationType>(['download'])),
    ).toBe(false)
    expect(sameOperationSet(null, new Set<OperationType>())).toBe(true)
    expect(sameOperationSet(null, new Set<OperationType>(['sync']))).toBe(false)
    expect(sameOperationSet(undefined, null)).toBe(true)
  })
})
