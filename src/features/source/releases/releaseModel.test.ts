import { describe, expect, it } from 'vitest'

import type { VersionRelease } from '@/types/releases'

import {
  activityFileName,
  forcedReleaseOfActivity,
  isDrawingName,
  legacyStateOf,
  normalizeReason,
  pickTransitionToLegacyState,
  refusedReleases,
  releaseBadge,
  releaseOfVersionRow,
} from './releaseModel'

const release = (over: Partial<VersionRelease> = {}): VersionRelease => ({
  fileId: 'f1',
  fileVersionId: 'v5',
  version: 5,
  revision: 'B',
  releasedAt: '2026-11-03T10:00:00Z',
  releasedBy: 'u1',
  forced: false,
  reviewId: 'r1',
  note: null,
  ...over,
})

describe('legacyStateOf', () => {
  it('maps names like file_get_legacy_state()', () => {
    expect(legacyStateOf('Released')).toBe('released')
    expect(legacyStateOf(' Work in  Progress ')).toBe('wip')
    expect(legacyStateOf('In Review')).toBe('in_review')
    expect(legacyStateOf('Archived')).toBe('obsolete')
    expect(legacyStateOf('Approved')).toBeNull()
    expect(legacyStateOf(null)).toBeNull()
  })
})

describe('isDrawingName', () => {
  it('is true for .slddrw only, any case', () => {
    expect(isDrawingName('C:/v/A.SLDDRW')).toBe(true)
    expect(isDrawingName('a.sldprt')).toBe(false)
    expect(isDrawingName(undefined)).toBe(false)
  })
})

describe('pickTransitionToLegacyState', () => {
  const tr = (id: string, name: string) => ({ transition_id: id, to_state_name: name })
  it('returns the single matching transition', () => {
    expect(pickTransitionToLegacyState([tr('a', 'In Review'), tr('b', 'Released')], 'released')).toBe('b')
  })
  it('returns null when none or several match', () => {
    expect(pickTransitionToLegacyState([tr('a', 'In Review')], 'released')).toBeNull()
    expect(pickTransitionToLegacyState([tr('a', 'Released'), tr('b', 'released')], 'released')).toBeNull()
  })
})

describe('refusedReleases', () => {
  it('keeps only failures refused by the release gate', () => {
    const files = refusedReleases([
      { file: 'a', status: 'ok' },
      { file: 'b', status: 'failed', errorCode: 'RELEASE_NOT_REVIEWED' },
      { file: 'c', status: 'failed', errorCode: 'NOT_CHECKED_IN' },
      { file: 'd', status: 'review', errorCode: 'RELEASE_NOT_REVIEWED' },
    ])
    expect(files).toEqual(['b'])
  })
})

describe('normalizeReason', () => {
  it('trims and treats blank as none', () => {
    expect(normalizeReason('  urgent build ')).toBe('urgent build')
    expect(normalizeReason('   ')).toBeNull()
  })
})

describe('releaseOfVersionRow', () => {
  it('reads the 509 release columns', () => {
    const r = releaseOfVersionRow({
      id: 'v5',
      file_id: 'f1',
      version: 5,
      revision: 'B',
      released_at: '2026-11-03T10:00:00Z',
      released_by: 'u1',
      release_forced: true,
      release_review_id: null,
      release_note: 'line down',
    })
    expect(r).toMatchObject({ fileVersionId: 'v5', version: 5, forced: true, note: 'line down', reviewId: null })
  })
  it('is null for an unreleased version or a pre-509 row', () => {
    expect(releaseOfVersionRow({ id: 'v1', version: 1, released_at: null })).toBeNull()
    expect(releaseOfVersionRow({ id: 'v1', version: 1 })).toBeNull()
  })
})

describe('releaseBadge', () => {
  const fmt = () => 'Nov 3'
  it('says Released for a reviewed release', () => {
    expect(releaseBadge(release(), fmt)).toEqual({ label: 'Released', title: 'Released Nov 3', forced: false })
  })
  it('says Released (forced) with the reason', () => {
    const badge = releaseBadge(release({ forced: true, note: ' line down ' }), fmt)
    expect(badge.forced).toBe(true)
    expect(badge.label).toBe('Released (forced)')
    expect(badge.title).toContain('line down')
  })
  it('has a title without a reason when none was stored', () => {
    expect(releaseBadge(release({ forced: true, note: null }), fmt).title).toBe(
      'Released Nov 3 without an approved review',
    )
  })
})

describe('forcedReleaseOfActivity', () => {
  it('reads forced_release details', () => {
    expect(forcedReleaseOfActivity({ forced_release: true, version: 7, revision: 'C', reason: 'x' })).toEqual({
      version: 7,
      revision: 'C',
      reason: 'x',
    })
    expect(forcedReleaseOfActivity({ forced_release: true, version: '3', comment: ' y ' })).toEqual({
      version: 3,
      revision: null,
      reason: 'y',
    })
  })
  it('is null for any other activity', () => {
    expect(forcedReleaseOfActivity({ from_state_id: 'a' })).toBeNull()
    expect(forcedReleaseOfActivity(null)).toBeNull()
    expect(forcedReleaseOfActivity({ forced_release: 'true' })).toBeNull()
  })
})

describe('activityFileName', () => {
  it('reads details.file_name', () => {
    expect(activityFileName({ file_name: 'a.sldprt' })).toBe('a.sldprt')
    expect(activityFileName({})).toBeNull()
  })
})
