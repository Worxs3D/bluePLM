/**
 * Pure classification for BluePLM's "re-align with server" feature.
 *
 * `useLoadFiles` has already done the actual work of comparing local disk, the server file
 * list, the IndexedDB sync index and the NTFS inode map, and has stamped every row with a
 * `diffStatus` (`src/stores/types.ts`). This module does not scan anything — it sorts the rows
 * it is handed into the nine buckets `src/types/realign.ts` defines, so the UI (Agent 3) can
 * show the user what disagrees and the orchestrator (Agent 2) can act on the repairable ones.
 * It is the same shape as `classifyAdoptTargets` in
 * `src/lib/commands/handlers/adoptServerPathsPreflight.ts`, deliberately: no store, no
 * filesystem, no clock reads beyond the single `generatedAt` timestamp, so it is cheap enough to
 * re-run on every render and trivial to test with plain fixtures.
 *
 * Pairing `moved` with `moved_away`: a `moved` row (the file's new location) and its
 * `moved_away` stub (rendered at the server's old, now-stale, recorded location) are two rows
 * for one logical divergence, joined by `pdmData.id`. Only the stub carries
 * `LocalFile.movedToRelativePath` — see `.cursor/plans/pending-move-visibility-agent1-report.md`
 * — so the pairing pass below keys the resulting `pending_move` item on the `moved` row (the
 * useful one: it has the file's current name, path and content) and reads the destination off
 * the stub when one is present. A stub with no matching `moved` row in this input (theoretically
 * possible if a caller passes a partial slice of `files`, and exercised directly by this
 * module's own tests) still becomes exactly one `pending_move` item, keyed on the stub itself,
 * so the pair is never silently dropped and never double-counted either way.
 */

import { isCheckoutProfileForOwner } from '@/types/pdm'
import type { LocalFile } from '@/stores/types'
import type {
  AlignmentBucket,
  AlignmentBucketId,
  AlignmentDisposition,
  AlignmentItem,
  AnalyzeAlignmentInput,
  VaultAlignmentReport,
} from '@/types/realign'
import { ALIGNMENT_SAMPLE_LIMIT } from '@/types/realign'

/**
 * Every bucket id, in the stable order the report always presents them — the declaration order
 * of `AlignmentBucketId` in `src/types/realign.ts`. The UI relies on `buckets` containing all
 * nine of these, every time, including the ones with `count === 0`.
 */
const BUCKET_ORDER: readonly AlignmentBucketId[] = [
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

const BUCKET_DISPOSITION: Readonly<Record<AlignmentBucketId, AlignmentDisposition>> = {
  pending_move: 'repairable',
  orphaned: 'repairable',
  outdated: 'repairable',
  cloud_only: 'informational',
  local_only: 'needs_decision',
  modified: 'needs_decision',
  ghost: 'needs_decision',
  ignored: 'informational',
  blocked_checkout: 'informational',
}

/** Who, if anyone, holds the checkout on this row — and their display name, if resolvable. */
interface CheckoutHolder {
  holderId: string
  heldBy?: string
}

/**
 * `pdmData.checked_out_by` names the holder; `pdmData.checked_out_user` is a hydration-order-
 * dependent enrichment of that same field, so it is only trusted once `isCheckoutProfileForOwner`
 * confirms the two agree (mirrors `getCheckoutProfileForOwner` in
 * `src/lib/checkout/checkoutDisplay.ts`, reimplemented here rather than imported so this module
 * carries no dependency that could pull in `t()` from `@/lib/i18n`).
 */
function getCheckoutHolder(file: LocalFile): CheckoutHolder | null {
  const holderId = file.pdmData?.checked_out_by
  if (!holderId) return null

  const profile = file.pdmData?.checked_out_user
  const heldBy = isCheckoutProfileForOwner(profile, holderId)
    ? profile.full_name?.trim() || profile.email?.trim() || undefined
    : undefined

  return { holderId, heldBy }
}

/** A stable React key, unique within one report: the bucket plus whichever identity exists. */
function buildItemId(bucket: AlignmentBucketId, fileId: string | null, relativePath: string): string {
  return `${bucket}:${fileId ?? relativePath}`
}

/** A mutable accumulator for one bucket while the classification pass runs. */
interface BucketAccumulator {
  count: number
  sample: AlignmentItem[]
  /** See `AlignmentBucket.selfHeldCount` - only ever incremented for `blocked_checkout`. */
  selfHeldCount: number
}

function createAccumulators(): Record<AlignmentBucketId, BucketAccumulator> {
  const accumulators = {} as Record<AlignmentBucketId, BucketAccumulator>
  for (const bucketId of BUCKET_ORDER) {
    accumulators[bucketId] = { count: 0, sample: [], selfHeldCount: 0 }
  }
  return accumulators
}

/**
 * Records an item's membership without ever letting `sample` grow past the display cap.
 * `isSelfHeld` is computed against the full row, not the capped sample, so
 * `AlignmentBucket.selfHeldCount` stays accurate no matter how many rows exceed the cap.
 */
function recordItem(
  accumulators: Record<AlignmentBucketId, BucketAccumulator>,
  bucket: AlignmentBucketId,
  item: AlignmentItem,
  isSelfHeld = false,
): void {
  const accumulator = accumulators[bucket]
  accumulator.count += 1
  if (isSelfHeld) accumulator.selfHeldCount += 1
  if (accumulator.sample.length < ALIGNMENT_SAMPLE_LIMIT) {
    accumulator.sample.push(item)
  }
}

/** Whether the given (possibly demoted-to-blocked) holder is the current user themselves. */
function isSelfHeld(holder: CheckoutHolder | null, currentUserId: string): boolean {
  return holder?.holderId === currentUserId
}

/**
 * Classifies one row that would be `pending_move`, `orphaned` or `outdated` absent a checkout,
 * demoting it to `blocked_checkout` when the given holder disqualifies it. `outdated` is
 * stricter than the other two: pulling the server's newer copy while *anyone*, including the
 * current user, holds the checkout risks clobbering work in progress that has not yet shown up
 * as a local edit, so `isBlocking` for `outdated` accepts any holder. `pending_move` and
 * `orphaned` only care about a checkout that belongs to someone else — renaming or recycling a
 * file on this user's own disk is safe regardless of who holds their own lock on it, the same
 * distinction `adoptServerPathsPreflight.ts`'s `classifyAdoptTargets` draws.
 */
function resolveGuardedBucket(
  repairableBucket: 'pending_move' | 'orphaned' | 'outdated',
  holder: CheckoutHolder | null,
  currentUserId: string,
): { bucket: AlignmentBucketId; holder: CheckoutHolder | null } {
  if (!holder) return { bucket: repairableBucket, holder: null }

  const isBlocking = repairableBucket === 'outdated' ? true : holder.holderId !== currentUserId

  return isBlocking
    ? { bucket: 'blocked_checkout', holder }
    : { bucket: repairableBucket, holder: null }
}

function toAlignmentItem(
  bucket: AlignmentBucketId,
  file: LocalFile,
  options: { relativePath?: string; movedToRelativePath?: string; holder?: CheckoutHolder | null } = {},
): AlignmentItem {
  const fileId = file.pdmData?.id ?? null
  const relativePath = options.relativePath ?? file.relativePath

  return {
    id: buildItemId(bucket, fileId, relativePath),
    relativePath,
    fileName: file.name,
    fileId,
    bucket,
    ...(options.movedToRelativePath !== undefined && {
      movedToRelativePath: options.movedToRelativePath,
    }),
    ...(options.holder && {
      heldByUserId: options.holder.holderId,
      ...(options.holder.heldBy !== undefined && { heldBy: options.holder.heldBy }),
    }),
  }
}

/**
 * Pairs every `moved` row with its `moved_away` stub (when one is present in this input) and
 * feeds each pair — or unpaired half — into the accumulators as exactly one `pending_move` or
 * `blocked_checkout` item. The main classification pass below never processes `moved` or
 * `moved_away` rows itself; this function is the only place either status turns into an item.
 */
function classifyPendingMoves(
  rows: readonly LocalFile[],
  currentUserId: string,
  accumulators: Record<AlignmentBucketId, BucketAccumulator>,
): void {
  const stubsByFileId = new Map<string, LocalFile>()
  for (const row of rows) {
    if (row.diffStatus !== 'moved_away') continue
    const fileId = row.pdmData?.id
    if (fileId) stubsByFileId.set(fileId, row)
  }

  const consumedStubs = new Set<LocalFile>()

  for (const row of rows) {
    if (row.diffStatus !== 'moved') continue

    const fileId = row.pdmData?.id
    const stub = fileId ? stubsByFileId.get(fileId) : undefined
    if (stub) consumedStubs.add(stub)

    const holder = getCheckoutHolder(row)
    const { bucket, holder: heldBy } = resolveGuardedBucket('pending_move', holder, currentUserId)

    recordItem(
      accumulators,
      bucket,
      toAlignmentItem(bucket, row, {
        movedToRelativePath: stub?.movedToRelativePath,
        holder: heldBy,
      }),
      isSelfHeld(heldBy, currentUserId),
    )
  }

  // A stub with no `moved` partner in this input still names exactly one pending move — its own
  // `relativePath` is the server's stale record, and `movedToRelativePath` already says where
  // the content went, so nothing is lost by keying the item on the stub instead.
  for (const stub of stubsByFileId.values()) {
    if (consumedStubs.has(stub)) continue

    const holder = getCheckoutHolder(stub)
    const { bucket, holder: heldBy } = resolveGuardedBucket('pending_move', holder, currentUserId)

    recordItem(
      accumulators,
      bucket,
      toAlignmentItem(bucket, stub, {
        movedToRelativePath: stub.movedToRelativePath,
        holder: heldBy,
      }),
      isSelfHeld(heldBy, currentUserId),
    )
    consumedStubs.add(stub)
  }
}

/** Whether this row represents content actually present on the local disk right now. */
function hasLocalPresence(file: LocalFile): boolean {
  // `cloud` and `moved_away` are server-side records with nothing behind them locally; `deleted`
  // is a ghost — checked out by the current user but missing from disk. Every other status,
  // including undefined (no divergence detected), reflects a real file on disk.
  return file.diffStatus !== 'cloud' && file.diffStatus !== 'moved_away' && file.diffStatus !== 'deleted'
}

export function analyzeAlignment(input: AnalyzeAlignmentInput): VaultAlignmentReport {
  const rows = input.files.filter((file) => !file.isDirectory)
  const accumulators = createAccumulators()

  classifyPendingMoves(rows, input.currentUserId, accumulators)

  let localFileCount = 0
  let inSyncCount = 0

  for (const row of rows) {
    if (hasLocalPresence(row)) localFileCount += 1
    if (row.diffStatus == null) inSyncCount += 1

    switch (row.diffStatus) {
      case 'moved':
        // Already classified by classifyPendingMoves above.
        break

      case 'moved_away': {
        // Its pairing was already resolved by classifyPendingMoves — either merged into a
        // `moved` row's item, or (if unpaired) already recorded on its own.
        break
      }

      case 'deleted_remote': {
        const holder = getCheckoutHolder(row)
        const { bucket, holder: heldBy } = resolveGuardedBucket('orphaned', holder, input.currentUserId)
        recordItem(
          accumulators,
          bucket,
          toAlignmentItem(bucket, row, { holder: heldBy }),
          isSelfHeld(heldBy, input.currentUserId),
        )
        break
      }

      case 'outdated': {
        const holder = getCheckoutHolder(row)
        const { bucket, holder: heldBy } = resolveGuardedBucket('outdated', holder, input.currentUserId)
        recordItem(
          accumulators,
          bucket,
          toAlignmentItem(bucket, row, { holder: heldBy }),
          isSelfHeld(heldBy, input.currentUserId),
        )
        break
      }

      case 'cloud':
        recordItem(accumulators, 'cloud_only', toAlignmentItem('cloud_only', row))
        break

      case 'added':
        recordItem(accumulators, 'local_only', toAlignmentItem('local_only', row))
        break

      case 'modified':
        recordItem(accumulators, 'modified', toAlignmentItem('modified', row))
        break

      case 'deleted':
        recordItem(accumulators, 'ghost', toAlignmentItem('ghost', row))
        break

      case 'ignored':
        recordItem(accumulators, 'ignored', toAlignmentItem('ignored', row))
        break

      default:
        // No diffStatus: the row is in sync with the server. Nothing to bucket.
        break
    }
  }

  const buckets: AlignmentBucket[] = BUCKET_ORDER.map((id) => ({
    id,
    disposition: BUCKET_DISPOSITION[id],
    count: accumulators[id].count,
    sample: accumulators[id].sample,
    selfHeldCount: accumulators[id].selfHeldCount,
  }))

  const isAligned = buckets
    .filter((bucket) => bucket.disposition === 'repairable')
    .every((bucket) => bucket.count === 0)

  return {
    generatedAt: new Date().toISOString(),
    vaultId: input.vaultId,
    localFileCount,
    serverFileCount: input.serverFileCount,
    inSyncCount,
    buckets,
    isAligned,
  }
}
