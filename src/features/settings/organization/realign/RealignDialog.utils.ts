// src/features/settings/organization/realign/RealignDialog.utils.ts
import type {
  AlignmentBucket,
  AlignmentBucketId,
  AlignmentDisposition,
  AlignmentItem,
  AlignmentPlan,
  AlignmentStepId,
} from '@/types/realign'

/** Display sample rows are capped further than `ALIGNMENT_SAMPLE_LIMIT` for a compact dialog. */
export const REALIGN_DISPLAY_SAMPLE_LIMIT = 5

/** i18n key fragment for each bucket, e.g. `pending_move` -> `pendingMove`. */
const BUCKET_KEY_FRAGMENT: Record<AlignmentBucketId, string> = {
  pending_move: 'pendingMove',
  orphaned: 'orphaned',
  outdated: 'outdated',
  cloud_only: 'cloudOnly',
  local_only: 'localOnly',
  modified: 'modified',
  ghost: 'ghost',
  ignored: 'ignored',
  blocked_checkout: 'blockedCheckout',
}

/** The `realign.<fragment>` prefix this bucket's copy lives under. */
export function bucketKeyFragment(id: AlignmentBucketId): string {
  return BUCKET_KEY_FRAGMENT[id]
}

/** `count === 1` selects the `_one` suffix, matching every other counted key in this codebase. */
export function pluralSuffix(count: number): '_one' | '_other' {
  return count === 1 ? '_one' : '_other'
}

/** Only these three buckets are `repairable`, and each maps to exactly one `AlignmentPlan` flag. */
export const REPAIRABLE_BUCKET_TO_PLAN_KEY: Partial<Record<AlignmentBucketId, AlignmentStepId>> = {
  pending_move: 'resolvePendingMoves',
  orphaned: 'recycleOrphans',
  outdated: 'pullOutdated',
}

/** Groups the report's buckets by disposition, preserving the report's own display order. */
export function groupBucketsByDisposition(
  buckets: AlignmentBucket[],
): Record<AlignmentDisposition, AlignmentBucket[]> {
  const groups: Record<AlignmentDisposition, AlignmentBucket[]> = {
    repairable: [],
    needs_decision: [],
    informational: [],
  }
  for (const bucket of buckets) {
    groups[bucket.disposition].push(bucket)
  }
  return groups
}

/** The plan the dialog opens with: every repair on, index rebuild on. */
export function defaultAlignmentPlan(): AlignmentPlan {
  return {
    resolvePendingMoves: true,
    recycleOrphans: true,
    pullOutdated: true,
    rebuildSyncIndex: true,
  }
}

/** True once at least one repairable bucket's checkbox is ticked — gates the run button. */
export function hasAnyRepairSelected(plan: AlignmentPlan): boolean {
  return plan.resolvePendingMoves || plan.recycleOrphans || plan.pullOutdated
}

export interface SampleDisplay {
  shown: AlignmentItem[]
  /** `bucket.count - shown.length` — never `bucket.sample.length - shown.length`. The sample is
   * already capped at `ALIGNMENT_SAMPLE_LIMIT` before it reaches here, so deriving "more" from
   * `sample.length` would silently under-report once a bucket exceeds that cap. */
  moreCount: number
}

/** What the needs-decision list shows for one bucket: a short preview, and an honest "more". */
export function computeSampleDisplay(
  bucket: AlignmentBucket,
  limit: number = REALIGN_DISPLAY_SAMPLE_LIMIT,
): SampleDisplay {
  const shown = bucket.sample.slice(0, limit)
  return { shown, moreCount: bucket.count - shown.length }
}

/**
 * `blocked_checkout` holds two different situations - another user's checkout, and the
 * current user's own checkout on an `outdated` row (see `AlignmentBucketId`'s doc comment in
 * `src/types/realign.ts`). `bucket.count` never distinguishes them on its own, so the dialog
 * derives the "held by someone else" count from `count - selfHeldCount` rather than assuming
 * the whole bucket is someone else's work in progress.
 */
export function otherHeldCount(bucket: AlignmentBucket): number {
  return bucket.count - bucket.selfHeldCount
}
