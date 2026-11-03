/**
 * Outputs generated in the background after a successful check-in (5.5.0): the drawing PDF of
 * each checked-in drawing and a STEP of each checked-in part and assembly, per
 * `organization.settings.outputs.auto_on_checkin` (both on by default). Since 5.9.0 a file also
 * regenerates every kind it already has an export of, unless it turned that kind off
 * (`file.auto_outputs_off`, "Regenerate at check-in" in the output menu).
 *
 * Never part of the check-in: `queueCheckinOutputs` returns at once, waits for the check-in's
 * background reference extraction (so the closure is exact), and runs one job at a time. A batch
 * of more than `AUTO_OUTPUT_MAX_BATCH` files, BluePLM Web and a machine without SOLIDWORKS are
 * skipped (logged, nothing else). At most `AUTO_OUTPUT_MAX_QUEUED` jobs wait; more are dropped.
 * A job that finds a same-named document open in SOLIDWORKS (the drawing just checked in usually
 * is) waits and tries again, a bounded number of times. Every failure is logged and kept on the
 * job in the store (`outputJobs`); nothing is thrown.
 */

import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { pdfRenderUnavailableReason } from '@/lib/reviewPackage/pdf'
import type { PdfUnavailableReason } from '@/lib/reviewPackage/types'
import { listAutoOutputsOff } from '@/lib/supabase/releases'
import { getFileVersionId, getLatestFileVersion, listOutputHeadsForFiles } from '@/lib/supabase/versionOutputs'
import { usePDMStore } from '@/stores/pdmStore'
import { outputJobKey, type OutputJob } from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionedOutput, VersionOutputKind } from '@/types/versionOutputs'

import { ensureVersionOutput, type EnsureVersionOutputResult } from './ensure'
import { autoOutputSettings, isDrawingFile, isModelFile, outputKindsForPath, type AutoOutputSettings } from './kinds'
import { loadOutputHeads, loadVersionOutputs } from './list'
import { registerOutputQueueReset } from './queueReset'

export { resetOutputQueue } from './queueReset'

/** Check-ins of more files than this generate nothing automatically. */
export const AUTO_OUTPUT_MAX_BATCH = 25
/** Jobs that may wait at once; later ones are dropped. */
export const AUTO_OUTPUT_MAX_QUEUED = 50
/** The app's queue: room for a folder's worth of outputs asked for from the toolbar, still bounded. */
export const APP_OUTPUT_MAX_QUEUED = 1000
/** How long a job blocked by a same-named open document waits before trying again. */
export const SAME_NAME_RETRY_MS = 60_000
/** Tries for a job blocked by a same-named open document. */
export const SAME_NAME_MAX_ATTEMPTS = 10

/** A checked-in file, as the queue needs it. */
export interface CheckinOutputCandidate {
  fileId: string
  /** The version number the check-in left; null = the newest. */
  version: number | null
  /** Vault-relative path or name (its extension picks the kind). */
  path: string
  fileName: string
}

export interface PlannedOutputJob {
  fileId: string
  version: number | null
  kind: VersionOutputKind
  fileName: string
  /** Generate again even when an output is recorded (an administrator replaces it). */
  regenerate?: boolean
}

export type CheckinOutputPlan =
  | { jobs: PlannedOutputJob[]; skipped: null }
  | { jobs: []; skipped: 'disabled' | 'batch_too_large' | 'nothing_to_do' }

/** Per-file kinds for the check-in plan (schema 509). */
export interface CheckinOutputFileKinds {
  /** file id -> kinds the file already has an export of (saved configuration); regenerated too. */
  existing?: ReadonlyMap<string, readonly VersionOutputKind[]>
  /** file id -> kinds the file is not to regenerate at check-in (`file.auto_outputs_off`). */
  off?: ReadonlyMap<string, readonly VersionOutputKind[]>
}

/**
 * What a check-in of `files` generates: per file, the organization's automatic kind (PDF of a
 * drawing, STEP of a part or assembly, per `settings`), plus every kind the file already has an
 * export of, minus the kinds the file has turned off. Pure.
 */
export function planCheckinOutputs(
  files: readonly CheckinOutputCandidate[],
  settings: AutoOutputSettings,
  maxBatch = AUTO_OUTPUT_MAX_BATCH,
  perFile: CheckinOutputFileKinds = {},
): CheckinOutputPlan {
  const anyExisting = [...(perFile.existing?.values() ?? [])].some((kinds) => kinds.length > 0)
  if (!settings.pdf && !settings.step && !anyExisting) return { jobs: [], skipped: 'disabled' }
  if (files.length > maxBatch) return { jobs: [], skipped: 'batch_too_large' }
  const jobs: PlannedOutputJob[] = []
  const seen = new Set<string>()
  for (const f of files) {
    const wanted = new Set<VersionOutputKind>(perFile.existing?.get(f.fileId) ?? [])
    if (settings.pdf && isDrawingFile(f.path)) wanted.add('pdf')
    if (settings.step && isModelFile(f.path)) wanted.add('step')
    const off = new Set(perFile.off?.get(f.fileId) ?? [])
    for (const kind of outputKindsForPath(f.path)) {
      if (!wanted.has(kind) || off.has(kind) || seen.has(`${f.fileId}:${kind}`)) continue
      seen.add(`${f.fileId}:${kind}`)
      jobs.push({ fileId: f.fileId, version: f.version, kind, fileName: f.fileName })
    }
  }
  return jobs.length > 0 ? { jobs, skipped: null } : { jobs: [], skipped: 'nothing_to_do' }
}

/** The kinds each file has an export of in its saved configuration (the queue's configuration). Pure. */
export function existingOutputKinds(
  heads: ReadonlyMap<string, readonly Pick<VersionedOutput, 'kind' | 'configuration'>[]>,
): Map<string, VersionOutputKind[]> {
  const byFile = new Map<string, VersionOutputKind[]>()
  for (const [fileId, outputs] of heads) {
    const kinds = [...new Set(outputs.filter((o) => o.configuration === null).map((o) => o.kind))]
    if (kinds.length > 0) byFile.set(fileId, kinds)
  }
  return byFile
}

/**
 * The checked-in files of a check-in, as candidates (files without a server id are left out).
 * The version is left to the job (`null` = the newest when it starts): the files a check-in
 * returns are the ones it was given, so their `pdmData.version` is the version before it.
 */
export function checkinCandidates(files: readonly LocalFile[]): CheckinOutputCandidate[] {
  const out: CheckinOutputCandidate[] = []
  for (const f of files) {
    const id = f.pdmData?.id
    if (!id) continue
    out.push({
      fileId: id,
      version: null,
      path: f.relativePath || f.name,
      fileName: f.name,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface OutputQueueDeps {
  now: () => number
  setTimer: (run: () => void, ms: number) => void
  resolveVersion: (fileId: string, version: number | null) => Promise<string | null>
  ensure: (
    fileVersionId: string,
    kind: VersionOutputKind,
    options?: { regenerate?: boolean },
  ) => Promise<EnsureVersionOutputResult>
  /** Every state a job goes through. */
  onJob: (job: OutputJob) => void
  /** A version has a new or confirmed output. */
  onOutput: (fileVersionId: string, fileId: string) => void
}

interface QueuedJob {
  job: OutputJob
  /** Dedup key: the store key plus the version asked for and whether it regenerates. */
  queueKey: string
  version: number | null
  regenerate: boolean
  attempts: number
  notBefore: number
}

export interface OutputQueue {
  /**
   * Add jobs (duplicates of a waiting job and jobs past the cap are dropped). `auto` marks them as
   * check-in jobs (default) rather than the user's. Returns how many were added.
   */
  enqueue: (jobs: readonly PlannedOutputJob[], auto?: boolean) => number
  /** Waiting plus running. */
  size: () => number
  /** Resolves when nothing is waiting or running. */
  idle: () => Promise<void>
  /**
   * Discard waiting jobs, stop retry timers and ignore the running job's result (sign-out,
   * organization change). The queue stays usable.
   */
  reset: () => void
}

/** Two jobs are the same only for the same file, kind, version asked for and regenerate flag. */
export function queuedJobKey(planned: PlannedOutputJob): string {
  return `${outputJobKey(planned.fileId, planned.kind, null)}:${planned.version ?? 'latest'}:${
    planned.regenerate ? 'regenerate' : ''
  }`
}

export function createOutputQueue(
  deps: OutputQueueDeps,
  maxQueued = AUTO_OUTPUT_MAX_QUEUED,
): OutputQueue {
  const waiting: QueuedJob[] = []
  let running = false
  let timerAt: number | null = null
  let idleWaiters: Array<() => void> = []
  // Raised by reset(): timers and running jobs of an older generation do nothing.
  let generation = 0

  const emit = (q: QueuedJob, patch: Partial<OutputJob>, gen: number) => {
    if (gen !== generation) return
    q.job = { ...q.job, ...patch, updatedAt: deps.now() }
    deps.onJob(q.job)
  }

  const settleIdle = () => {
    if (running || waiting.length > 0) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const w of waiters) w()
  }

  const schedule = () => {
    if (running) return
    if (waiting.length === 0) {
      settleIdle()
      return
    }
    const now = deps.now()
    const ready = waiting.findIndex((q) => q.notBefore <= now)
    if (ready < 0) {
      const at = Math.min(...waiting.map((q) => q.notBefore))
      if (timerAt !== null && timerAt <= at) return
      timerAt = at
      const gen = generation
      deps.setTimer(() => {
        if (gen !== generation) return
        timerAt = null
        schedule()
      }, at - now)
      return
    }
    const [q] = waiting.splice(ready, 1)
    running = true
    void runOne(q).finally(() => {
      running = false
      schedule()
    })
  }

  const runOne = async (q: QueuedJob) => {
    const gen = generation
    q.attempts++
    try {
      const fileVersionId =
        q.job.fileVersionId ?? (await deps.resolveVersion(q.job.fileId, q.version))
      if (!fileVersionId) {
        emit(q, { status: 'skipped', detail: 'NO_VERSION' }, gen)
        return
      }
      if (gen !== generation) return
      emit(q, { status: 'running', fileVersionId, detail: null }, gen)
      const result = await deps.ensure(
        fileVersionId,
        q.job.kind,
        q.regenerate ? { regenerate: true } : undefined,
      )
      if (gen !== generation) return
      switch (result.status) {
        case 'cached':
        case 'generated':
          emit(q, { status: 'done', detail: result.status }, gen)
          deps.onOutput(fileVersionId, q.job.fileId)
          return
        case 'needs_solidworks':
          emit(q, { status: 'skipped', detail: result.reason }, gen)
          return
        case 'desktop_only':
        case 'unsupported':
          emit(q, { status: 'skipped', detail: result.status }, gen)
          return
        case 'failed':
          if (result.errorCode === 'SAME_NAME_OPEN' && q.attempts < SAME_NAME_MAX_ATTEMPTS) {
            q.notBefore = deps.now() + SAME_NAME_RETRY_MS
            waiting.push(q)
            emit(q, { status: 'queued', detail: 'SAME_NAME_OPEN' }, gen)
            return
          }
          emit(q, { status: 'failed', detail: result.errorCode ?? result.error }, gen)
          log.warn('[Outputs]', 'Automatic output failed', {
            fileId: q.job.fileId,
            kind: q.job.kind,
            errorCode: result.errorCode,
            error: result.error,
          })
          return
      }
    } catch (err) {
      emit(q, { status: 'failed', detail: err instanceof Error ? err.message : String(err) }, gen)
    }
  }

  return {
    enqueue: (jobs, auto = true) => {
      let added = 0
      for (const planned of jobs) {
        const key = outputJobKey(planned.fileId, planned.kind, null)
        const queueKey = queuedJobKey(planned)
        if (waiting.some((q) => q.queueKey === queueKey)) continue
        if (waiting.length >= maxQueued) {
          log.warn('[Outputs]', 'Output queue full; job dropped', {
            fileId: planned.fileId,
            kind: planned.kind,
          })
          continue
        }
        const q: QueuedJob = {
          job: {
            key,
            fileId: planned.fileId,
            fileVersionId: null,
            kind: planned.kind,
            configuration: null,
            fileName: planned.fileName,
            status: 'queued',
            detail: null,
            auto,
            updatedAt: deps.now(),
          },
          queueKey,
          version: planned.version,
          regenerate: planned.regenerate === true,
          attempts: 0,
          notBefore: deps.now(),
        }
        waiting.push(q)
        deps.onJob(q.job)
        added++
      }
      schedule()
      return added
    },
    size: () => waiting.length + (running ? 1 : 0),
    idle: () =>
      running || waiting.length > 0
        ? new Promise<void>((resolve) => idleWaiters.push(resolve))
        : Promise.resolve(),
    reset: () => {
      generation++
      waiting.length = 0
      timerAt = null
      const waiters = idleWaiters
      idleWaiters = []
      for (const w of waiters) w()
    },
  }
}

// ---------------------------------------------------------------------------
// The app's queue
// ---------------------------------------------------------------------------

let appQueue: OutputQueue | null = null

function queue(): OutputQueue {
  if (appQueue) return appQueue
  appQueue = createOutputQueue(
    {
      now: () => Date.now(),
      setTimer: (run, ms) => {
        setTimeout(run, ms)
      },
      resolveVersion: async (fileId, version) =>
        (version !== null ? await getFileVersionId(fileId, version) : null) ??
        (await getLatestFileVersion(fileId))?.id ??
        null,
      ensure: (fileVersionId, kind, options) => ensureVersionOutput(fileVersionId, kind, options),
      onJob: (job) => usePDMStore.getState().upsertOutputJob(job),
      onOutput: (fileVersionId, fileId) => {
        loadOutputHeads([fileId]).catch((err) =>
          log.warn('[Outputs]', 'Could not reload the newest outputs', {
            fileId,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        loadVersionOutputs([fileVersionId]).catch((err) =>
          log.warn('[Outputs]', 'Could not reload version outputs', {
            fileVersionId,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      },
    },
    APP_OUTPUT_MAX_QUEUED,
  )
  const created = appQueue
  registerOutputQueueReset(() => {
    created.reset()
    if (appQueue === created) appQueue = null
  })
  return appQueue
}

/** Read one per-file input of the plan; a database without it (before 509) gives none. */
async function readOr<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch (err) {
    log.debug('[Outputs]', `Automatic outputs: ${what} unavailable`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return fallback
  }
}

/**
 * Queue the automatic outputs of a successful check-in. Returns at once and never throws.
 * `after` is the check-in's background reference extraction; generation starts once it settles.
 * Per file: the organization's kind, plus the kinds it already has an export of (one batched read
 * of the newest outputs), minus the kinds it has turned off (one batched read).
 */
export function queueCheckinOutputs(files: readonly LocalFile[], after?: Promise<unknown>): void {
  if (!hasDesktop() || files.length === 0) return
  const candidates = checkinCandidates(files)
  if (candidates.length === 0) return
  if (candidates.length > AUTO_OUTPUT_MAX_BATCH) {
    log.info('[Outputs]', 'Automatic outputs skipped: check-in batch too large', {
      files: candidates.length,
      max: AUTO_OUTPUT_MAX_BATCH,
    })
    return
  }
  const settings = autoOutputSettings(usePDMStore.getState().organization?.settings)
  const orgId = usePDMStore.getState().organization?.id ?? null
  void (async () => {
    try {
      await after?.catch(() => undefined)
      // Signed out or switched organization meanwhile: these jobs belong to the old session.
      if ((usePDMStore.getState().organization?.id ?? null) !== orgId) return
      // A machine that cannot generate reads nothing: the check comes before the plan's reads.
      const unavailable: PdfUnavailableReason | null = await pdfRenderUnavailableReason()
      if (unavailable) {
        log.info('[Outputs]', 'Automatic outputs skipped: SOLIDWORKS unavailable', {
          reason: unavailable,
          files: candidates.length,
        })
        return
      }
      const ids = candidates.map((c) => c.fileId)
      const [heads, off] = await Promise.all([
        readOr('newest outputs', () => listOutputHeadsForFiles(ids), new Map<string, VersionedOutput[]>()),
        readOr('per-file settings', () => listAutoOutputsOff(ids), new Map<string, VersionOutputKind[]>()),
      ])
      const plan = planCheckinOutputs(candidates, settings, AUTO_OUTPUT_MAX_BATCH, {
        existing: existingOutputKinds(heads),
        off,
      })
      if (plan.skipped) return
      queue().enqueue(plan.jobs)
    } catch (err) {
      log.warn('[Outputs]', 'Could not queue automatic outputs', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()
}

/** Queue outputs the user asked for (Generate PDF / Generate STEP on a selection), one at a time. */
export function queueOutputs(jobs: readonly PlannedOutputJob[]): number {
  if (!hasDesktop()) return 0
  return queue().enqueue(jobs, false)
}
