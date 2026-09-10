import type { LocalFile } from '@/stores/types'

/**
 * How a group of diverged rows relates to the server, and what re-align is permitted
 * to do about it. The bucket is the unit the UI presents and the orchestrator acts on.
 */
export type AlignmentBucketId =
  /** `moved` + its `moved_away` stub. Repairable: rename local file back to the server's path. */
  | 'pending_move'
  /** `deleted_remote`. Repairable: recycle the local file the server no longer has. */
  | 'orphaned'
  /** `outdated`, no local edit, nobody's checkout. Repairable: pull the server copy. */
  | 'outdated'
  /** `cloud`. Reported only — re-align is not a bulk download. */
  | 'cloud_only'
  /** `added`. Reported only — may be unfinished work that was never checked in. */
  | 'local_only'
  /** `modified`. Reported only — local edits are never discarded. */
  | 'modified'
  /** `deleted` ghost: checked out by me, missing from disk. Needs a decision. */
  | 'ghost'
  /** Matches an ignore pattern. Never touched, never offered. */
  | 'ignored'
  /**
   * Would be repairable, but a checkout stands in the way. Two different situations share
   * this bucket: another user's checkout (blocks `pending_move`, `orphaned`, `outdated`),
   * and the *current* user's own checkout on an `outdated` row (blocked because pulling the
   * server's newer copy over an open checkout risks clobbering in-progress work — see
   * `analyzeAlignment.ts`'s `resolveGuardedBucket`). `AlignmentBucket.selfHeldCount` and each
   * item's `heldByUserId` distinguish the two so the UI does not attribute a self-held row to
   * someone else.
   */
  | 'blocked_checkout'

/** Whether re-align can act on a bucket unattended, or must defer to the user. */
export type AlignmentDisposition =
  /** Re-align can fix this without risking work. Offered as a checkbox, on by default. */
  | 'repairable'
  /** Only the user can decide. Listed with a way to act, never acted on automatically. */
  | 'needs_decision'
  /** Nothing to do. Shown for orientation only. */
  | 'informational'

export interface AlignmentItem {
  /** Stable within one report; safe as a React key. */
  id: string
  relativePath: string
  fileName: string
  /** `files.id`, when the row has a server record. */
  fileId: string | null
  bucket: AlignmentBucketId
  /** Only on `pending_move`: vault-relative path where the content actually is. */
  movedToRelativePath?: string
  /** Only on `blocked_checkout`: display name of the holder, already resolved. */
  heldBy?: string
  heldByUserId?: string
}

export interface AlignmentBucket {
  id: AlignmentBucketId
  disposition: AlignmentDisposition
  /** The truth. Never derive a count from `sample.length`. */
  count: number
  /** Display sample, capped at ALIGNMENT_SAMPLE_LIMIT. */
  sample: AlignmentItem[]
  /**
   * Only meaningful for `blocked_checkout`: how many of `count` are held by the *current*
   * user rather than someone else. Always `0` for every other bucket. Computed against the
   * full row set, not `sample`, so it stays accurate past the `ALIGNMENT_SAMPLE_LIMIT` cap -
   * the UI needs this to avoid telling a user "someone else" has a file only they hold.
   */
  selfHeldCount: number
}

export interface VaultAlignmentReport {
  generatedAt: string
  vaultId: string
  localFileCount: number
  serverFileCount: number
  inSyncCount: number
  /** Always contains every AlignmentBucketId, including empty ones, in display order. */
  buckets: AlignmentBucket[]
  /** True when every `repairable` bucket is empty. */
  isAligned: boolean
}

/** What the user ticked before pressing the button. */
export interface AlignmentPlan {
  resolvePendingMoves: boolean
  recycleOrphans: boolean
  pullOutdated: boolean
  rebuildSyncIndex: boolean
}

export type AlignmentStepId = keyof AlignmentPlan

export interface AlignmentStepResult {
  step: AlignmentStepId
  attempted: number
  succeeded: number
  failed: number
  skipped: number
  /** Machine-readable reason key; the UI maps it to a translated string. */
  outcome: 'ok' | 'partial' | 'failed' | 'nothing-to-do' | 'refused'
  /** Non-translated detail for logs only. Never rendered raw. */
  detail?: string
}

export interface AlignmentOutcome {
  ranAt: string
  steps: AlignmentStepResult[]
  aborted: boolean
  /** Machine-readable key, translated by the UI. */
  abortReason?: 'no-vault' | 'offline' | 'operation-in-flight' | 'cancelled' | 'unexpected-error'
}

export interface AnalyzeAlignmentInput {
  files: LocalFile[]
  serverFileCount: number
  vaultId: string
  currentUserId: string
}

export const ALIGNMENT_SAMPLE_LIMIT = 25
