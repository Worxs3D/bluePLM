/**
 * Sync-index repair for BluePLM's "Re-align with server" feature.
 *
 * The IndexedDB sync index (`src/lib/cache/localSyncIndex.ts`) is derived state - every field
 * in it can be recomputed from the files the vault currently holds - which is exactly what makes
 * rebuilding it safe: there is no user data in it to lose. But "safe to rebuild" is not the same
 * as "safe to clear and rebuild". The index carries two kinds of entry that a naive
 * clear-and-rewrite would destroy:
 *
 * - `orphanedAt` tombstones, the only record that a file still on disk was *ever* on the
 *   server. Drop one and the next load cannot tell a genuine orphan from a file the user just
 *   authored - it reclassifies as `added`, which is the exact pre-4.3.0 damage three releases
 *   have gone into cleaning up (see `.cursor/plans/orphaned-file-rows-report.md`).
 * - `localOnly` entries, which pin an inode for rename detection and are explicitly *not*
 *   evidence of a sync (`getSyncIndex`'s doc comment in `localSyncIndex.ts`).
 *
 * So this module never clears anything. It only ever:
 * 1. Adds an entry for a currently server-backed file that the index does not yet know about.
 * 2. Removes an entry that is neither tombstoned nor `localOnly` and no longer matches any
 *    server-backed file - stale bookkeeping a bug could have left behind, not a real record.
 * 3. Re-stamps the inode, `localVersion` and `localHash` for every server-backed file from
 *    current truth, via the same `removeFromSyncIndex(old) -> addToSyncIndex(new) ->
 *    updateInodes(new, ino)` sequence `adoptServerPaths.ts` already uses to re-key a move.
 *
 * `getSyncIndex` already excludes `localOnly` entries and expired tombstones from the map it
 * returns, and this module never asks for anything more than that map - so a `localOnly` entry
 * is invisible to the diff below and is therefore never touched, and a tombstone is skipped by
 * an explicit check rather than by omission.
 */

import { log } from '@/lib/logger'
import {
  addToSyncIndex,
  getSyncIndex,
  removeFromSyncIndex,
  updateInodes,
} from '@/lib/cache/localSyncIndex'
import type { LocalFile } from '@/stores/types'
import type { AlignmentStepResult } from '@/types/realign'

function logSyncIndexRepair(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
): void {
  log[level]('[SyncIndexRepair]', message, context)
}

export interface SyncIndexRepairContext {
  vaultId: string
  /** The vault's current files, as `applyAlignment`'s caller sees them right now. */
  files: LocalFile[]
}

/**
 * Whether this row's `relativePath` is current truth the sync index should agree with: a file
 * with a server record whose path is not mid-repair by some other step. `moved` and
 * `moved_away` are deliberately excluded - if `resolvePendingMoves` did not run, or ran and
 * failed, the file's `relativePath` is not yet the path the server records for it, and writing
 * it into the index here would tombstone the *correct* path out from under a later load the
 * next time `updateSyncIndexFromServer` runs. `resolvePendingMoves` re-keys the index itself
 * (via `adoptServerPaths.ts`'s `reKeySyncIndexAfterAdopt`) once a move actually resolves, which
 * is the only place that transition is safe to make.
 */
function isCurrentServerBackedFile(file: LocalFile): boolean {
  if (file.isDirectory) return false
  if (!file.pdmData?.id) return false
  return file.diffStatus === undefined || file.diffStatus === 'outdated' || file.diffStatus === 'modified'
}

/**
 * Repair the sync index against the vault's current files, preserving every tombstone and
 * every `localOnly` entry untouched. See the module doc comment for why a clear-and-rebuild is
 * never an option here.
 */
export async function repairSyncIndex(ctx: SyncIndexRepairContext): Promise<AlignmentStepResult> {
  const step: AlignmentStepResult['step'] = 'rebuildSyncIndex'

  const targets = ctx.files.filter(isCurrentServerBackedFile)
  const targetsByLowerPath = new Map(targets.map((file) => [file.relativePath.toLowerCase(), file]))

  // `getSyncIndex` already drops `localOnly` entries and tombstones past their TTL before this
  // function ever sees them - so neither category is ever a candidate for removal below.
  const indexedPaths = await getSyncIndex(ctx.vaultId)

  const missingPaths = targets.filter((file) => !indexedPaths.has(file.relativePath.toLowerCase()))

  // A non-tombstoned index entry that matches no current server-backed file is stale
  // bookkeeping, not a tombstone and not `localOnly` (both already excluded by `getSyncIndex`),
  // so removing it recovers correctness without touching either protected category.
  const stalePaths: string[] = []
  for (const [path, info] of indexedPaths) {
    if (info.orphanedAt !== undefined) continue
    if (targetsByLowerPath.has(path)) continue
    stalePaths.push(path)
  }

  if (stalePaths.length === 0 && missingPaths.length === 0 && targets.length === 0) {
    logSyncIndexRepair('info', 'Nothing to repair', { vaultId: ctx.vaultId })
    return { step, attempted: 0, succeeded: 0, failed: 0, skipped: 0, outcome: 'nothing-to-do' }
  }

  if (stalePaths.length > 0) {
    await removeFromSyncIndex(ctx.vaultId, stalePaths)
  }

  if (missingPaths.length > 0) {
    await addToSyncIndex(
      ctx.vaultId,
      missingPaths.map((file) => file.relativePath),
    )
  }

  // Re-stamp every server-backed file's inode, localVersion and localHash from current truth,
  // not only the ones just added - a file already in the index can still hold a stale inode
  // from before a checkout, a get-latest, or an external edit.
  const inodeEntries = targets
    .filter((file): file is LocalFile & { ino: number } => typeof file.ino === 'number' && file.ino > 0)
    .map((file) => ({
      path: file.relativePath,
      ino: file.ino,
      localVersion: file.localVersion,
      localHash: file.localHash,
    }))

  if (inodeEntries.length > 0) {
    await updateInodes(ctx.vaultId, inodeEntries)
  }

  logSyncIndexRepair('info', 'Sync index repaired', {
    vaultId: ctx.vaultId,
    targets: targets.length,
    added: missingPaths.length,
    removedStale: stalePaths.length,
    restamped: inodeEntries.length,
  })

  return {
    step,
    attempted: targets.length,
    succeeded: targets.length,
    failed: 0,
    skipped: 0,
    outcome: 'ok',
  }
}
