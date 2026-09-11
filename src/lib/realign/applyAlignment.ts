/**
 * Apply step for BluePLM's "Re-align with server" feature.
 *
 * `analyzeAlignment` (a sibling module, built in parallel) is a pure classification: it never
 * touches disk, the server, or the store. This module is the write path - it takes the user's
 * ticked `AlignmentPlan` and executes it by composing commands that already exist and are
 * already guarded, in the order the plan requires, and reports what happened in the
 * machine-readable shape `src/types/realign.ts` defines. It performs no filesystem or server
 * I/O of its own; every actual write happens inside `adopt-server-paths`, `discard-orphaned` or
 * `get-latest`.
 *
 * ## Why this is a plain function, not a registered command
 *
 * `executeCommand` routes `download`, `get-latest`, `discard`, `checkout`, `checkin`, `sync` and
 * `force-release` through a serial queue (`QUEUED_FILE_OPERATIONS` in `executor.ts`) so they
 * never run concurrently. `applyAlignment` calls `executeCommand('get-latest', ...)` and
 * `executeCommand('discard-orphaned', ...)` itself. If `applyAlignment` were registered as a
 * command and invoked through `executeCommand('re-align', ...)`, a `get-latest` call from
 * *inside* its `execute` would try to enqueue behind the very operation that is running it -
 * the queue only starts the next entry once the current one's `execute` promise settles, so
 * this would deadlock forever. Do not "tidy" this into a registered command; it must be called
 * directly by the UI, from outside the queue, exactly as written here.
 *
 * ## Why the step order is fixed
 *
 * 1. `resolvePendingMoves` first, because it changes which local path a file's content sits at,
 *    and orphan detection in step 2 depends on that answer being settled. When the plan omits
 *    `pendingMoveActions`, this is still vault-wide `adopt-server-paths` (server wins), the
 *    original bulk default. When the user has named per-file keep-server / keep-local choices,
 *    the step splits: adopt the keep-server ids, then reconcile the keep-local ids. Reconcile
 *    is only reached for files the user explicitly kept local — an unchecked bulk still never
 *    writes one machine's rename to the server.
 * 2. `recycleOrphans` (`discard-orphaned`) second, now that step 1 has resolved any move that
 *    would otherwise look like a delete-and-recreate.
 * 3. `pullOutdated` (`get-latest`) third, restricted to rows with no checkout of any kind - see
 *    `selectOutdatedFiles` below.
 * 4. `rebuildSyncIndex` last, so it re-stamps against the files the first three steps just
 *    finished correcting rather than against a state about to change underneath it.
 *
 * A normal step failure (a `CommandResult` with `success: false`) never stops the run - it is
 * recorded and the next step still runs. Only a thrown, unexpected error aborts the remaining
 * steps, because at that point nothing about the vault's state is known to be safe to act on.
 */

import { log } from '@/lib/logger'
import { getSyncIndex } from '@/lib/cache/localSyncIndex'
import { executeCommand } from '@/lib/commands/executor'
import type { CommandResult } from '@/lib/commands/types'
import { isAutomaticDiscardCoolingDown } from '@/lib/commands/handlers/discardOrphaned'
import { runAutoDiscardForOrphans, shouldSkipAutoDiscardForOrphans } from '@/hooks/useLoadFiles'
import type { LocalFile } from '@/stores/types'
import type {
  AlignmentOutcome,
  AlignmentPlan,
  AlignmentStepId,
  AlignmentStepResult,
  PendingMoveAction,
} from '@/types/realign'

import { repairSyncIndex } from './syncIndexRepair'

function logApplyAlignment(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
): void {
  log[level]('[ApplyAlignment]', message, context)
}

/**
 * Everything `applyAlignment` needs that is not already reachable through `executeCommand`'s
 * own store snapshot. Deliberately explicit and small - no store access from module scope - so
 * a caller (the UI, or a test) can see exactly what this function depends on.
 */
export interface ApplyAlignmentContext {
  /** `null` when no vault is active; the run aborts immediately rather than acting on nothing. */
  vaultId: string | null
  /**
   * The vault's current files. Used only to derive which rows each step should target - never
   * mutated directly here; every write goes through a command.
   */
  files: LocalFile[]
  /** `serverFiles.length` for the active vault - the blast-radius guard's denominator partner. */
  serverFileCount: number
  /** Mirrors `operationsSlice`'s `isOperationRunning`. */
  isOperationRunning: boolean
  /** Mirrors `operationsSlice`'s `operationQueue.length`. */
  operationQueueLength: number
  /** Called exactly once, after every requested step has run (or the run has aborted). */
  onRefresh: () => void
}

/** Rows `discard-orphaned` should recycle: local files the server no longer has a row for. */
function selectOrphanedFiles(files: readonly LocalFile[]): LocalFile[] {
  return files.filter((file) => !file.isDirectory && file.diffStatus === 'deleted_remote')
}

/**
 * Rows `get-latest` may safely overwrite: outdated locally, and not checked out by anyone.
 * A checkout - even the current user's own - is excluded, matching `analyzeAlignment`'s
 * `outdated` bucket rule: pulling the server's newer copy while a checkout is open risks
 * clobbering in-progress work that has not yet surfaced as a local edit.
 */
function selectOutdatedFiles(files: readonly LocalFile[]): LocalFile[] {
  return files.filter(
    (file) => !file.isDirectory && file.diffStatus === 'outdated' && !file.pdmData?.checked_out_by,
  )
}

/**
 * Maps one command's result onto the frozen `AlignmentStepResult` shape.
 *
 * - `attempted === 0` means the command found nothing to do (`'nothing-to-do'`).
 * - `succeeded === 0 && failed === 0` with a non-zero `attempted` means the command identified
 *   work but declined to run it - a validation refusal, a blocked-checkout holdout, or a
 *   declined confirmation - which this reports as `'refused'` rather than `'failed'`, since
 *   nothing was actually attempted and nothing was lost.
 * - A full, clean success is `'ok'`; a mix of successes and failures is `'partial'`; an outright
 *   failure (something attempted, nothing succeeded) is `'failed'`.
 */
function toStepResult(step: AlignmentStepId, result: CommandResult): AlignmentStepResult {
  const attempted = result.total
  const succeeded = result.succeeded
  const failed = result.failed

  let outcome: AlignmentStepResult['outcome']
  if (attempted === 0) {
    outcome = 'nothing-to-do'
  } else if (succeeded === 0 && failed === 0) {
    outcome = 'refused'
  } else if (result.success && failed === 0) {
    outcome = 'ok'
  } else if (succeeded > 0) {
    outcome = 'partial'
  } else {
    outcome = 'failed'
  }

  const skipped = result.skipped ?? (outcome === 'refused' ? attempted : 0)

  return { step, attempted, succeeded, failed, skipped, outcome, detail: result.message }
}

function nothingToDoStep(step: AlignmentStepId): AlignmentStepResult {
  return { step, attempted: 0, succeeded: 0, failed: 0, skipped: 0, outcome: 'nothing-to-do' }
}

/** A guard refused before anything was attempted - every candidate counted as `skipped`. */
function refusedStep(step: AlignmentStepId, attempted: number, detail: string): AlignmentStepResult {
  return { step, attempted, succeeded: 0, failed: 0, skipped: attempted, outcome: 'refused', detail }
}

function splitPendingMoveActions(
  actions: Record<string, PendingMoveAction>,
): { adoptIds: string[]; reconcileIds: string[] } {
  const adoptIds: string[] = []
  const reconcileIds: string[] = []

  for (const [fileId, action] of Object.entries(actions)) {
    if (action === 'adopt') adoptIds.push(fileId)
    else reconcileIds.push(fileId)
  }

  return { adoptIds, reconcileIds }
}

function combineCommandResults(first: CommandResult, second: CommandResult): CommandResult {
  return {
    success: first.success && second.success,
    message: [first.message, second.message].filter(Boolean).join('; '),
    total: first.total + second.total,
    succeeded: first.succeeded + second.succeeded,
    failed: first.failed + second.failed,
    skipped: (first.skipped ?? 0) + (second.skipped ?? 0),
  }
}

/**
 * Step 1: resolve pending moves in the direction the user chose per file.
 *
 * `apply: true` is passed unconditionally - anything short of that would only run the
 * pre-flight and report, never write. `force` is deliberately omitted (defaults to `false`):
 * a target held by another user's checkout is safe to touch (it only renames this user's own
 * disk) but is still evidence a move may already be mid-flight elsewhere, so a bulk, unattended
 * re-align leaves it for the user to force explicitly if they choose to. Keep-local files pass
 * `skipCheckedOut: true` for the same reason: a race that puts someone else's checkout on a
 * named file skips that file rather than refusing the whole step.
 *
 * Adopt runs first so disk paths settle before any keep-local write, matching the original
 * "moves before orphans" order. The two id sets are disjoint by construction.
 */
async function runResolvePendingMoves(plan: AlignmentPlan): Promise<AlignmentStepResult> {
  if (plan.pendingMoveActions === undefined) {
    const result = await executeCommand('adopt-server-paths', { apply: true })
    return toStepResult('resolvePendingMoves', result)
  }

  const { adoptIds, reconcileIds } = splitPendingMoveActions(plan.pendingMoveActions)
  const results: CommandResult[] = []

  if (adoptIds.length > 0) {
    results.push(await executeCommand('adopt-server-paths', { apply: true, fileIds: adoptIds }))
  }

  if (reconcileIds.length > 0) {
    results.push(
      await executeCommand('reconcile-moved-paths', {
        apply: true,
        fileIds: reconcileIds,
        skipCheckedOut: true,
      }),
    )
  }

  if (results.length === 0) {
    return nothingToDoStep('resolvePendingMoves')
  }

  const combined =
    results.length === 1 ? results[0] : combineCommandResults(results[0], results[1])
  return toStepResult('resolvePendingMoves', combined)
}

/**
 * Step 2: recycle local files the server no longer has a row for.
 *
 * Honours the same three guards that already protect the automatic discard-on-load path, by
 * calling into their existing implementations rather than re-deriving them:
 * - `shouldSkipAutoDiscardForOrphans` - the blast-radius guard. Refuses when the orphan count
 *   looks like a truncated server response rather than a real mass deletion.
 * - `isAutomaticDiscardCoolingDown` - refuses for a vault still in the post-all-skipped
 *   cooldown from a previous automatic batch.
 * - `runAutoDiscardForOrphans`'s re-entrancy guard - refuses a second concurrent discard for
 *   the same vault.
 *
 * Runs `discard-orphaned` with `isAutomatic: true`. That is a deliberate choice, not the only
 * option - see `.cursor/plans/realign-agent2-report.md` for why - but it is the one that keeps
 * `deleteBatch` (`electron/handlers/fs.ts`) on its non-destructive fallback when the Recycle Bin
 * is unavailable, instead of the user-initiated path's permanent-delete fallback. A bulk
 * re-align must never permanently delete: the server row is already gone, so there would be
 * nothing left to restore from.
 */
async function runRecycleOrphans(ctx: {
  vaultId: string
  files: readonly LocalFile[]
  serverFileCount: number
}): Promise<AlignmentStepResult> {
  const step: AlignmentStepId = 'recycleOrphans'
  const orphanedFiles = selectOrphanedFiles(ctx.files)

  if (orphanedFiles.length === 0) {
    return nothingToDoStep(step)
  }

  if (isAutomaticDiscardCoolingDown(ctx.vaultId)) {
    logApplyAlignment('info', 'Refused: cooling down after an earlier all-skipped batch', {
      vaultId: ctx.vaultId,
      count: orphanedFiles.length,
    })
    return refusedStep(step, orphanedFiles.length, 'cooling-down')
  }

  const previouslySyncedCount = (await getSyncIndex(ctx.vaultId)).size
  if (
    shouldSkipAutoDiscardForOrphans({
      serverRowCount: ctx.serverFileCount,
      previouslySyncedCount,
      orphanCount: orphanedFiles.length,
    })
  ) {
    logApplyAlignment(
      'warn',
      'Refused: server view looks lost rather than the vault having emptied',
      {
        vaultId: ctx.vaultId,
        orphanCount: orphanedFiles.length,
        serverRowCount: ctx.serverFileCount,
        previouslySyncedCount,
      },
    )
    return refusedStep(step, orphanedFiles.length, 'blast-radius-guard')
  }

  let commandResult: CommandResult | undefined
  const runResult = await runAutoDiscardForOrphans(ctx.vaultId, orphanedFiles, async (files) => {
    commandResult = await executeCommand('discard-orphaned', { files, isAutomatic: true })
  })

  if (runResult === 'skipped-in-flight') {
    logApplyAlignment(
      'info',
      'Refused: another automatic discard is already running for this vault',
      { vaultId: ctx.vaultId },
    )
    return refusedStep(step, orphanedFiles.length, 're-entrant')
  }

  if (runResult === 'skipped-empty' || !commandResult) {
    return nothingToDoStep(step)
  }

  return toStepResult(step, commandResult)
}

/**
 * Step 3: download the server's newer copy for outdated, unlocked files only.
 */
async function runPullOutdated(files: readonly LocalFile[]): Promise<AlignmentStepResult> {
  const step: AlignmentStepId = 'pullOutdated'
  const outdatedFiles = selectOutdatedFiles(files)

  if (outdatedFiles.length === 0) {
    return nothingToDoStep(step)
  }

  const result = await executeCommand('get-latest', { files: outdatedFiles })
  return toStepResult(step, result)
}

/**
 * Runs every step the plan has ticked, in the fixed order above, and triggers exactly one
 * refresh at the end - never once per step, so a run that touches all four steps does not
 * repaint the file browser four times.
 *
 * Refuses to start at all (no step runs, nothing changes) when there is no active vault or
 * another bulk operation is already in flight, matching the same "one file operation at a
 * time" rule `executeCommand`'s queue enforces for everything else.
 *
 * A step that reports a normal failure (a `CommandResult` with `success: false`, e.g. a file
 * locked open in SolidWorks) never stops the run - `succeeded`/`failed`/`refused` all still let
 * later steps run, because they are exactly what this feature exists to report. Only a thrown,
 * unexpected error aborts the remaining steps: at that point nothing about the vault's state
 * is known to be safe to keep acting on, and the outcome reports `abortReason:
 * 'unexpected-error'` rather than pretending later steps still make sense.
 */
export async function applyAlignment(
  plan: AlignmentPlan,
  ctx: ApplyAlignmentContext,
): Promise<AlignmentOutcome> {
  const ranAt = new Date().toISOString()

  if (!ctx.vaultId) {
    logApplyAlignment('warn', 'Refused to start: no active vault', {})
    return { ranAt, steps: [], aborted: true, abortReason: 'no-vault' }
  }

  if (ctx.isOperationRunning || ctx.operationQueueLength > 0) {
    logApplyAlignment('info', 'Refused to start: another bulk operation is in flight', {
      vaultId: ctx.vaultId,
      isOperationRunning: ctx.isOperationRunning,
      operationQueueLength: ctx.operationQueueLength,
    })
    return { ranAt, steps: [], aborted: true, abortReason: 'operation-in-flight' }
  }

  const vaultId = ctx.vaultId
  const steps: AlignmentStepResult[] = []

  try {
    if (plan.resolvePendingMoves) {
      steps.push(await runResolvePendingMoves(plan))
    }

    if (plan.recycleOrphans) {
      steps.push(
        await runRecycleOrphans({
          vaultId,
          files: ctx.files,
          serverFileCount: ctx.serverFileCount,
        }),
      )
    }

    if (plan.pullOutdated) {
      steps.push(await runPullOutdated(ctx.files))
    }

    if (plan.rebuildSyncIndex) {
      steps.push(await repairSyncIndex({ vaultId, files: ctx.files }))
    }
  } catch (error) {
    logApplyAlignment('error', 'Unexpected error - aborting remaining steps', {
      vaultId,
      completedSteps: steps.map((s) => s.step),
      error: error instanceof Error ? error.message : String(error),
    })
    ctx.onRefresh()
    return { ranAt, steps, aborted: true, abortReason: 'unexpected-error' }
  }

  logApplyAlignment('info', 'Run complete', {
    vaultId,
    steps: steps.map((s) => ({ step: s.step, outcome: s.outcome })),
  })

  ctx.onRefresh()
  return { ranAt, steps, aborted: false }
}
