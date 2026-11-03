import { describe, expect, it } from 'vitest'

import type { OutputJob } from '@/stores/slices/outputsSlice'
import { mergeOutputJob, mergeVersionOutputs } from '@/stores/slices/outputsSlice'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

import type { LocalFile } from '@/stores/types'

import {
  checkinCandidates,
  createOutputQueue,
  existingOutputKinds,
  planCheckinOutputs,
  queuedJobKey,
  SAME_NAME_MAX_ATTEMPTS,
  SAME_NAME_RETRY_MS,
  type CheckinOutputCandidate,
  type OutputQueueDeps,
} from './autoQueue'
import type { EnsureVersionOutputResult } from './ensure'

const both = { pdf: true, step: true }
const file = (id: string, path: string): CheckinOutputCandidate => ({
  fileId: id,
  version: 2,
  path,
  fileName: path.split('/').pop() ?? path,
})

const output = (fileVersionId: string, kind: VersionOutputKind): VersionOutput => ({
  id: `${fileVersionId}-${kind}`,
  kind,
  fileId: 'f',
  fileVersionId,
  configuration: null,
  storageHash: 'a'.repeat(64),
  fileSize: 1,
  fileName: null,
  closureExact: true,
  generatedBy: null,
  generatedAt: '2026-11-03T00:00:00Z',
})

describe('planCheckinOutputs', () => {
  it('plans a PDF per drawing and a STEP per part or assembly', () => {
    const plan = planCheckinOutputs(
      [file('d', 'a/D.SLDDRW'), file('p', 'a/P.sldprt'), file('s', 'a/S.SLDASM'), file('x', 'a/notes.pdf')],
      both,
    )
    expect(plan.skipped).toBeNull()
    expect(plan.jobs.map((j) => [j.fileId, j.kind])).toEqual([
      ['d', 'pdf'],
      ['p', 'step'],
      ['s', 'step'],
    ])
  })

  it('follows the setting, the batch cap, and dedupes', () => {
    expect(planCheckinOutputs([file('d', 'D.slddrw')], { pdf: false, step: false }).skipped).toBe('disabled')
    expect(planCheckinOutputs([file('d', 'D.slddrw')], { pdf: false, step: true }).skipped).toBe('nothing_to_do')
    const many = Array.from({ length: 26 }, (_, i) => file(`p${i}`, `P${i}.sldprt`))
    expect(planCheckinOutputs(many, both).skipped).toBe('batch_too_large')
    expect(planCheckinOutputs(many.slice(0, 25), both).jobs).toHaveLength(25)
    expect(planCheckinOutputs([file('p', 'P.sldprt'), file('p', 'P.sldprt')], both).jobs).toHaveLength(1)
  })
})

describe('planCheckinOutputs per file (5.9.0)', () => {
  const kinds = (plan: ReturnType<typeof planCheckinOutputs>) => plan.jobs.map((j) => `${j.fileId}:${j.kind}`)

  it('adds every kind a file already has an export of, in kind order', () => {
    const plan = planCheckinOutputs([file('d', 'D.slddrw'), file('p', 'P.sldprt')], both, 25, {
      existing: new Map([
        ['d', ['step', 'dxf']],
        ['p', ['stl']],
      ]),
    })
    expect(kinds(plan)).toEqual(['d:pdf', 'd:dxf', 'd:step', 'p:step', 'p:stl'])
  })

  it('drops the kinds a file turned off, the organization kind too', () => {
    const plan = planCheckinOutputs([file('d', 'D.slddrw'), file('p', 'P.sldprt')], both, 25, {
      existing: new Map([['d', ['dxf']]]),
      off: new Map([
        ['d', ['pdf']],
        ['p', ['step']],
      ]),
    })
    expect(kinds(plan)).toEqual(['d:dxf'])
  })

  it('regenerates existing kinds even when the organization setting is off', () => {
    const off = { pdf: false, step: false }
    expect(planCheckinOutputs([file('p', 'P.sldprt')], off).skipped).toBe('disabled')
    const plan = planCheckinOutputs([file('p', 'P.sldprt')], off, 25, { existing: new Map([['p', ['iges']]]) })
    expect(kinds(plan)).toEqual(['p:iges'])
  })

  it('ignores a kind the file cannot have, and keeps the batch cap', () => {
    const plan = planCheckinOutputs([file('p', 'P.sldprt')], both, 25, { existing: new Map([['p', ['pdf']]]) })
    expect(kinds(plan)).toEqual(['p:step'])
    const many = Array.from({ length: 26 }, (_, i) => file(`p${i}`, `P${i}.sldprt`))
    expect(planCheckinOutputs(many, both, 25, { existing: new Map([['p0', ['stl']]]) }).skipped).toBe('batch_too_large')
  })

  it('reads existing kinds from the saved configuration only', () => {
    const heads = new Map([
      ['p', [{ kind: 'step' as const, configuration: 'Long' }, { kind: 'stl' as const, configuration: null }]],
      ['q', [{ kind: 'step' as const, configuration: 'Short' }]],
    ])
    expect(existingOutputKinds(heads)).toEqual(new Map([['p', ['stl']]]))
  })
})

/** A queue on a fake clock, with `ensure` answered from a script. */
function harness(answers: Array<EnsureVersionOutputResult | Error>) {
  let clock = 0
  const timers: Array<{ at: number; run: () => void }> = []
  const jobs: OutputJob[] = []
  const outputs: string[] = []
  const calls: string[] = []
  let running = 0
  let maxRunning = 0
  const deps: OutputQueueDeps = {
    now: () => clock,
    setTimer: (run, ms) => timers.push({ at: clock + ms, run }),
    resolveVersion: async (fileId, version) => (fileId === 'gone' ? null : `${fileId}-v${version}`),
    ensure: async (fileVersionId, kind) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      calls.push(`${fileVersionId}:${kind}`)
      await Promise.resolve()
      running--
      const next = answers.shift() ?? { status: 'cached', output: output(fileVersionId, kind) }
      if (next instanceof Error) throw next
      return next
    },
    onJob: (job) => jobs.push(job),
    onOutput: (id) => outputs.push(id),
  }
  const advance = (ms: number) => {
    clock += ms
    for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (t.at <= clock) t.run()
      else timers.push(t)
    }
  }
  return { deps, jobs, outputs, calls, advance, maxRunning: () => maxRunning, timers }
}

const lastStatus = (jobs: OutputJob[], fileId: string) =>
  [...jobs].reverse().find((j) => j.fileId === fileId)?.status

describe('createOutputQueue', () => {
  it('runs one job at a time and reports every outcome', async () => {
    const h = harness([
      { status: 'generated', output: output('a-v2', 'pdf') },
      { status: 'needs_solidworks', reason: 'service_offline' },
      { status: 'failed', error: 'boom', errorCode: 'EXPORT_FAILED' },
      new Error('network'),
    ])
    const q = createOutputQueue(h.deps)
    const added = q.enqueue([
      { fileId: 'a', version: 2, kind: 'pdf', fileName: 'A.slddrw' },
      { fileId: 'b', version: 2, kind: 'step', fileName: 'B.sldprt' },
      { fileId: 'c', version: 2, kind: 'step', fileName: 'C.sldprt' },
      { fileId: 'd', version: 2, kind: 'step', fileName: 'D.sldprt' },
      { fileId: 'gone', version: 2, kind: 'step', fileName: 'G.sldprt' },
    ])
    expect(added).toBe(5)
    await q.idle()
    expect(h.maxRunning()).toBe(1)
    expect(h.calls).toEqual(['a-v2:pdf', 'b-v2:step', 'c-v2:step', 'd-v2:step'])
    expect(lastStatus(h.jobs, 'a')).toBe('done')
    expect(lastStatus(h.jobs, 'b')).toBe('skipped')
    expect(lastStatus(h.jobs, 'c')).toBe('failed')
    expect(lastStatus(h.jobs, 'd')).toBe('failed')
    expect(lastStatus(h.jobs, 'gone')).toBe('skipped')
    expect(h.outputs).toEqual(['a-v2'])
    expect(q.size()).toBe(0)
  })

  it('drops duplicates of waiting jobs and jobs past the cap', async () => {
    const h = harness([])
    const q = createOutputQueue(h.deps, 2)
    const job = { fileId: 'a', version: 1, kind: 'step' as const, fileName: 'A' }
    expect(q.enqueue([job, job, { ...job, fileId: 'b' }, { ...job, fileId: 'c' }])).toBe(2)
    await q.idle()
  })

  it('waits and retries while a same-named document is open, a bounded number of times', async () => {
    const sameName = { status: 'failed', error: 'A.SLDDRW', errorCode: 'SAME_NAME_OPEN' } as const
    const h = harness(Array.from({ length: SAME_NAME_MAX_ATTEMPTS }, () => sameName))
    const q = createOutputQueue(h.deps)
    q.enqueue([{ fileId: 'a', version: 1, kind: 'pdf', fileName: 'A' }])
    for (let i = 1; i < SAME_NAME_MAX_ATTEMPTS; i++) {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      expect(lastStatus(h.jobs, 'a')).toBe('queued')
      expect(h.calls).toHaveLength(i)
      h.advance(SAME_NAME_RETRY_MS)
    }
    await q.idle()
    expect(h.calls).toHaveLength(SAME_NAME_MAX_ATTEMPTS)
    expect(lastStatus(h.jobs, 'a')).toBe('failed')
  })
})

describe('regenerate (5.5.0, worker D)', () => {
  it('passes regenerate to ensure only for jobs that ask for it', async () => {
    const seen: Array<boolean | undefined> = []
    const h = harness([])
    const q = createOutputQueue({
      ...h.deps,
      ensure: async (fileVersionId, kind, options) => {
        seen.push(options?.regenerate)
        return { status: 'generated', output: output(fileVersionId, kind) }
      },
    })
    q.enqueue([{ fileId: 'a', version: 2, kind: 'pdf', fileName: 'A.slddrw', regenerate: true }], false)
    await q.idle()
    q.enqueue([{ fileId: 'b', version: 2, kind: 'step', fileName: 'B.sldprt' }], false)
    await q.idle()
    expect(seen).toEqual([true, undefined])
  })
})

describe('review fixes (5.5.0)', () => {
  it('leaves the version to the job: a check-in returns the files as they were before it', () => {
    // The check-in hands back the LocalFile it was given, still at the old version (1) after
    // creating version 2. Naming 1 here made the output of the previous version.
    const before = {
      name: 'P.sldprt',
      relativePath: 'a/P.sldprt',
      pdmData: { id: 'p', version: 1 },
    } as unknown as LocalFile
    expect(checkinCandidates([before])).toEqual([
      { fileId: 'p', version: null, path: 'a/P.sldprt', fileName: 'P.sldprt' },
    ])
  })

  it('keys waiting jobs by version and regenerate, so neither is dropped as a duplicate', async () => {
    const base = { fileId: 'a', version: 1, kind: 'step' as const, fileName: 'A' }
    expect(queuedJobKey(base)).not.toBe(queuedJobKey({ ...base, version: 2 }))
    expect(queuedJobKey(base)).not.toBe(queuedJobKey({ ...base, regenerate: true }))
    const h = harness([])
    const q = createOutputQueue(h.deps)
    expect(q.enqueue([base, { ...base, version: 2 }, { ...base, regenerate: true }, base])).toBe(3)
    await q.idle()
    expect(h.calls).toEqual(['a-v1:step', 'a-v2:step', 'a-v1:step'])
  })

  it('reset drops waiting jobs, ignores the running result and stops retry timers', async () => {
    const sameName = { status: 'failed', error: 'X', errorCode: 'SAME_NAME_OPEN' } as const
    const h = harness([sameName])
    const q = createOutputQueue(h.deps)
    q.enqueue([
      { fileId: 'a', version: 1, kind: 'pdf', fileName: 'A' },
      { fileId: 'b', version: 1, kind: 'step', fileName: 'B' },
    ])
    await new Promise((r) => setTimeout(r, 0))
    // a waits for its retry, b ran (cached).
    expect(lastStatus(h.jobs, 'a')).toBe('queued')
    q.reset()
    expect(q.size()).toBe(0)
    const seen = h.jobs.length
    h.advance(SAME_NAME_RETRY_MS)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls).toEqual(['a-v1:pdf', 'b-v1:step'])
    expect(h.jobs.length).toBe(seen)

    // A job running when reset happens reports nothing.
    const slow = harness([])
    const q2 = createOutputQueue(slow.deps)
    q2.enqueue([{ fileId: 'c', version: 1, kind: 'step', fileName: 'C' }])
    q2.reset()
    await new Promise((r) => setTimeout(r, 0))
    expect(slow.jobs.map((j) => j.status)).toEqual(['queued'])
    expect(slow.outputs).toEqual([])
  })
})

describe('outputs slice bounds', () => {
  it('keeps the most recently written versions', () => {
    let map = new Map<string, VersionOutput[]>()
    for (let i = 0; i < 5; i++) map = mergeVersionOutputs(map, new Map([[`v${i}`, []]]), 3)
    expect([...map.keys()]).toEqual(['v2', 'v3', 'v4'])
    map = mergeVersionOutputs(map, new Map([['v2', [output('v2', 'pdf')]]]), 3)
    expect([...map.keys()]).toEqual(['v3', 'v4', 'v2'])
  })

  it('drops finished jobs first and keeps active ones', () => {
    const job = (key: string, status: OutputJob['status']): OutputJob => ({
      key,
      fileId: key,
      fileVersionId: null,
      kind: 'step',
      configuration: null,
      fileName: key,
      status,
      detail: null,
      auto: true,
      updatedAt: 0,
    })
    let map = new Map<string, OutputJob>()
    map = mergeOutputJob(map, job('a', 'running'), 2)
    map = mergeOutputJob(map, job('b', 'done'), 2)
    map = mergeOutputJob(map, job('c', 'queued'), 2)
    expect([...map.keys()]).toEqual(['a', 'c'])
  })
})
