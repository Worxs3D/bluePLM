/**
 * Output requests (5.13.0, schema 515): the wrappers of the `version_output_request_*` RPCs and
 * the desktop worker that generates other users' requests.
 *
 * A user on BluePLM Web, or on a desktop without SOLIDWORKS, asks for a missing output
 * (`requestOutputs`). Every signed-in desktop with a known SOLIDWORKS service, full SOLIDWORKS
 * and "Generate requested outputs on this machine" on (`outputRequestWorkerEnabled`, per machine,
 * on by default) runs the worker: it claims one request at a time
 * (`version_output_request_claim`, `FOR UPDATE SKIP LOCKED`, so two machines never take the same
 * one), keeps the claim fresh while it runs (`version_output_request_touch`), generates it through
 * `ensureVersionOutput` (the same staged-closure path as Generate) and finishes it (`done` or
 * `failed`). The server also marks a request `done` once its output is recorded, from any machine.
 *
 * The worker is woken by realtime (`handleOutputRequestEvent`, a new pending request) and polls
 * slowly otherwise, so a missed event costs minutes, not the request. Before each claim it checks
 * that the app's own generation is idle (the output queue and the export lock of
 * `./generationLock`, which every export pipeline takes, so two never drive SOLIDWORKS at once):
 * the user's jobs come first, and another machine can take the request meanwhile. A request it
 * cannot run for a reason of this machine (SOLIDWORKS went away, a same-named document is open) is
 * given back (`version_output_request_release`) and the worker backs off. A caller without
 * explorer edit (or no longer a member) stops the worker for the session. It keeps one timer and
 * no growing state. Its lifetime is the realtime effect's (`startOutputRequestWorker` and the
 * function it returns), with a same-session guard (organization and user); it never runs on the
 * web.
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
import { generationLockBusy } from './generationLock'
import {
  claimOutputRequests,
  finishOutputRequest,
  OUTPUT_REQUEST_CLAIM_LIMIT,
  releaseOutputRequest,
  toOutputRequest,
  touchOutputRequest,
} from './requestsApi'

export {
  cancelOutputRequests,
  claimOutputRequests,
  finishOutputRequest,
  listOutputRequests,
  OUTPUT_REQUEST_CLAIM_LIMIT,
  outputRequestErrorCode,
  parseCreateResult,
  releaseOutputRequest,
  requestOutputs,
  toOutputRequest,
  touchOutputRequest,
} from './requestsApi'

/** The fallback poll when realtime says nothing. */
export const OUTPUT_REQUEST_POLL_MS = 5 * 60_000
/** Quiet time after a realtime wake (a burst of requests is one claim). */
export const OUTPUT_REQUEST_WAKE_MS = 2_000
/** Delay before the first claim of a session (the app is still loading). */
export const OUTPUT_REQUEST_START_MS = 15_000
/** Wait while the app's own generation has work. */
export const OUTPUT_REQUEST_BUSY_MS = 30_000
/** Longest wait after failed claims or given-back requests (doubles from the poll interval). */
export const OUTPUT_REQUEST_BACKOFF_MAX_MS = 30 * 60_000
/** How often a running request's claim is refreshed (the server takes over claims after 15 min). */
export const OUTPUT_REQUEST_TOUCH_MS = 4 * 60_000
/** Claim refusals that hold for the whole session: the worker stops instead of retrying. */
export const OUTPUT_REQUEST_STOP_CODES: readonly string[] = ['NO_EDIT_PERMISSION', 'NOT_MEMBER']

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
  /** A reason of this machine: give it back for any machine, and back off. */
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

/** The wait after `n` failures or give-backs in a row: the poll interval, doubling, bounded. Pure. */
export function requestBackoffMs(n: number): number {
  return Math.min(OUTPUT_REQUEST_POLL_MS * 2 ** Math.max(0, n - 1), OUTPUT_REQUEST_BACKOFF_MAX_MS)
}

export interface OutputRequestWorkerDeps {
  /** Run `fn` after `ms`; returns a function that cancels it. */
  setTimer: (fn: () => void, ms: number) => () => void
  /** The per-machine setting, and the session the worker was started for. */
  enabled: () => boolean
  /** Whether this machine can generate now (known service, full SOLIDWORKS). */
  canGenerate: () => Promise<boolean>
  /** The app's own generation runs or waits (the output queue, the export lock). */
  busy: () => boolean
  /** Claim one request, or none. Throws an error with a `code` on a refusal. */
  claim: () => Promise<OutputRequest | null>
  touch: (id: string) => Promise<void>
  release: (id: string) => Promise<void>
  finish: (id: string, status: 'done' | 'failed', error: string | null) => Promise<void>
  generate: (request: OutputRequest) => Promise<EnsureVersionOutputResult>
}

export interface OutputRequestWorker {
  /** Claim soon (a realtime event, the setting turned on). */
  wake: () => void
  /** Stop for good: the timers are cancelled and a running request's result is not reported. */
  stop: () => void
  isStopped: () => boolean
}

function codeOf(err: unknown): string | null {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null
  return typeof code === 'string' ? code : null
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createOutputRequestWorker(
  deps: OutputRequestWorkerDeps,
  startDelayMs = OUTPUT_REQUEST_START_MS,
): OutputRequestWorker {
  let stopped = false
  let running = false
  let wokenWhileRunning = false
  let failures = 0
  let givenBack = 0
  let timerAt: number | null = null
  let cancelTimer: (() => void) | null = null
  let cancelTouch: (() => void) | null = null

  const stop = () => {
    stopped = true
    cancelTimer?.()
    cancelTimer = null
    timerAt = null
    cancelTouch?.()
    cancelTouch = null
  }

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

  const touch = (id: string) =>
    deps.touch(id).catch((err) => log.debug('[OutputRequests]', 'Could not refresh a claim', { requestId: id, error: messageOf(err) }))

  /** Refresh the claim every `OUTPUT_REQUEST_TOUCH_MS` until the returned function is called. */
  const keepFresh = (id: string): (() => void) => {
    let cancel: (() => void) | null = null
    const arm = () => {
      cancel = deps.setTimer(() => {
        if (stopped) return
        void touch(id)
        arm()
      }, OUTPUT_REQUEST_TOUCH_MS)
    }
    arm()
    return () => cancel?.()
  }

  /** 'done' when the request was finished; 'given_back' when this machine could not run it. */
  const runOne = async (request: OutputRequest): Promise<'done' | 'given_back'> => {
    log.info('[OutputRequests]', 'Generating a requested output', {
      requestId: request.id,
      fileVersionId: request.fileVersionId,
      kind: request.kind,
    })
    await touch(request.id)
    cancelTouch = keepFresh(request.id)
    let outcome: RequestOutcome
    try {
      outcome = requestOutcome(await deps.generate(request))
    } catch (err) {
      outcome = { finish: 'failed', error: messageOf(err) }
    } finally {
      cancelTouch?.()
      cancelTouch = null
    }
    if (stopped) return 'done'
    if (outcome.finish === null) {
      log.info('[OutputRequests]', 'Requested output given back', { requestId: request.id, reason: outcome.reason })
      await deps.release(request.id).catch((err) =>
        log.warn('[OutputRequests]', 'Could not give back an output request', { requestId: request.id, error: messageOf(err) }),
      )
      return 'given_back'
    }
    await deps.finish(request.id, outcome.finish, outcome.finish === 'failed' ? outcome.error : null).catch((err) =>
      log.warn('[OutputRequests]', 'Could not finish an output request', { requestId: request.id, error: messageOf(err) }),
    )
    return 'done'
  }

  const tick = async () => {
    if (stopped) return
    if (running) {
      wokenWhileRunning = true
      return
    }
    if (!deps.enabled()) return
    if (deps.busy()) {
      schedule(OUTPUT_REQUEST_BUSY_MS)
      return
    }
    running = true
    wokenWhileRunning = false
    let next = OUTPUT_REQUEST_POLL_MS
    try {
      if (!(await deps.canGenerate())) return
      if (stopped || !deps.enabled()) return
      // The user may have started a job meanwhile: check again right before claiming.
      if (deps.busy()) {
        next = OUTPUT_REQUEST_BUSY_MS
        return
      }
      const request = await deps.claim()
      failures = 0
      if (!request) return
      if ((await runOne(request)) === 'given_back') {
        givenBack++
        next = requestBackoffMs(givenBack)
      } else {
        givenBack = 0
        // One was waiting, so more may be: claim again soon.
        next = OUTPUT_REQUEST_WAKE_MS
      }
    } catch (err) {
      const code = codeOf(err)
      if (code && OUTPUT_REQUEST_STOP_CODES.includes(code)) {
        log.info('[OutputRequests]', 'Request worker stopped for this session', { code })
        stop()
        return
      }
      failures++
      next = requestBackoffMs(failures)
      log.warn('[OutputRequests]', 'Could not claim output requests', { error: messageOf(err), retryInMs: next })
    } finally {
      running = false
      if (wokenWhileRunning && failures === 0 && givenBack === 0) next = Math.min(next, OUTPUT_REQUEST_WAKE_MS)
      schedule(next)
    }
  }

  schedule(startDelayMs)

  return {
    wake: () => {
      if (stopped) return
      if (running) {
        wokenWhileRunning = true
        return
      }
      schedule(OUTPUT_REQUEST_WAKE_MS)
    },
    stop,
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
  worker: OutputRequestWorker
  release: () => void
}

let activeWorker: ActiveWorker | null = null

function stopActive(which: ActiveWorker): void {
  which.worker.stop()
  which.release()
  if (activeWorker === which) activeWorker = null
}

/** Throw the claim refusal with its code, so the worker can tell a lasting one. */
async function claimOne(): Promise<OutputRequest | null> {
  const [request] = await claimOutputRequests(OUTPUT_REQUEST_CLAIM_LIMIT)
  return request ?? null
}

async function orThrow(result: Promise<{ ok: boolean; message?: string }>): Promise<void> {
  const r = await result
  if (!r.ok) throw new Error(r.message ?? 'refused')
}

/**
 * Start this machine's request worker for the signed-in session (the realtime effect calls it
 * with each session and calls the function it returns in its cleanup, which is the worker's whole
 * lifetime). Does nothing on the web, offline or without an organization. A second start replaces
 * the first. It is not tied to `resetOutputQueue`: the session reset runs in the same commit as
 * the effect that starts the worker, so it would stop the new session's worker. Instead the
 * worker claims nothing once the organization or the user is not the one it started with.
 */
export function startOutputRequestWorker(orgId: string | null = usePDMStore.getState().organization?.id ?? null): () => void {
  if (activeWorker) stopActive(activeWorker)
  if (!hasDesktop() || !orgId) return () => undefined
  const userId = usePDMStore.getState().user?.id ?? null
  const sameSession = () => {
    const state = usePDMStore.getState()
    return (state.organization?.id ?? null) === orgId && (state.user?.id ?? null) === userId
  }
  const worker = createOutputRequestWorker({
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    enabled: () => sameSession() && usePDMStore.getState().outputRequestWorkerEnabled !== false,
    canGenerate: canGenerateRequestedOutputs,
    busy: () => appOutputQueueSize() > 0 || generationLockBusy(),
    claim: claimOne,
    touch: (id) => orThrow(touchOutputRequest(id)),
    release: (id) => orThrow(releaseOutputRequest(id)),
    finish: (id, status, error) => orThrow(finishOutputRequest(id, status, error)),
    generate: generateRequest,
  })
  // Turning the setting on claims at once instead of at the next poll.
  const unsubscribe = usePDMStore.subscribe((state, prev) => {
    if (state.outputRequestWorkerEnabled && !prev.outputRequestWorkerEnabled) worker.wake()
  })
  const entry: ActiveWorker = { worker, release: unsubscribe }
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
