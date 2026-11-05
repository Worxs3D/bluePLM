import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/reviews', () => ({ getVersionDependencyClosure: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))

import type { DependencyClosureRow } from '@/types/reviews'

import { isReferencedByRelease, REFERENCED_BY_RELEASE } from './deleteRefusal'
import { freezeCacheSize, freezeStatusOf, getFreezeStatus, resetFreezeCache } from './freeze'
import { findApproximateReleases, hasFreezableReferences } from './releaseCheck'

function row(extra: Partial<DependencyClosureRow>): DependencyClosureRow {
  return {
    depth: 1,
    parentVersionId: 'root',
    fileId: 'f',
    fileVersionId: 'v',
    referencePath: 'A/b.sldprt',
    configuration: null,
    referenceType: 'component',
    quantity: 1,
    exact: true,
    edgeSource: 'recorded',
    missing: false,
    version: 1,
    revision: 'A',
    contentHash: 'h',
    fileSize: 1,
    fileName: 'b.sldprt',
    filePath: 'A/b.sldprt',
    extension: '.sldprt',
    vaultId: null,
    deleted: false,
    ...extra,
  }
}

const rootRow = row({ depth: 0, parentVersionId: null, edgeSource: 'root' })

describe('freezeStatusOf', () => {
  it('is frozen when every edge is exact and nothing is missing', () => {
    expect(freezeStatusOf([rootRow, row({})])).toBe('frozen')
    expect(freezeStatusOf([rootRow])).toBe('frozen')
  })

  it('is approximate when any edge came from the fallback', () => {
    expect(freezeStatusOf([rootRow, row({ exact: false, edgeSource: 'fallback' })])).toBe('approximate')
  })

  it('names references the vault has no version of', () => {
    expect(freezeStatusOf([rootRow, row({ missing: true, fileVersionId: null })])).toBe('missing')
  })
})

describe('getFreezeStatus', () => {
  beforeEach(() => resetFreezeCache())

  it('reads a version once and answers from the cache after', async () => {
    const closure = vi.fn(async () => [rootRow, row({})])
    const deps = { closure, now: () => 0 }
    expect(await getFreezeStatus('a', deps)).toBe('frozen')
    expect(await getFreezeStatus('a', deps)).toBe('frozen')
    expect(closure).toHaveBeenCalledTimes(1)
  })

  it('reads an approximate answer again once it is old', async () => {
    let now = 0
    const closure = vi.fn(async () => [rootRow, row({ exact: false })])
    const deps = { closure, now: () => now }
    await getFreezeStatus('a', deps)
    now = 60 * 1000
    await getFreezeStatus('a', deps)
    expect(closure).toHaveBeenCalledTimes(1)
    now = 10 * 60 * 1000
    await getFreezeStatus('a', deps)
    expect(closure).toHaveBeenCalledTimes(2)
  })

  it('stays bounded', async () => {
    const deps = { closure: async () => [rootRow], now: () => 0 }
    for (let i = 0; i < 600; i++) await getFreezeStatus(`v${i}`, deps)
    expect(freezeCacheSize()).toBe(500)
  })

  it('runs at most four reads at once', async () => {
    let running = 0
    let peak = 0
    const closure = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return [rootRow]
    }
    await Promise.all(Array.from({ length: 12 }, (_, i) => getFreezeStatus(`p${i}`, { closure, now: () => 0 })))
    expect(peak).toBe(4)
  })
})

describe('findApproximateReleases', () => {
  it('checks assemblies and drawings only and reports the approximate ones', async () => {
    const versionIds = vi.fn(async (cs: readonly { fileId: string }[]) => {
      return new Map(cs.map((c, i) => [c.fileId, { id: `ver-${c.fileId}`, version: i + 1 }]))
    })
    const freezeStatus = vi.fn(async (id: string) => (id === 'ver-asm' ? ('approximate' as const) : ('frozen' as const)))
    const result = await findApproximateReleases(
      [
        { name: 'Frame.SLDASM', fileId: 'asm', version: 4 },
        { name: 'Frame.SLDDRW', fileId: 'drw', version: 2 },
        { name: 'Bolt.SLDPRT', fileId: 'prt', version: 1 },
      ],
      { versionIds, freezeStatus },
    )
    expect(versionIds.mock.calls[0][0].map((c) => c.fileId)).toEqual(['asm', 'drw'])
    expect(result).toEqual([{ name: 'Frame.SLDASM', fileId: 'asm', version: 1, fileVersionId: 'ver-asm' }])
  })

  it('never blocks a release on a read error', async () => {
    const result = await findApproximateReleases([{ name: 'a.sldasm', fileId: 'x', version: 1 }], {
      versionIds: async () => {
        throw new Error('offline')
      },
      freezeStatus: async () => 'approximate',
    })
    expect(result).toEqual([])
    const second = await findApproximateReleases([{ name: 'a.sldasm', fileId: 'x', version: 1 }], {
      versionIds: async () => new Map([['x', { id: 'vx', version: 1 }]]),
      freezeStatus: async () => {
        throw new Error('offline')
      },
    })
    expect(second).toEqual([])
  })

  it('names the files whose references a release freezes', () => {
    expect(hasFreezableReferences('a.SLDASM')).toBe(true)
    expect(hasFreezableReferences('a.slddrw')).toBe(true)
    expect(hasFreezableReferences('a.sldprt')).toBe(false)
  })
})

describe('isReferencedByRelease', () => {
  it('recognises the database refusal by its hint or message', () => {
    expect(isReferencedByRelease({ hint: REFERENCED_BY_RELEASE, message: 'x' })).toBe(true)
    expect(isReferencedByRelease({ message: `refused (${REFERENCED_BY_RELEASE})` })).toBe(true)
    expect(isReferencedByRelease({ hint: 'RELEASED', message: 'x' })).toBe(false)
    expect(isReferencedByRelease(null)).toBe(false)
  })
})
