import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  desktop: true,
  rpc: vi.fn(),
  rows: [] as unknown[],
  queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  state: {
    organization: { id: 'org' } as { id: string } | null,
    outputRequestWorkerEnabled: true,
    files: [] as unknown[],
    upsertOutputJob: vi.fn(),
  },
  listeners: [] as Array<(s: unknown, p: unknown) => void>,
  queueSize: 0,
  ensure: vi.fn(),
}))

vi.mock('@/lib/platform', () => ({ hasDesktop: () => h.desktop }))
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => h.rpc(...args),
    from: (table: string) => {
      const q = { table, calls: [] as Array<[string, unknown[]]> }
      h.queries.push(q)
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'eq', 'order']) {
        builder[m] = (...args: unknown[]) => {
          q.calls.push([m, args])
          return builder
        }
      }
      builder.range = async (from: number, to: number) => {
        q.calls.push(['range', [from, to]])
        return { data: from === 0 ? h.rows : [], error: null }
      }
      builder.maybeSingle = async () => ({ data: null, error: null })
      return builder
    },
  }),
}))
vi.mock('@/stores/pdmStore', () => ({
  usePDMStore: {
    getState: () => h.state,
    subscribe: (fn: (s: unknown, p: unknown) => void) => {
      h.listeners.push(fn)
      return () => {
        h.listeners = h.listeners.filter((l) => l !== fn)
      }
    },
  },
}))
vi.mock('./autoQueue', () => ({ appOutputQueueSize: () => h.queueSize }))
vi.mock('./ensure', () => ({ ensureVersionOutput: (...args: unknown[]) => h.ensure(...args) }))

import type { OutputRequest } from '@/types/outputRequests'

import type { EnsureVersionOutputResult } from './ensure'
import { resetOutputQueue } from './queueReset'
import {
  cancelOutputRequests,
  claimOutputRequests,
  createOutputRequestWorker,
  finishOutputRequest,
  handleOutputRequestEvent,
  listOutputRequests,
  onOutputRequestChange,
  OUTPUT_REQUEST_BACKOFF_MAX_MS,
  OUTPUT_REQUEST_BUSY_MS,
  OUTPUT_REQUEST_CLAIM_LIMIT,
  OUTPUT_REQUEST_POLL_MS,
  OUTPUT_REQUEST_START_MS,
  OUTPUT_REQUEST_WAKE_MS,
  parseCreateResult,
  requestOutcome,
  requestOutputs,
  startOutputRequestWorker,
  toOutputRequest,
  type OutputRequestWorkerDeps,
} from './requests'

function row(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    org_id: 'org',
    vault_id: 'vault',
    file_version_id: `fv-${id}`,
    kind: 'step',
    configuration: null,
    status: 'claimed',
    requested_by: 'u1',
    requested_at: '2026-11-04T10:00:00Z',
    claimed_by: 'u2',
    claimed_at: '2026-11-04T10:01:00Z',
    finished_at: null,
    error: null,
    order_id: 'o1',
    ...extra,
  }
}

function request(id: string): OutputRequest {
  return toOutputRequest(row(id))!
}

const generated: EnsureVersionOutputResult = {
  status: 'generated',
  output: {
    id: 'out',
    kind: 'step',
    fileId: 'f',
    fileVersionId: 'fv',
    configuration: null,
    storageHash: 'h',
    fileSize: 1,
    fileName: 'a.step',
    closureExact: true,
    generatedBy: 'u2',
    generatedAt: 'now',
  },
}

beforeEach(() => {
  h.desktop = true
  h.rpc.mockReset()
  h.rows = []
  h.queries = []
  h.queueSize = 0
  h.ensure.mockReset()
  h.state.organization = { id: 'org' }
  h.state.outputRequestWorkerEnabled = true
  h.state.upsertOutputJob.mockReset()
  h.listeners = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rows and outcomes', () => {
  it('parses a request row and refuses one that is not', () => {
    expect(request('a')).toMatchObject({ id: 'a', fileVersionId: 'fv-a', kind: 'step', status: 'claimed', orderId: 'o1' })
    expect(toOutputRequest(row('b', { kind: 'zip' }))).toBeNull()
    expect(toOutputRequest(row('c', { status: 'lost' }))).toBeNull()
    expect(toOutputRequest(null)).toBeNull()
  })

  it('maps what generation said to what the request becomes', () => {
    expect(requestOutcome(generated)).toEqual({ finish: 'done' })
    expect(requestOutcome({ ...generated, status: 'cached' })).toEqual({ finish: 'done' })
    expect(requestOutcome({ status: 'unsupported' })).toEqual({ finish: 'failed', error: 'UNSUPPORTED' })
    expect(requestOutcome({ status: 'failed', error: 'boom', errorCode: 'EXPORT_FAILED' })).toEqual({
      finish: 'failed',
      error: 'EXPORT_FAILED',
    })
    expect(requestOutcome({ status: 'failed', error: 'open', errorCode: 'SAME_NAME_OPEN' })).toMatchObject({
      finish: null,
      machineUnavailable: false,
    })
    expect(requestOutcome({ status: 'needs_solidworks', reason: 'service_offline' })).toMatchObject({
      finish: null,
      machineUnavailable: true,
    })
  })

  it('sums create answers and names unknown skip reasons UNKNOWN', () => {
    const into = { created: 0, existing: 0, skipped: [] }
    parseCreateResult(
      {
        ok: true,
        created: 2,
        existing: 1,
        skipped: [
          { file_version_id: 'v', kind: 'pdf', reason: 'EXISTS' },
          { file_version_id: 'w', kind: 'stl', reason: 'SOMETHING_NEW' },
          { kind: 'pdf' },
        ],
      },
      into,
    )
    expect(into).toEqual({
      created: 2,
      existing: 1,
      skipped: [
        { fileVersionId: 'v', kind: 'pdf', reason: 'EXISTS' },
        { fileVersionId: 'w', kind: 'stl', reason: 'UNKNOWN' },
      ],
    })
  })
})

describe('wrappers', () => {
  it('requests each version, kind and configuration once', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, created: 1, existing: 1, skipped: [] }, error: null })
    const result = await requestOutputs([
      { fileVersionId: 'v', kind: 'step', orderId: 'o' },
      { fileVersionId: 'v', kind: 'step', configuration: null },
      { fileVersionId: 'v', kind: 'stl', configuration: 'Long' },
    ])
    expect(result).toEqual({ ok: true, created: 1, existing: 1, skipped: [] })
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('version_output_request_create', {
      p_items: [
        { file_version_id: 'v', kind: 'step', configuration: null, order_id: 'o' },
        { file_version_id: 'v', kind: 'stl', configuration: 'Long', order_id: null },
      ],
    })
  })

  it('returns a refusal by its hint, never throwing', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'no', hint: 'NO_VAULT_ACCESS' } })
    expect(await requestOutputs([{ fileVersionId: 'v', kind: 'pdf' }])).toEqual({
      ok: false,
      code: 'NO_VAULT_ACCESS',
      message: 'no',
    })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'odd', hint: 'WHO_KNOWS' } })
    expect(await cancelOutputRequests(['r'])).toMatchObject({ ok: false, code: 'UNKNOWN' })
  })

  it('cancels, claims and finishes with the RPC argument names', async () => {
    h.rpc.mockResolvedValueOnce({ data: 2, error: null })
    expect(await cancelOutputRequests(['a', 'a', 'b'])).toEqual({ ok: true, cancelled: 2 })
    expect(h.rpc).toHaveBeenLastCalledWith('version_output_request_cancel', { p_ids: ['a', 'b'] })
    expect(await cancelOutputRequests([])).toEqual({ ok: true, cancelled: 0 })

    h.rpc.mockResolvedValueOnce({ data: [row('a'), { nope: true }], error: null })
    expect((await claimOutputRequests(2)).map((r) => r.id)).toEqual(['a'])
    expect(h.rpc).toHaveBeenLastCalledWith('version_output_request_claim', { p_limit: 2 })

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x', hint: 'NO_EDIT_PERMISSION' } })
    await expect(claimOutputRequests()).rejects.toMatchObject({ code: 'NO_EDIT_PERMISSION' })

    h.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await finishOutputRequest('a', 'failed', 'E'.repeat(900))).toEqual({ ok: true })
    expect(h.rpc).toHaveBeenLastCalledWith('version_output_request_finish', {
      p_id: 'a',
      p_status: 'failed',
      p_error: 'E'.repeat(500),
    })
  })

  it('lists the waiting requests of versions, in batches', async () => {
    h.rows = [row('a', { status: 'pending' })]
    const ids = Array.from({ length: 150 }, (_, i) => `v${i}`)
    const list = await listOutputRequests([...ids, 'v0'])
    expect(list.map((r) => r.id)).toEqual(['a', 'a'])
    // One read per batch (each reads a second, empty page).
    const reads = h.queries.filter(
      (q) => q.table === 'version_output_request' && q.calls.some((c) => c[0] === 'range' && c[1][0] === 0),
    )
    expect(reads).toHaveLength(2)
    expect(reads[0].calls).toContainEqual(['in', ['status', ['pending', 'claimed']]])
    expect((reads[0].calls.find((c) => c[0] === 'in')![1][1] as string[]).length).toBe(100)
  })
})

describe('the worker', () => {
  function deps(over: Partial<OutputRequestWorkerDeps> = {}) {
    const claims: OutputRequest[][] = []
    const d = {
      setTimer: (fn: () => void, ms: number) => {
        const id = setTimeout(fn, ms)
        return () => clearTimeout(id)
      },
      enabled: vi.fn<() => boolean>(() => true),
      canGenerate: vi.fn<() => Promise<boolean>>(async () => true),
      queueBusy: vi.fn<() => boolean>(() => false),
      claim: vi.fn<(limit: number) => Promise<OutputRequest[]>>(async () => claims.shift() ?? []),
      finish: vi.fn<(id: string, status: 'done' | 'failed', error: string | null) => Promise<void>>(async () => undefined),
      generate: vi.fn<(r: OutputRequest) => Promise<EnsureVersionOutputResult>>(async () => generated),
    }
    // Overrides are spies too; the declared types stay the defaults'.
    Object.assign(d, over)
    return { d, claims }
  }

  it('claims after the start delay, generates each and finishes it', async () => {
    vi.useFakeTimers()
    const { d, claims } = deps()
    claims.push([request('a'), request('b')])
    createOutputRequestWorker(d)
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_START_MS - 1)
    expect(d.claim).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(d.claim).toHaveBeenCalledWith(OUTPUT_REQUEST_CLAIM_LIMIT)
    expect(d.generate.mock.calls.map((c) => c[0].id)).toEqual(['a', 'b'])
    expect(d.finish.mock.calls).toEqual([
      ['a', 'done', null],
      ['b', 'done', null],
    ])
    // A short claim: the next one is the slow poll.
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS - 1)
    expect(d.claim).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(d.claim).toHaveBeenCalledTimes(2)
  })

  it('claims again soon after a full claim', async () => {
    vi.useFakeTimers()
    const { d, claims } = deps()
    claims.push(Array.from({ length: OUTPUT_REQUEST_CLAIM_LIMIT }, (_, i) => request(`r${i}`)))
    createOutputRequestWorker(d, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.claim).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_WAKE_MS)
    expect(d.claim).toHaveBeenCalledTimes(2)
  })

  it('fails what cannot be made, and leaves what this machine cannot make now', async () => {
    vi.useFakeTimers()
    const results: Record<string, EnsureVersionOutputResult> = {
      bad: { status: 'failed', error: 'x', errorCode: 'EXPORT_FAILED' },
      open: { status: 'failed', error: 'open', errorCode: 'SAME_NAME_OPEN' },
      unsupported: { status: 'unsupported' },
      gone: { status: 'needs_solidworks', reason: 'service_offline' },
      after: generated,
    }
    const { d, claims } = deps({ generate: vi.fn(async (r: OutputRequest) => results[r.id]) })
    claims.push(['bad', 'open', 'unsupported', 'gone', 'after'].map(request))
    createOutputRequestWorker(d, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.finish.mock.calls).toEqual([
      ['bad', 'failed', 'EXPORT_FAILED'],
      ['unsupported', 'failed', 'UNSUPPORTED'],
    ])
    // SOLIDWORKS went away: the rest stays claimed for any machine to take later.
    expect(d.generate.mock.calls.map((c) => c[0].id)).not.toContain('after')
  })

  it('waits for the app queue, the setting and SOLIDWORKS', async () => {
    vi.useFakeTimers()
    let busy = true
    let enabled = true
    let can = false
    const { d } = deps({ queueBusy: vi.fn(() => busy), enabled: vi.fn(() => enabled), canGenerate: vi.fn(async () => can) })
    const worker = createOutputRequestWorker(d, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.canGenerate).not.toHaveBeenCalled()
    busy = false
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_BUSY_MS)
    expect(d.canGenerate).toHaveBeenCalledTimes(1)
    expect(d.claim).not.toHaveBeenCalled()
    can = true
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS)
    expect(d.claim).toHaveBeenCalledTimes(1)
    // Off: no claims and no polling, until woken.
    enabled = false
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS * 3)
    expect(d.claim).toHaveBeenCalledTimes(1)
    enabled = true
    worker.wake()
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_WAKE_MS)
    expect(d.claim).toHaveBeenCalledTimes(2)
  })

  it('backs off after failed claims, up to a bound', async () => {
    vi.useFakeTimers()
    const { d } = deps({ claim: vi.fn(async () => Promise.reject(new Error('offline'))) })
    createOutputRequestWorker(d, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.claim).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS)
    expect(d.claim).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS)
    expect(d.claim).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS)
    expect(d.claim).toHaveBeenCalledTimes(3)
    // Never longer than the bound.
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_BACKOFF_MAX_MS * 3)
    expect(d.claim.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('debounces wakes into one claim, and a wake while busy claims soon after', async () => {
    vi.useFakeTimers()
    let release: () => void = () => undefined
    const { d, claims } = deps({
      generate: vi.fn(
        () =>
          new Promise<EnsureVersionOutputResult>((resolve) => {
            release = () => resolve(generated)
          }),
      ),
    })
    const worker = createOutputRequestWorker(d)
    for (let i = 0; i < 20; i++) worker.wake()
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_WAKE_MS)
    expect(d.claim).toHaveBeenCalledTimes(1)
    claims.push([request('a')])
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS)
    expect(d.generate).toHaveBeenCalledTimes(1)
    worker.wake()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(d.claim).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_WAKE_MS)
    expect(d.claim).toHaveBeenCalledTimes(3)
  })

  it('stops: no finish for the running request, no timer after', async () => {
    vi.useFakeTimers()
    let release: () => void = () => undefined
    const { d, claims } = deps({
      generate: vi.fn(
        () =>
          new Promise<EnsureVersionOutputResult>((resolve) => {
            release = () => resolve(generated)
          }),
      ),
    })
    claims.push([request('a'), request('b')])
    const worker = createOutputRequestWorker(d, 0)
    await vi.advanceTimersByTimeAsync(0)
    worker.stop()
    release()
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_POLL_MS * 10)
    expect(d.finish).not.toHaveBeenCalled()
    expect(d.generate).toHaveBeenCalledTimes(1)
    expect(d.claim).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the app worker', () => {
  it('stops at sign-out or an organization change', async () => {
    vi.useFakeTimers()
    h.rpc.mockResolvedValue({ data: [], error: null })
    const stop = startOutputRequestWorker('org')
    resetOutputQueue()
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_START_MS * 2)
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.listeners).toHaveLength(0)
    stop()
  })

  it('never runs on the web', async () => {
    vi.useFakeTimers()
    h.desktop = false
    startOutputRequestWorker('org')
    await vi.advanceTimersByTimeAsync(OUTPUT_REQUEST_START_MS * 2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a second start replaces the first, and stop leaves nothing running', async () => {
    vi.useFakeTimers()
    startOutputRequestWorker('org')
    const stop = startOutputRequestWorker('org')
    expect(vi.getTimerCount()).toBe(1)
    expect(h.listeners).toHaveLength(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.listeners).toHaveLength(0)
  })

  it('tells listeners about request changes from realtime', () => {
    const heard: string[] = []
    const off = onOutputRequestChange((r) => heard.push(`${r.id}:${r.status}`))
    handleOutputRequestEvent(row('a', { status: 'done' }))
    handleOutputRequestEvent({ not: 'a row' })
    off()
    handleOutputRequestEvent(row('b'))
    expect(heard).toEqual(['a:done'])
  })
})
