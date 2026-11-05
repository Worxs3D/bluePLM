/**
 * Generate missing outputs of order lines (Generate missing). Desktop only, through the existing
 * output machinery: saved-configuration jobs of a known version go through the app's output queue
 * (`queueOutputs`, one at a time, shown in the file list too); exports of a named configuration,
 * and jobs whose version number the line does not carry, run after them through
 * `ensureVersionOutput`, one at a time. `source` is never generated. A kind already requested
 * (schema 515) is generated too: its request is then marked done by the server.
 *
 * Request missing (5.13.0, web and desktop): `requestMissingOutputs` asks for the same kinds as
 * output requests, which any desktop with SOLIDWORKS generates (`src/lib/outputs/requests.ts`).
 */

import { log } from '@/lib/logger'
import { ensureVersionOutput, queueOutputs, type PlannedOutputJob } from '@/lib/outputs'
import { holdGeneration } from '@/lib/outputs/generationLock'
import { requestOutputs } from '@/lib/outputs/requestsApi'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'
import { outputJobKey, type OutputJob } from '@/stores/slices/outputsSlice'
import type { LineOutputState, SupplyOrderLine } from '@/types/orders'
import type { OutputRequestItem, OutputRequestResult, RequestOutputsResult } from '@/types/outputRequests'
import type { VersionOutputKind } from '@/types/versionOutputs'

import { lineKindSource, type LineKindSource, type ResolvableLine } from './outputs'

export interface MissingOutputJob extends LineKindSource {
  kind: VersionOutputKind
}

/**
 * The generation jobs for the included kinds that are missing, one per (version, kind,
 * configuration) across lines. `source` is never generated. Pure.
 */
export function missingOutputJobs(
  lines: readonly ResolvableLine[],
  states: ReadonlyMap<string, readonly LineOutputState[]>,
): MissingOutputJob[] {
  const jobs = new Map<string, MissingOutputJob>()
  for (const line of lines) {
    if (line.sentOutputs !== null) continue
    for (const state of states.get(line.id) ?? []) {
      if (!state.included || (state.status !== 'missing' && state.status !== 'requested') || state.kind === 'source') continue
      const source = lineKindSource(line, state.kind)
      if (!source) continue
      const key = `${source.fileVersionId}:${state.kind}:${source.configuration ?? ''}`
      if (!jobs.has(key)) jobs.set(key, { ...source, kind: state.kind })
    }
  }
  return [...jobs.values()]
}

export type GenerateMissingResult =
  | { status: 'desktop_only' }
  | {
      status: 'queued'
      /** Jobs started. */
      queued: number
      /** Settles when every job has finished (or the session changed); never rejects. */
      done: Promise<void>
    }

/** Longest wait for the queue's jobs before `done` settles anyway. */
const GENERATE_WAIT_MAX_MS = 30 * 60 * 1000

const TERMINAL: ReadonlySet<OutputJob['status']> = new Set(['done', 'skipped', 'failed'])

function waitForJobs(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      unsubscribe()
      clearTimeout(timer)
      resolve()
    }
    const check = (jobs: ReadonlyMap<string, OutputJob>) => {
      if (keys.every((k) => { const job = jobs.get(k); return !job || TERMINAL.has(job.status) })) finish()
    }
    const unsubscribe = usePDMStore.subscribe((state, prev) => {
      if (state.outputJobs !== prev.outputJobs) check(state.outputJobs)
    })
    const timer = setTimeout(finish, GENERATE_WAIT_MAX_MS)
    check(usePDMStore.getState().outputJobs)
  })
}

/** Generate by version id, one at a time (the queue takes the saved configuration by number only). */
async function runDirectJobs(jobs: readonly MissingOutputJob[], orgId: string | null): Promise<void> {
  if (jobs.length === 0) return
  // The user's jobs come first: the request worker claims nothing until the last one is done.
  const end = holdGeneration()
  try {
    await runDirectJobsHeld(jobs, orgId)
  } finally {
    end()
  }
}

async function runDirectJobsHeld(jobs: readonly MissingOutputJob[], orgId: string | null): Promise<void> {
  for (const job of jobs) {
    if ((usePDMStore.getState().organization?.id ?? null) !== orgId) return
    const key = outputJobKey(job.fileId, job.kind, job.configuration)
    const base: OutputJob = {
      key,
      fileId: job.fileId,
      fileVersionId: job.fileVersionId,
      kind: job.kind,
      configuration: job.configuration,
      fileName: job.fileName,
      status: 'running',
      detail: null,
      auto: false,
      updatedAt: Date.now(),
    }
    usePDMStore.getState().upsertOutputJob(base)
    const result = await ensureVersionOutput(job.fileVersionId, job.kind, { configuration: job.configuration })
    if ((usePDMStore.getState().organization?.id ?? null) !== orgId) return
    const patch: Pick<OutputJob, 'status' | 'detail'> =
      result.status === 'cached' || result.status === 'generated'
        ? { status: 'done', detail: result.status }
        : result.status === 'failed'
          ? { status: 'failed', detail: result.errorCode ?? result.error }
          : { status: 'skipped', detail: result.status === 'needs_solidworks' ? result.reason : result.status }
    if (patch.status === 'failed') {
      log.warn('[Orders]', 'Output for an order failed', { fileId: job.fileId, kind: job.kind, detail: patch.detail })
    }
    usePDMStore.getState().upsertOutputJob({ ...base, ...patch, updatedAt: Date.now() })
  }
}

/** Generate the missing outputs of these lines. Desktop only. Returns at once. */
export function generateMissingOutputs(
  lines: readonly ResolvableLine[],
  states: ReadonlyMap<string, readonly LineOutputState[]>,
): GenerateMissingResult {
  if (!hasDesktop()) return { status: 'desktop_only' }
  const jobs = missingOutputJobs(lines, states)
  // The queue resolves a version by number, so a job without one would take the newest instead.
  const plain = jobs.filter((j) => j.configuration === null && j.version !== null)
  const direct = jobs.filter((j) => j.configuration !== null || j.version === null)
  const planned: PlannedOutputJob[] = plain.map((j) => ({
    fileId: j.fileId,
    version: j.version,
    kind: j.kind,
    fileName: j.fileName,
  }))
  const queued = planned.length > 0 ? queueOutputs(planned) : 0
  const orgId = usePDMStore.getState().organization?.id ?? null
  const done = waitForJobs(plain.map((j) => outputJobKey(j.fileId, j.kind, null)))
    .then(() => runDirectJobs(direct, orgId))
    .catch((error: unknown) => {
      log.warn('[Orders]', 'Generating missing outputs stopped', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  return { status: 'queued', queued: queued + direct.length, done }
}

/**
 * The output requests for the included kinds that are missing and not yet requested, one per
 * (version, kind, configuration) across lines, each naming its line's order. `source` is never
 * requested; a sent line asks for nothing. Pure.
 */
export function missingOutputRequestItems(
  lines: ReadonlyArray<ResolvableLine & Partial<Pick<SupplyOrderLine, 'orderId'>>>,
  states: ReadonlyMap<string, readonly LineOutputState[]>,
): OutputRequestItem[] {
  const items = new Map<string, OutputRequestItem>()
  for (const line of lines) {
    if (line.sentOutputs !== null) continue
    for (const state of states.get(line.id) ?? []) {
      if (!state.included || state.status !== 'missing' || state.kind === 'source') continue
      const source = lineKindSource(line, state.kind)
      if (!source) continue
      const key = `${source.fileVersionId}:${state.kind}:${source.configuration ?? ''}`
      if (items.has(key)) continue
      items.set(key, {
        fileVersionId: source.fileVersionId,
        kind: state.kind,
        configuration: source.configuration,
        orderId: line.orderId ?? null,
      })
    }
  }
  return [...items.values()]
}

/**
 * Request the missing outputs of these lines (web and desktop): a desktop with SOLIDWORKS that
 * can read the vault generates them. Nothing to request answers `{ ok: true, created: 0 }`
 * without a call. Never throws for a refusal.
 */
export async function requestMissingOutputs(
  lines: ReadonlyArray<ResolvableLine & Partial<Pick<SupplyOrderLine, 'orderId'>>>,
  states: ReadonlyMap<string, readonly LineOutputState[]>,
  request: (items: readonly OutputRequestItem[]) => Promise<OutputRequestResult<RequestOutputsResult>> = requestOutputs,
): Promise<OutputRequestResult<RequestOutputsResult>> {
  const items = missingOutputRequestItems(lines, states)
  if (items.length === 0) return { ok: true, created: 0, existing: 0, skipped: [] }
  return request(items)
}
