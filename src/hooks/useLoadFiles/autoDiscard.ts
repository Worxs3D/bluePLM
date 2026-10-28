import { t } from '@/lib/i18n'
import type { LocalFile } from '@/stores/types'

/**
 * How much of the previously-synced file set is allowed to look orphaned in one pass
 * before the auto-discard gate refuses to act on it.
 *
 * A silent refresh trusts the server's file list at face value, which is safe when the
 * list is complete but not when it isn't: a revoked `vault_access` row, an RLS
 * predicate that stops matching, or a SECURITY DEFINER function called with mismatched
 * arguments can all return a successful, error-free response holding far fewer rows
 * than the vault actually has. From this file's position that is indistinguishable
 * from "most of the vault was deleted by another user since the last load" - the two
 * can only be told apart by how implausible the count is. A real bulk deletion large
 * enough to matter (a few thousand files pruned from a 25k-file vault) still passes
 * through at 90%; a broken query landing on empty or near-empty does not reach disk.
 */
const AUTO_DISCARD_MAX_ORPHAN_FRACTION = 0.9

/**
 * Vaults with an automatic discard currently running.
 *
 * `beginWatcherSuppression` (used internally by the discard-orphaned command) already
 * keeps the deletions a discard performs from being read back by the file watcher as
 * external changes and re-triggering another silent refresh - that is the loop the
 * pre-existing `committedMerge && !silent` gate this replaces was guarding against.
 * This set is the second, independent line of defense: it stops *this* code from
 * starting a second discard for the same vault while one it started is still running,
 * so a gap in that suppression (a slow network-drive trash operation, a future caller)
 * degrades into "the next pass finds nothing left to do" rather than into two
 * concurrent batches touching the same files.
 *
 * A time-based debounce was deliberately not used here: a fixed delay would either be
 * too short to matter or long enough to make a real, one-off deletion feel slow to
 * disappear, whereas this only ever blocks the one case that matters - a second pass
 * trying to touch files the first pass has not finished with.
 */
const vaultsWithActiveAutoDiscard = new Set<string>()

/**
 * Run `discard` for a vault's orphan batch, refusing to start a second one for the
 * same vault while the first is still in flight.
 *
 * Exported standalone (no store or React access) so the re-entrancy guard can be
 * proven with a test that never mounts the hook: two overlapping calls for the same
 * vault, around a `discard` that has not resolved yet, must produce exactly one call
 * to it rather than two.
 */
export async function runAutoDiscardForOrphans(
  vaultId: string,
  discardableOrphans: LocalFile[],
  discard: (files: LocalFile[]) => Promise<void>,
): Promise<'skipped-empty' | 'skipped-in-flight' | 'ran'> {
  if (discardableOrphans.length === 0) return 'skipped-empty'

  if (vaultsWithActiveAutoDiscard.has(vaultId)) {
    return 'skipped-in-flight'
  }

  vaultsWithActiveAutoDiscard.add(vaultId)
  try {
    await discard(discardableOrphans)
    return 'ran'
  } finally {
    vaultsWithActiveAutoDiscard.delete(vaultId)
  }
}

/**
 * Orphans that are safe to remove automatically.
 *
 * Two guards apply, and both exist because the local copy may hold work that exists
 * nowhere else - but they do not cover the same ground. The pending-metadata check
 * catches unsaved metadata edits that were never checked in, on any pass.
 * `orphansEditedSinceServerRowLost` is narrower than its name suggests: it compares
 * disk mtime against `syncedPath.orphanedAt`, a tombstone that `updateSyncIndexFromServer`
 * writes only *after* this same pass's classification runs, from an index read at the
 * start of the pass. So on the pass where a file first becomes orphaned, `orphanedAt`
 * is always undefined and this guard cannot fire - it only protects a file that was
 * already orphaned on some earlier pass and has since been edited. A file orphaned and
 * edited in that same first pass is caught only if the edit also left pending metadata
 * behind. An mtime that can't be read counts as "possibly edited" rather than as
 * proof of no edit. Extracted as a pure function so both guards can be tested directly
 * against fixtures instead of through a full load pass.
 */
export function selectDiscardableOrphans(
  orphanedFiles: LocalFile[],
  orphansEditedSinceServerRowLost: ReadonlySet<string>,
): LocalFile[] {
  return orphanedFiles.filter(
    (f) =>
      !orphansEditedSinceServerRowLost.has(f.relativePath.toLowerCase()) &&
      !(f.pendingMetadata && Object.keys(f.pendingMetadata).length > 0),
  )
}

/** What the auto-discard sanity check needs from a completed merge pass. */
export interface AutoDiscardSanityCheckInput {
  /** `pdmFiles.length` from the merge's server-fetch branch; `undefined` when that
   * branch never ran (offline, no org, or a server error - all already safe on their
   * own, since none of them can classify a file as `deleted_remote`). */
  serverRowCount: number | undefined
  /** `localSyncIndex.size` at the top of the same pass: every path ever known to be
   * synced, whether or not it is still present on disk. */
  previouslySyncedCount: number
  /** Files classified `deleted_remote` this pass, before the edited/pending guards. */
  orphanCount: number
}

/**
 * True when the server response this pass merged against looks like a partial or
 * empty view of the vault rather than a genuine mass deletion - see
 * `AUTO_DISCARD_MAX_ORPHAN_FRACTION` for why zero rows is treated as suspicious
 * unconditionally, while a non-zero but truncated response is judged by how much of
 * the previously-synced set it would orphan.
 */
export function shouldSkipAutoDiscardForOrphans({
  serverRowCount,
  previouslySyncedCount,
  orphanCount,
}: AutoDiscardSanityCheckInput): boolean {
  // Nothing to protect (no orphans) or nothing to compare against (a vault that was
  // never synced before can't have a "previously synced" set to have lost sight of).
  if (orphanCount === 0 || previouslySyncedCount === 0) return false

  // `orphanCount` only counts files still present on disk, so a vault where most of
  // the previously-synced set was already cleaned up locally can show zero server
  // rows yet a reassuringly low fraction below. Zero rows therefore trips the guard
  // outright rather than trusting the fraction to catch it.
  if (serverRowCount === 0) return true

  if (serverRowCount === undefined) return false

  return orphanCount / previouslySyncedCount > AUTO_DISCARD_MAX_ORPHAN_FRACTION
}

/**
 * The folder name to put in the discard toast, if every discarded file shares one.
 *
 * Naming a folder is only unambiguous when there is exactly one candidate - a mixed
 * batch, or one that includes a root-level file, falls back to a plain count instead.
 */
export function commonOrphanFolderName(files: LocalFile[]): string | null {
  const topFolders = new Set(
    files.map((f) => {
      const separatorIndex = f.relativePath.indexOf('/')
      return separatorIndex === -1 ? null : f.relativePath.slice(0, separatorIndex)
    }),
  )
  if (topFolders.size !== 1) return null
  const [folder] = topFolders
  return folder
}

/** The non-blocking toast shown after an automatic discard actually removes files. */
export function buildAutoDiscardToastMessage(count: number, folderName: string | null): string {
  // Number morphology (plural noun endings, verb/adjective agreement) is
  // language-specific, so the caller only picks which pre-written form to use -
  // it never assembles one language's grammar for another (see `_one`/`_other`
  // pairs in `src/lib/i18n/locales/*.ts`).
  const suffix = count === 1 ? '_one' : '_other'
  return folderName
    ? t(`autoDiscard.removed.fromFolder${suffix}`, { count, folder: folderName })
    : t(`autoDiscard.removed.generic${suffix}`, { count })
}
