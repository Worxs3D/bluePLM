/**
 * Output requests (5.13.0, schema 515): the wrappers of the `version_output_request_*` RPCs and
 * the desktop worker that generates other users' requests.
 *
 * A user on BluePLM Web, or on a desktop without SOLIDWORKS, asks for a missing output
 * (`requestOutputs`). Every signed-in desktop with a known SOLIDWORKS service, full SOLIDWORKS
 * and "Generate requested outputs on this machine" on (`outputRequestWorkerEnabled`, per machine,
 * on by default) runs the worker: it claims a few requests at a time
 * (`version_output_request_claim`, `FOR UPDATE SKIP LOCKED`, so two machines never take the same
 * one), generates each through `ensureVersionOutput` (the same staged-closure path as Generate),
 * and finishes it (`done` or `failed`). The server also marks a request `done` once its output is
 * recorded, from any machine.
 *
 * The worker is woken by realtime (`handleOutputRequestEvent`, a new pending request) and polls
 * slowly otherwise, so a missed event costs minutes, not the request. It never claims while the
 * app's own output queue has work (the user's jobs come first, and another machine can take the
 * request meanwhile), keeps one timer and no growing state, and stops at sign-out and at an
 * organization change (`resetOutputQueue`). A request it could not run for a reason of this
 * machine (SOLIDWORKS went away, a same-named document is open) is left claimed: the server lets
 * any machine claim it again after 15 minutes. It never runs on the web.
 *
 * The wrappers and the row parser live in `./requestsApi` (free of store imports) and are
 * re-exported here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { getSupabaseClient } from '@/lib/supabase/client'
import { checkSwServiceFeature, SW_SERVICE_VERSION_RETARGET_REFERENCES } from '@/lib/swServiceVersion'
import { usePDMStore } from '@/stores/pdmStore'
import { outputJobKey, type OutputJob } from '@/stores/slices/outputsSlice'
import type { OutputRequest } from '@/types/outputRequests'

import { appOutputQueueSize } from './autoQueue'
import { ensureVersionOutput, type EnsureVersionOutputResult } from './ensure'
import { registerOutputQueueReset } from './queueReset'
import { claimOutputRequests, finishOutputRequest, OUTPUT_REQUEST_CLAIM_LIMIT, toOutputRequest } from './requestsApi'

export {
  cancelOutputRequests,
  claimOutputRequests,
  finishOutputRequest,
  listOutputRequests,
  OUTPUT_REQUEST_CLAIM_LIMIT,
  outputRequestErrorCode,
  parseCreateResult,
  requestOutputs,
  toOutputRequest,
} from './requestsApi'

/** The fallback poll when realtime says nothing. */
export const OUTPUT_REQUEST_POLL_MS = 5 * 60_000
/** Quiet time after a realtime wake (a burst of requests is one claim). */
export const OUTPUT_REQUEST_WAKE_MS = 2_000
/** Delay before the first claim of a session (the app is still loading). */
export const OUTPUT_REQUEST_START_MS = 15_000
/** Wait while the app's own output queue has work. */
export const OUTPUT_REQUEST_BUSY_MS = 30_000
/** Longest wait after failed claims (backoff doubles from the poll interval up to this). */
export const OUTPUT_REQUEST_BACKOFF_MAX_MS = 30 * 60_000

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

const changeListeners = new Set<(request: OutputRequest) => void>()

/** Hear every request change realtime delivers (a chip turning from Requested to ready). */
export function onOutputRequestChange(listener: (request: OutputRequest) => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

/** A realtime row of `version_output_request`: wakes the worker for a pending one, tells listeners. */
export function handleOutputRequestEvent(row: unknown): void {
  const request = toOutputRequest(row)
  if (!request) return
  if (request.status === 'pending') activeWorker?.worker.wake()
  for (const listener of [...changeListeners]) {
    try {
      listener(request)
    } catch (err) {
      log.warn('[OutputRequests]', 'A request listener failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/** What one request's run means for the request. Pure. */
export type RequestOutcome =
  | { finish: 'done' }
  | { finish: 'failed'; error: string }
  /** A reason of this machine: leave it claimed (any machine may claim it again later). */
  | { finish: null; machineUnavailable: boolean; reason: string }

export function requestOutcome(result: EnsureVersionOutputResult): RequestOutcome {
  switch (result.status) {
    case 'cached':
    case 'generated':
      return { finish: 'done' }
    case 'needs_solidworks':
      return { finish: null, machineUnavailable: true, reason: result.reason }
    case 'desktop_only':
      return { finish: null, machineUnavailable: true, reason: 'desktop_only' }
    case 'unsupported':
      return { finish: 'failed', error: 'UNSUPPORTED' }
    case 'failed':
      if (result.errorCode === 'SAME_NAME_OPEN') return { finish: null, machineUnavailable: false, reason: 'SAME_NAME_OPEN' }
      return { finish: 'failed', error: result.errorCode ?? result.error }
  }
}

export interface OutputRequestWorkerDeps {
  /** Run `fn` after `ms`; returns a function that cancels it. */
  setTimer: (fn: () => void, ms: number) => () => void
  /** The per-machine setting. */
  enabled: () => boolean
  /** Whether this machine can generate now (known service, full SOLIDWORKS). */
  canGenerate: () => Promise<boolean>
  /** The app's own output jobs waiting or running. */
  queueBusy: () => boolean
  claim: (limit: number) => Promise<OutputRequest[]>
  finish: (id: string, status: 'done' | 'failed', error: string | null) => Promise<void>
  generate: (request: OutputRequest) => Promise<EnsureVersionOutputResult>
}

export interface OutputRequestWorker {
  /** Claim soon (a realtime event, the setting turned on). */
  wake: () => void
  /** Stop for good: the timer is cancelled and a running request's result is not reported. */
  stop: () => void
  isStopped: () => boolean
}

export function createOutputRequestWorker(
  deps: OutputRequestWorkerDeps,
  startDelayMs = OUTPUT_REQUEST_START_MS,
): OutputRequestWorker {
  let stopped = false
  let busy = false
  let wokenWhileBusy = false
  let failures = 0
  let timerAt: number | null = null
  let cancelTimer: (() => void) | null = null

  const schedule = (ms: number) => {
    if (stopped) return
    const at = Date.now() + ms
    // One timer: an earlier one already covers a later wish.
    if (cancelTimer && timerAt !== null && timerAt <= at) return
    cancelTimer?.()
    timerAt = at
    cancelTimer = deps.setTimer(() => {
      cancelTimer = null
      timerAt = null
      void tick()
    }, ms)
  }

  const runOne = async (request: OutputRequest): Promise<'ok' | 'unavailable'> => {
    log.info('[OutputRequests]', 'Generating a requested output', {
      requestId: request.id,
      fileVersionId: request.fileVersionId,
      kind: request.kind,
    })
    let outcome: RequestOutcome
    try {
      outcome = requestOutcome(await deps.generate(request))
    } catch (err) {
      outcome = { finish: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
    if (stopped) return 'ok'
    if (outcome.finish === null) {
      log.info('[OutputRequests]', 'Requested output left for later', { requestId: request.id, reason: outcome.reason })
      return outcome.machineUnavailable ? 'unavailable' : 'ok'
    }
    try {
      await deps.finish(request.id, outcome.finish, outcome.finish === 'failed' ? outcome.error : null)
    } catch (err) {
      log.warn('[OutputRequests]', 'Could not finish an output request', {
        requestId: request.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return 'ok'
  }

  const tick = async () => {
    if (stopped) return
    if (busy) {
      wokenWhileBusy = true
      return
    }
    if (!deps.enabled()) return
    if (deps.queueBusy()) {
      schedule(OUTPUT_REQUEST_BUSY_MS)
      return
    }
    busy = true
    wokenWhileBusy = false
    let next = OUTPUT_REQUEST_POLL_MS
    try {
      if (!(await deps.canGenerate())) {
        failures = 0
        return
      }
      if (stopped || !deps.enabled()) return
      const claimed = await deps.claim(OUTPUT_REQUEST_CLAIM_LIMIT)
      failures = 0
      let unavailable = false
      for (const request of claimed) {
        if (stopped) return
        if ((await runOne(request)) === 'unavailable') {
          unavailable = true
          break
        }
      }
      // A full claim means more may wait: claim again soon.
      if (!unavailable && claimed.length >= OUTPUT_REQUEST_CLAIM_LIMIT) next = OUTPUT_REQUEST_WAKE_MS
    } catch (err) {
      failures++
      next = Math.min(OUTPUT_REQUEST_POLL_MS * 2 ** (failures - 1), OUTPUT_REQUEST_BACKOFF_MAX_MS)
      log.warn('[OutputRequests]', 'Could not claim output requests', {
        error: err instanceof Error ? err.message : String(err),
        retryInMs: next,
      })
    } finally {
      busy = false
      if (wokenWhileBusy && failures === 0) next = Math.min(next, OUTPUT_REQUEST_WAKE_MS)
      schedule(next)
    }
  }

  schedule(startDelayMs)

  return {
    wake: () => {
      if (stopped) return
      if (busy) {
        wokenWhileBusy = true
        return
      }
      schedule(OUTPUT_REQUEST_WAKE_MS)
    },
    stop: () => {
      stopped = true
      cancelTimer?.()
      cancelTimer = null
      timerAt = null
    },
    isStopped: () => stopped,
  }
}

/** Whether this machine can generate requests: a running service of known, new enough version, with full SOLIDWORKS. */
export async function canGenerateRequestedOutputs(): Promise<boolean> {
  if (!hasDesktop()) return false
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  const data = status?.data
  if (!data?.running || !data.version) return false
  if (data.swInstalled === false) return false
  const feature = checkSwServiceFeature(data.version, SW_SERVICE_VERSION_RETARGET_REFERENCES)
  return feature.status !== 'incompatible' && feature.status !== 'unknown'
}

/** File id and name of a version, for the job the file list shows. Null when unreadable. */
async function describeVersion(fileVersionId: string): Promise<{ fileId: string; fileName: string } | null> {
  const { data, error } = await db().from('file_version').select('id, file_id').eq('id', fileVersionId).maybeSingle()
  if (error || !isRecord(data)) return null
  const fileId = str(data.file_id)
  if (!fileId) return null
  const loaded = usePDMStore.getState().files.find((f) => f.pdmData?.id === fileId)
  if (loaded) return { fileId, fileName: loaded.name }
  const { data: file } = await db().from('file').select('id, file_name').eq('id', fileId).maybeSingle()
  return { fileId, fileName: (isRecord(file) ? str(file.file_name) : null) ?? fileId }
}

/** Generate one request through the output path, shown as a job in the file list like any other. */
async function generateRequest(request: OutputRequest): Promise<EnsureVersionOutputResult> {
  const described = await describeVersion(request.fileVersionId).catch(() => null)
  const base: OutputJob | null = described
    ? {
        key: outputJobKey(described.fileId, request.kind, request.configuration),
        fileId: described.fileId,
        fileVersionId: request.fileVersionId,
        kind: request.kind,
        configuration: request.configuration,
        fileName: described.fileName,
        status: 'running',
        detail: 'requested',
        auto: true,
        updatedAt: Date.now(),
      }
    : null
  if (base) usePDMStore.getState().upsertOutputJob(base)
  const result = await ensureVersionOutput(request.fileVersionId, request.kind, { configuration: request.configuration })
  if (base) {
    const patch: Pick<OutputJob, 'status' | 'detail'> =
      result.status === 'cached' || result.status === 'generated'
        ? { status: 'done', detail: result.status }
        : result.status === 'failed'
          ? { status: 'failed', detail: result.errorCode ?? result.error }
          : { status: 'skipped', detail: result.status === 'needs_solidworks' ? result.reason : result.status }
    usePDMStore.getState().upsertOutputJob({ ...base, ...patch, updatedAt: Date.now() })
  }
  return result
}

interface ActiveWorker {
  orgId: string
  worker: OutputRequestWorker
  release: () => void
}

let activeWorker: ActiveWorker | null = null

function stopActive(which: ActiveWorker): void {
  which.worker.stop()
  which.release()
  if (activeWorker === which) activeWorker = null
}

/**
 * Start this machine's request worker for the signed-in organization (the realtime effect calls
 * it with each session). Returns a function that stops it. Does nothing on the web, offline or
 * without an organization. A second start replaces the first. `resetOutputQueue` (sign-out,
 * organization change) stops it as well.
 */
export function startOutputRequestWorker(orgId: string | null = usePDMStore.getState().organization?.id ?? null): () => void {
  if (activeWorker) stopActive(activeWorker)
  if (!hasDesktop() || !orgId) return () => undefined
  const sameSession = () => (usePDMStore.getState().organization?.id ?? null) === orgId
  const worker = createOutputRequestWorker({
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    enabled: () => sameSession() && usePDMStore.getState().outputRequestWorkerEnabled !== false,
    canGenerate: canGenerateRequestedOutputs,
    queueBusy: () => appOutputQueueSize() > 0,
    claim: (limit) => claimOutputRequests(limit),
    finish: async (id, status, error) => {
      const result = await finishOutputRequest(id, status, error)
      if (!result.ok) throw new Error(result.message)
    },
    generate: generateRequest,
  })
  // Turning the setting on claims at once instead of at the next poll.
  const unsubscribe = usePDMStore.subscribe((state, prev) => {
    if (state.outputRequestWorkerEnabled && !prev.outputRequestWorkerEnabled) worker.wake()
  })
  const entry: ActiveWorker = { orgId, worker, release: () => undefined }
  const unregister = registerOutputQueueReset(() => stopActive(entry))
  entry.release = () => {
    unsubscribe()
    unregister()
  }
  activeWorker = entry
  log.debug('[OutputRequests]', 'Request worker started', { orgId })
  return () => stopActive(entry)
}

/** Wake the running worker (a request made on this machine is claimed by others too). */
export function wakeOutputRequestWorker(): void {
  activeWorker?.worker.wake()
}

/** The per-machine setting, for the Orders settings page. */
export function outputRequestWorkerEnabled(): boolean {
  return usePDMStore.getState().outputRequestWorkerEnabled !== false
}

export function setOutputRequestWorkerEnabled(enabled: boolean): void {
  usePDMStore.getState().setOutputRequestWorkerEnabled(enabled)
}
