/**
 * Forcing a release the release gate refused (schema 509), and what follows a release.
 *
 * The warning opens in its own React root on `document.body`, not inside the context menu that
 * asked for it: the menu closes as soon as an item is clicked, and the bulk state change runs from
 * the file pane after the menu is gone. A promise answers with the reason, or null on cancel.
 */
import { createRoot } from 'react-dom/client'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { executeTransition, getAvailableTransitions } from '@/lib/workflows'
import { generateOutputs } from '@/features/source/outputs/outputCommands'
import { filesNeedingOutput } from '@/features/source/outputs/outputRowModel'
import { ForcedReleaseDialog } from '@/features/source/browser/components/ContextMenu/actions/ForcedReleaseDialog'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import type { TransitionResult } from '@/types/workflow'

import {
  isDrawingName,
  pickTransitionToLegacyState,
  refusedReleases,
  type BulkStateOutcome,
  type LegacyState,
} from './releaseModel'

/** Ask for the reason of a forced release. Resolves with the trimmed reason, or null on cancel. */
export function requestForcedReleaseReason(opts: {
  fileName: string | null
  version: number | null
  count: number
}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let settled = false
    const finish = (reason: string | null) => {
      if (settled) return
      settled = true
      // Unmounting from inside this root's own event handler is deferred, as React requires.
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 0)
      resolve(reason)
    }
    root.render(
      <ForcedReleaseDialog
        fileName={opts.fileName}
        version={opts.version}
        count={opts.count}
        onCancel={() => finish(null)}
        onConfirm={(reason) => finish(reason)}
      />,
    )
  })
}

/** What a target state does to a file entering it (`workflow_state`; `releases_version` is 509). */
export async function readTargetState(stateId: string): Promise<{ isReviewStage: boolean; releasesVersion: boolean }> {
  const { data, error } = await supabase.from('workflow_state').select('*').eq('id', stateId).maybeSingle()
  if (error || !data) {
    if (error) log.warn('[Workflow]', 'Reading the target state failed', { error, stateId })
    return { isReviewStage: false, releasesVersion: false }
  }
  const row = data as unknown as Record<string, unknown>
  return { isReviewStage: row.is_review_stage === true, releasesVersion: row.releases_version === true }
}

/**
 * Queue the PDF and STEP of released drawings for their released version (the newest checked-in
 * one, which the queue resolves when the job starts). Only missing ones: a recorded output of that
 * version is reused, never regenerated.
 */
export function queueReleasedDrawingOutputs(files: readonly LocalFile[]): void {
  const drawings = files.filter((f) => !f.isDirectory && isDrawingName(f.name))
  if (drawings.length === 0) return
  const { fileOutputHeads, outputJobs } = usePDMStore.getState()
  for (const kind of ['pdf', 'step'] as const) {
    const missing = filesNeedingOutput(drawings, kind, fileOutputHeads, outputJobs)
    if (missing.length > 0) generateOutputs(missing, kind)
  }
}

export type ForceOutcome =
  | { file: LocalFile; ok: true; result: TransitionResult }
  | { file: LocalFile; ok: false; error: string }

/** Force one transition the release gate refused, recording the reason as its comment. */
export async function forceTransition(file: LocalFile, transitionId: string, reason: string): Promise<ForceOutcome> {
  const fileId = file.pdmData?.id
  if (!fileId) return { file, ok: false, error: t('workflows.transition.failed') }
  const { data, error } = await executeTransition(fileId, transitionId, { forceRelease: true, comment: reason })
  if (error || !data) return { file, ok: false, error: error?.message ?? t('workflows.transition.failed') }
  if (!data.success) return { file, ok: false, error: data.error_message ?? t('workflows.transition.failed') }
  return { file, ok: true, result: data }
}

/**
 * Force the releases a bulk state change into `target` was refused, one file at a time. Each
 * file's transition is the one `workflow_transition_execute_to_legacy_state()` would have taken:
 * the single transition out of its current state into a state of that name.
 */
export async function forceLegacyReleases(
  files: readonly LocalFile[],
  target: LegacyState,
  reason: string,
  userId: string,
): Promise<ForceOutcome[]> {
  const outcomes: ForceOutcome[] = []
  for (const file of files) {
    const fileId = file.pdmData?.id
    if (!fileId) continue
    const { data: transitions, error } = await getAvailableTransitions(fileId, userId)
    const transitionId = error ? null : pickTransitionToLegacyState(transitions ?? [], target)
    if (!transitionId) {
      outcomes.push({ file, ok: false, error: t('releases.noReleaseTransition', { name: file.name }) })
      continue
    }
    outcomes.push(await forceTransition(file, transitionId, reason))
  }
  return outcomes
}

/** At most this many per-file failure toasts after a bulk force; the rest are counted in the log. */
const MAX_FAILURE_TOASTS = 3

/**
 * After a bulk state change: ask once about the drawings the release gate refused, force them
 * with the reason, and queue the PDF and STEP of every drawing that is now released. Returns the
 * files that were force-released (the caller refreshes them).
 */
export async function settleBulkReleases(
  outcomes: ReadonlyArray<BulkStateOutcome<LocalFile>>,
  target: LegacyState,
  userId: string,
): Promise<LocalFile[]> {
  const released = outcomes.filter((o) => o.status === 'ok').map((o) => o.file)
  const refused = refusedReleases(outcomes)
  let forced: LocalFile[] = []
  if (refused.length > 0) {
    const reason = await requestForcedReleaseReason({
      fileName: refused.length === 1 ? refused[0].name : null,
      version: refused.length === 1 ? (refused[0].pdmData?.version ?? null) : null,
      count: refused.length,
    })
    if (reason) {
      const results = await forceLegacyReleases(refused, target, reason, userId)
      forced = results.filter((r) => r.ok).map((r) => r.file)
      const failures = results.filter((r): r is Extract<ForceOutcome, { ok: false }> => !r.ok)
      const toast = usePDMStore.getState().addToast
      if (forced.length > 0) {
        toast(
          'success',
          forced.length === 1
            ? t('releases.forcedDone', { name: forced[0].name })
            : t('releases.forcedDoneMany', { count: forced.length }),
        )
      }
      for (const failure of failures.slice(0, MAX_FAILURE_TOASTS)) {
        toast('error', t('releases.forceFailed', { name: failure.file.name, error: failure.error }))
      }
      if (failures.length > 0) {
        log.warn('[Workflow]', 'Forced releases failed', { count: failures.length })
      }
    }
  }
  if (target === 'released') queueReleasedDrawingOutputs([...released, ...forced])
  return forced
}
