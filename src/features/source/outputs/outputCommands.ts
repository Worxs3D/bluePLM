/**
 * The user's actions on version outputs (5.5.0): Generate PDF / Generate STEP on a selection,
 * Regenerate (administrators), Delete, Open, Save copy..., Save next to file and Copy file name. Shared by
 * the file context menu, the output rows under an expanded file and their menu.
 *
 * Generation goes through the one background queue in `src/lib/outputs` (the check-in queue), so
 * a manual job and an automatic one never run SOLIDWORKS at the same time. The queue reports
 * status codes on the store's `outputJobs`; this module watches the jobs it queued and turns the
 * result of each batch into one toast.
 */

import { copyToClipboard } from '@/lib/clipboard'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  loadVersionOutputs,
  openVersionOutput,
  outputKindLabel,
  queueOutputs,
  saveOutputCopy,
  saveOutputNextToSource,
} from '@/lib/outputs'
import { hasDesktop } from '@/lib/platform'
import { pdfRenderUnavailableReason } from '@/lib/reviewPackage/pdf'
import { deleteVersionOutput, VersionOutputRpcError } from '@/lib/supabase/versionOutputs'
import { usePDMStore } from '@/stores/pdmStore'
import { outputJobKey, type OutputJob } from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

import { generateJobs, OUTPUT_REASON_CODES, outputCopyName, outputReasonKey } from './outputRowModel'

/** A job's detail (a code, or the service's own text) as a sentence for the user. */
export function outputReasonText(detail: string | null | undefined): string {
  if (!detail) return t('source.outputs.reason_unknown')
  return (OUTPUT_REASON_CODES as readonly string[]).includes(detail) ? t(outputReasonKey(detail)) : detail
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toast(type: 'success' | 'error' | 'info' | 'warning', message: string): void {
  usePDMStore.getState().addToast(type, message)
}

// ---------------------------------------------------------------------------
// Watching the jobs this user queued
// ---------------------------------------------------------------------------

interface Batch {
  keys: Set<string>
  total: number
  done: number
  problems: OutputJob[]
}

/** Open batches; each is at most the queue's cap, and a batch goes once its last job settles. */
const batches = new Set<Batch>()
let unsubscribe: (() => void) | null = null

function settle(batch: Batch): void {
  batches.delete(batch)
  if (batches.size === 0 && unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  if (batch.problems.length === 0) {
    if (batch.done > 0) toast('success', t('source.outputs.generatedCount', { count: batch.done }))
    return
  }
  const first = batch.problems[0]
  const kind = outputKindLabel(first.kind)
  if (batch.problems.length === 1 && batch.total === 1) {
    toast(
      first.status === 'failed' ? 'error' : 'warning',
      t('source.outputs.generateFailedOne', { kind, name: first.fileName, reason: outputReasonText(first.detail) }),
    )
    return
  }
  toast(
    'warning',
    t('source.outputs.generateFailedSome', {
      failed: batch.problems.length,
      total: batch.total,
      name: first.fileName,
      reason: outputReasonText(first.detail),
    }),
  )
}

function onJobs(jobs: ReadonlyMap<string, OutputJob>): void {
  for (const batch of [...batches]) {
    for (const key of [...batch.keys]) {
      const job = jobs.get(key)
      // A job dropped from the store (bounded) counts as settled without a result.
      if (job && (job.status === 'queued' || job.status === 'running')) continue
      batch.keys.delete(key)
      if (job?.status === 'done') batch.done++
      else if (job) batch.problems.push(job)
    }
    if (batch.keys.size === 0) settle(batch)
  }
}

function watch(keys: string[]): void {
  if (keys.length === 0) return
  batches.add({ keys: new Set(keys), total: keys.length, done: 0, problems: [] })
  unsubscribe ??= usePDMStore.subscribe((state, prev) => {
    if (state.outputJobs !== prev.outputJobs) onJobs(state.outputJobs)
  })
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

async function queueWithToasts(files: readonly LocalFile[], kind: VersionOutputKind, regenerate: boolean) {
  if (!hasDesktop()) {
    toast('info', t('source.outputs.reason_desktop_only'))
    return
  }
  const jobs = generateJobs(files, kind, regenerate)
  if (jobs.length === 0) return
  const unavailable = await pdfRenderUnavailableReason().catch(() => null)
  if (unavailable) {
    toast('warning', t('source.outputs.cannotGenerate', { kind: outputKindLabel(kind), reason: outputReasonText(unavailable) }))
    return
  }
  queueOutputs(jobs)
  // Only jobs now waiting in the queue are watched: one dropped at the cap keeps its old state.
  const current = usePDMStore.getState().outputJobs
  const keys = jobs
    .map((j) => outputJobKey(j.fileId, j.kind, null))
    .filter((key) => {
      const job = current.get(key)
      return job?.status === 'queued' || job?.status === 'running'
    })
  watch(keys)
  if (keys.length < jobs.length) log.info('[Outputs]', 'Some output jobs were not queued', { asked: jobs.length, queued: keys.length })
  toast(
    'info',
    regenerate
      ? t('source.outputs.regenerating', { kind: outputKindLabel(kind), name: jobs[0].fileName })
      : t('source.outputs.generatingCount', { kind: outputKindLabel(kind), count: keys.length }),
  )
}

/** "Generate PDF" / "Generate STEP" on a selection: one background job per checked-in file. */
export function generateOutputs(files: readonly LocalFile[], kind: VersionOutputKind): void {
  void queueWithToasts(files, kind, false)
}

/** Generate a recorded output again from its version (an administrator replaces it). */
export function regenerateOutput(file: LocalFile, output: VersionOutput): void {
  void queueWithToasts([file], output.kind, true)
}

// ---------------------------------------------------------------------------
// Copies
// ---------------------------------------------------------------------------

function orgId(): string | null {
  return usePDMStore.getState().organization?.id ?? null
}

function copyName(file: LocalFile, output: VersionOutput): string {
  return outputCopyName(output, file, usePDMStore.getState().organization)
}

export async function openOutput(file: LocalFile, output: VersionOutput): Promise<void> {
  const org = orgId()
  if (!org) return
  try {
    const result = await openVersionOutput(org, output, copyName(file, output))
    if (result.status === 'downloaded') toast('info', t('source.outputs.downloaded'))
  } catch (err) {
    log.error('[Outputs]', 'Opening an output failed', { outputId: output.id, error: errorText(err) })
    toast('error', t('source.outputs.openFailed', { error: errorText(err) }))
  }
}

export async function saveOutputCopyWithToast(file: LocalFile, output: VersionOutput): Promise<void> {
  const org = orgId()
  if (!org) return
  try {
    const result = await saveOutputCopy(org, output, copyName(file, output))
    if (result.status === 'saved') toast('success', t('source.outputs.saved', { path: result.path }))
    else if (result.status === 'downloaded') toast('info', t('source.outputs.downloaded'))
  } catch (err) {
    log.error('[Outputs]', 'Saving an output copy failed', { outputId: output.id, error: errorText(err) })
    toast('error', t('source.outputs.saveFailed', { error: errorText(err) }))
  }
}

/**
 * Save a copy in the source file's folder, named by the export filename pattern. An identical
 * file there is left alone; a different one is never replaced (it may be someone's own file).
 */
export async function saveOutputNextToFileWithToast(file: LocalFile, output: VersionOutput): Promise<void> {
  const org = orgId()
  if (!org) return
  try {
    const result = await saveOutputNextToSource(org, output, file.path, copyName(file, output))
    if (result.status === 'saved') toast('success', t('source.outputs.saved', { path: result.path }))
    else if (result.status === 'exists') toast('info', t('source.outputs.alreadyThere', { path: result.path }))
    else toast('warning', t('source.outputs.nameTaken', { path: result.path }))
  } catch (err) {
    log.error('[Outputs]', 'Saving an output next to its file failed', { outputId: output.id, error: errorText(err) })
    toast('error', t('source.outputs.saveFailed', { error: errorText(err) }))
  }
}

export async function copyOutputName(file: LocalFile, output: VersionOutput): Promise<void> {
  const result = await copyToClipboard(copyName(file, output))
  if (result.success) toast('success', t('source.outputs.nameCopied'))
  else toast('error', t('source.outputs.copyFailed', { error: result.error ?? '' }))
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a recorded output (an administrator, or the user who generated it), then read the
 * version's outputs again so the row becomes a "Generate" row. The content stays in the vault.
 */
export async function deleteOutputWithToast(file: LocalFile, output: VersionOutput): Promise<boolean> {
  const kind = outputKindLabel(output.kind)
  try {
    await deleteVersionOutput(output)
  } catch (err) {
    const code = err instanceof VersionOutputRpcError ? err.code : null
    log.error('[Outputs]', 'Deleting an output failed', { outputId: output.id, code, error: errorText(err) })
    toast(
      'error',
      code === 'IN_REVIEW'
        ? t('source.outputs.deleteInReview', { kind })
        : code === 'NOT_GENERATOR'
          ? t('source.outputs.deleteNotGenerator', { kind })
          : t('source.outputs.deleteFailed', { kind, error: errorText(err) }),
    )
    return false
  }
  const state = usePDMStore.getState()
  if (state.childSelection?.target.kind === 'output' && state.childSelection.target.output.id === output.id) {
    state.setChildSelection(null)
  }
  await loadVersionOutputs([output.fileVersionId]).catch((err) =>
    log.warn('[Outputs]', 'Could not reload version outputs', { error: errorText(err) }),
  )
  toast('success', t('source.outputs.deleted', { kind, name: file.name }))
  return true
}
