// src/features/settings/organization/realign/RealignDialog.utils.test.ts
//
// This repo's vitest config runs in a plain `node` environment with no `@testing-library/react`
// and no `.test.tsx` glob (see `vitest.config.ts`), so `RealignDialog` itself cannot be rendered
// in a test here. These tests instead exercise the pure logic that drives every behavior the
// task asked to verify — the run button's disabled condition, the "count vs. sample" math, and
// the three-disposition grouping on an all-empty report — since that logic lives in
// `RealignDialog.utils.ts` precisely so it is testable independent of React.
import { describe, expect, it } from 'vitest'

import type { AlignmentBucket, AlignmentBucketId, AlignmentItem, AlignmentPlan } from '@/types/realign'
import { ALIGNMENT_SAMPLE_LIMIT } from '@/types/realign'

import {
  bucketKeyFragment,
  computeSampleDisplay,
  countPendingMoveActions,
  defaultAlignmentPlan,
  defaultPendingMoveActions,
  groupBucketsByDisposition,
  hasAnyRepairSelected,
  mergePendingMoveActions,
  otherHeldCount,
  pluralSuffix,
  REALIGN_DISPLAY_SAMPLE_LIMIT,
  REPAIRABLE_BUCKET_TO_PLAN_KEY,
  setAllPendingMoveActions,
} from './RealignDialog.utils'

const ALL_BUCKET_IDS: AlignmentBucketId[] = [
  'pending_move',
  'orphaned',
  'outdated',
  'cloud_only',
  'local_only',
  'modified',
  'ghost',
  'ignored',
  'blocked_checkout',
]

function emptyBucket(id: AlignmentBucketId, disposition: AlignmentBucket['disposition']): AlignmentBucket {
  return { id, disposition, count: 0, sample: [], selfHeldCount: 0 }
}

/** A report with all nine buckets present and empty — the shape `analyzeAlignment` returns for
 * a vault that is fully in sync, and the shape the dialog must still render three groups for. */
function emptyReportBuckets(): AlignmentBucket[] {
  return [
    emptyBucket('pending_move', 'repairable'),
    emptyBucket('orphaned', 'repairable'),
    emptyBucket('outdated', 'repairable'),
    emptyBucket('cloud_only', 'informational'),
    emptyBucket('local_only', 'needs_decision'),
    emptyBucket('modified', 'needs_decision'),
    emptyBucket('ghost', 'needs_decision'),
    emptyBucket('ignored', 'informational'),
    emptyBucket('blocked_checkout', 'informational'),
  ]
}

function makeItem(bucket: AlignmentBucketId, index: number): AlignmentItem {
  return {
    id: `${bucket}:${index}`,
    relativePath: `folder/file-${index}.txt`,
    fileName: `file-${index}.txt`,
    fileId: `file-id-${index}`,
    bucket,
  }
}

describe('bucketKeyFragment', () => {
  it('maps every bucket id to a distinct camelCase fragment', () => {
    const fragments = ALL_BUCKET_IDS.map(bucketKeyFragment)
    expect(new Set(fragments).size).toBe(ALL_BUCKET_IDS.length)
    expect(fragments).toEqual([
      'pendingMove',
      'orphaned',
      'outdated',
      'cloudOnly',
      'localOnly',
      'modified',
      'ghost',
      'ignored',
      'blockedCheckout',
    ])
  })
})

describe('pluralSuffix', () => {
  it('picks _one only for exactly 1', () => {
    expect(pluralSuffix(1)).toBe('_one')
    expect(pluralSuffix(0)).toBe('_other')
    expect(pluralSuffix(2)).toBe('_other')
    expect(pluralSuffix(25)).toBe('_other')
  })
})

describe('defaultAlignmentPlan', () => {
  it('opens with every repair and the index rebuild ticked on', () => {
    const plan = defaultAlignmentPlan()
    expect(plan).toEqual<AlignmentPlan>({
      resolvePendingMoves: true,
      recycleOrphans: true,
      pullOutdated: true,
      rebuildSyncIndex: true,
    })
  })

  it('returns a fresh object each call, so one dialog session cannot mutate the next', () => {
    expect(defaultAlignmentPlan()).not.toBe(defaultAlignmentPlan())
  })
})

describe('hasAnyRepairSelected — gates the run button', () => {
  it('is false when every repairable flag is off, even if rebuildSyncIndex is on', () => {
    const plan: AlignmentPlan = {
      resolvePendingMoves: false,
      recycleOrphans: false,
      pullOutdated: false,
      rebuildSyncIndex: true,
    }
    expect(hasAnyRepairSelected(plan)).toBe(false)
  })

  it('is true when only one repairable flag is on', () => {
    const base: AlignmentPlan = {
      resolvePendingMoves: false,
      recycleOrphans: false,
      pullOutdated: false,
      rebuildSyncIndex: false,
    }
    expect(hasAnyRepairSelected({ ...base, resolvePendingMoves: true })).toBe(true)
    expect(hasAnyRepairSelected({ ...base, recycleOrphans: true })).toBe(true)
    expect(hasAnyRepairSelected({ ...base, pullOutdated: true })).toBe(true)
  })

  it('is true when the default (all-on) plan is used', () => {
    expect(hasAnyRepairSelected(defaultAlignmentPlan())).toBe(true)
  })
})

describe('groupBucketsByDisposition — the three dialog groups', () => {
  it('renders exactly three groups, each populated, for a normal report', () => {
    const buckets: AlignmentBucket[] = ALL_BUCKET_IDS.map((id, index) => ({
      id,
      disposition:
        index < 3 ? 'repairable' : index < 6 ? 'needs_decision' : 'informational',
      count: index + 1,
      sample: [makeItem(id, index)],
      selfHeldCount: 0,
    }))

    const groups = groupBucketsByDisposition(buckets)

    expect(groups.repairable.map((b) => b.id)).toEqual(['pending_move', 'orphaned', 'outdated'])
    expect(groups.needs_decision.map((b) => b.id)).toEqual(['cloud_only', 'local_only', 'modified'])
    expect(groups.informational.map((b) => b.id)).toEqual(['ghost', 'ignored', 'blocked_checkout'])
  })

  it('still produces all three groups, each with its buckets, when the report is fully empty', () => {
    const groups = groupBucketsByDisposition(emptyReportBuckets())

    expect(groups.repairable).toHaveLength(3)
    expect(groups.needs_decision).toHaveLength(3)
    expect(groups.informational).toHaveLength(3)
    expect(groups.repairable.every((bucket) => bucket.count === 0)).toBe(true)
    expect(groups.needs_decision.every((bucket) => bucket.count === 0)).toBe(true)
    expect(groups.informational.every((bucket) => bucket.count === 0)).toBe(true)
  })

  it('preserves the report\'s own bucket order within each group rather than re-sorting', () => {
    const buckets = emptyReportBuckets()
    const groups = groupBucketsByDisposition(buckets)
    // `orphaned` appears before `outdated` in the report; the group must keep that order.
    const repairableIds = groups.repairable.map((b) => b.id)
    expect(repairableIds.indexOf('orphaned')).toBeLessThan(repairableIds.indexOf('outdated'))
  })
})

describe('REPAIRABLE_BUCKET_TO_PLAN_KEY', () => {
  it('maps exactly the three repairable buckets, and no others', () => {
    expect(REPAIRABLE_BUCKET_TO_PLAN_KEY.pending_move).toBe('resolvePendingMoves')
    expect(REPAIRABLE_BUCKET_TO_PLAN_KEY.orphaned).toBe('recycleOrphans')
    expect(REPAIRABLE_BUCKET_TO_PLAN_KEY.outdated).toBe('pullOutdated')

    for (const id of ALL_BUCKET_IDS) {
      if (id === 'pending_move' || id === 'orphaned' || id === 'outdated') continue
      expect(REPAIRABLE_BUCKET_TO_PLAN_KEY[id]).toBeUndefined()
    }
  })
})

describe('otherHeldCount — self vs. other checkout attribution', () => {
  it('is the full count when nobody self-holds', () => {
    const bucketFixture: AlignmentBucket = {
      id: 'blocked_checkout',
      disposition: 'informational',
      count: 3,
      sample: [],
      selfHeldCount: 0,
    }
    expect(otherHeldCount(bucketFixture)).toBe(3)
  })

  it('subtracts selfHeldCount rather than assuming the whole bucket is someone else\'s', () => {
    const bucketFixture: AlignmentBucket = {
      id: 'blocked_checkout',
      disposition: 'informational',
      count: 5,
      sample: [],
      selfHeldCount: 2,
    }
    expect(otherHeldCount(bucketFixture)).toBe(3)
  })

  it('is zero when every blocked row is the current user\'s own checkout', () => {
    const bucketFixture: AlignmentBucket = {
      id: 'blocked_checkout',
      disposition: 'informational',
      count: 4,
      sample: [],
      selfHeldCount: 4,
    }
    expect(otherHeldCount(bucketFixture)).toBe(0)
  })
})

describe('computeSampleDisplay — count vs. sample rendering', () => {
  it('shows every item and reports zero more when the bucket is small', () => {
    const bucket: AlignmentBucket = {
      id: 'local_only',
      disposition: 'needs_decision',
      count: 3,
      sample: [makeItem('local_only', 0), makeItem('local_only', 1), makeItem('local_only', 2)],
      selfHeldCount: 0,
    }

    const { shown, moreCount } = computeSampleDisplay(bucket)

    expect(shown).toHaveLength(3)
    expect(moreCount).toBe(0)
  })

  it('caps the shown list at the display limit and derives "more" from count, not sample.length', () => {
    // `ALIGNMENT_SAMPLE_LIMIT` (25) caps the sample the analysis hands over; the real count can
    // still be far larger. `moreCount` must reflect that gap, not the (smaller) sample length.
    const sample = Array.from({ length: ALIGNMENT_SAMPLE_LIMIT }, (_, index) =>
      makeItem('local_only', index),
    )
    const bucket: AlignmentBucket = {
      id: 'local_only',
      disposition: 'needs_decision',
      count: 9_000,
      sample,
      selfHeldCount: 0,
    }

    const { shown, moreCount } = computeSampleDisplay(bucket)

    expect(shown).toHaveLength(REALIGN_DISPLAY_SAMPLE_LIMIT)
    // Never derived from sample.length (25): count (9000) minus what is actually shown.
    expect(moreCount).toBe(9_000 - REALIGN_DISPLAY_SAMPLE_LIMIT)
    expect(moreCount).not.toBe(ALIGNMENT_SAMPLE_LIMIT - REALIGN_DISPLAY_SAMPLE_LIMIT)
  })

  it('never shows more than the requested display limit even if the sample is short', () => {
    const bucket: AlignmentBucket = {
      id: 'modified',
      disposition: 'needs_decision',
      count: 2,
      sample: [makeItem('modified', 0), makeItem('modified', 1)],
      selfHeldCount: 0,
    }

    const { shown, moreCount } = computeSampleDisplay(bucket, 1)

    expect(shown).toHaveLength(1)
    expect(moreCount).toBe(1)
  })
})

describe('pending-move per-file actions', () => {
  const items: AlignmentItem[] = [
    { id: 'pending_move:a', relativePath: 'new/a.sldprt', fileName: 'a.sldprt', fileId: 'id-a', bucket: 'pending_move' },
    { id: 'pending_move:b', relativePath: 'new/b.sldprt', fileName: 'b.sldprt', fileId: 'id-b', bucket: 'pending_move' },
    { id: 'pending_move:none', relativePath: 'new/none.sldprt', fileName: 'none.sldprt', fileId: null, bucket: 'pending_move' },
  ]

  it('defaults every named file to adopt and skips rows without a fileId', () => {
    expect(defaultPendingMoveActions(items)).toEqual({ 'id-a': 'adopt', 'id-b': 'adopt' })
  })

  it('keeps existing choices and defaults only new ids', () => {
    const merged = mergePendingMoveActions({ 'id-a': 'reconcile', 'id-gone': 'reconcile' }, items)

    expect(merged).toEqual({ 'id-a': 'reconcile', 'id-b': 'adopt' })
  })

  it('sets every named file to the same action', () => {
    expect(setAllPendingMoveActions(items, 'reconcile')).toEqual({
      'id-a': 'reconcile',
      'id-b': 'reconcile',
    })
  })

  it('counts adopt vs reconcile without treating missing ids as either', () => {
    expect(countPendingMoveActions({ 'id-a': 'adopt', 'id-b': 'reconcile', 'id-c': 'adopt' })).toEqual({
      adopt: 2,
      reconcile: 1,
    })
  })
})
