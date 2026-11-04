import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  desktop: true,
  queued: [] as unknown[],
  ensured: [] as unknown[],
  jobs: new Map<string, { status: string }>(),
  listeners: [] as Array<(s: unknown, p: unknown) => void>,
}))

vi.mock('@/lib/platform', () => ({ hasDesktop: () => h.desktop }))
vi.mock('@/lib/outputs', () => ({
  queueOutputs: (jobs: unknown[]) => {
    h.queued.push(...jobs)
    return jobs.length
  },
  ensureVersionOutput: async (...args: unknown[]) => {
    h.ensured.push(args)
    return { status: 'generated', output: {} }
  },
}))
vi.mock('@/stores/slices/outputsSlice', () => ({
  outputJobKey: (fileId: string, kind: string, configuration: string | null) => `${fileId}:${kind}:${configuration ?? ''}`,
}))
vi.mock('@/stores/pdmStore', () => {
  const state = () => ({
    organization: { id: 'org' },
    outputJobs: h.jobs,
    upsertOutputJob: (job: { key: string; status: string }) => h.jobs.set(job.key, job),
  })
  return {
    usePDMStore: {
      getState: state,
      subscribe: (fn: (s: unknown, p: unknown) => void) => {
        h.listeners.push(fn)
        return () => undefined
      },
    },
  }
})

import type { LineOutputState, SupplyOrderLine } from '@/types/orders'

import { generateMissingOutputs, missingOutputJobs } from './generate'

function line(p: Partial<SupplyOrderLine>): SupplyOrderLine {
  return {
    id: 'l1',
    orderId: 'o',
    orgId: 'org',
    position: 1,
    fileId: 'part',
    fileVersionId: 'part-v2',
    vaultId: 'vault',
    drawingVaultId: null,
    configuration: null,
    drawingFileId: 'drw',
    drawingVersionId: 'drw-v4',
    quantity: 1,
    outputKinds: ['pdf', 'step', 'source'],
    notes: null,
    fileName: 'A.sldprt',
    partNumber: null,
    description: null,
    revision: null,
    version: 2,
    drawingFileName: 'A.slddrw',
    drawingVersion: 4,
    sentOutputs: null,
    missingKinds: null,
    addedBy: null,
    addedAt: '',
    updatedAt: null,
    ...p,
  }
}

const missing = (kinds: LineOutputState['kind'][], included = true): LineOutputState[] =>
  kinds.map((kind) => ({ kind, status: 'missing', included }))

beforeEach(() => {
  h.desktop = true
  h.queued = []
  h.ensured = []
  h.jobs = new Map()
})

describe('missingOutputJobs', () => {
  it('makes one job per version and kind across lines, never for source or kinds left out', () => {
    const a = line({ id: 'a' })
    const b = line({ id: 'b', fileId: 'other', fileVersionId: 'other-v1', fileName: 'B.sldprt', version: 1 })
    const states = new Map([
      ['a', [...missing(['pdf', 'step', 'source']), ...missing(['stl'], false)]],
      ['b', missing(['pdf'])],
    ])
    const jobs = missingOutputJobs([a, b], states)
    expect(jobs.map((j) => [j.fileVersionId, j.kind, j.version])).toEqual([
      ['drw-v4', 'pdf', 4],
      ['part-v2', 'step', 2],
    ])
  })

  it('skips sent lines', () => {
    const sent = line({ sentOutputs: [] })
    expect(missingOutputJobs([sent], new Map([['l1', missing(['step'])]]))).toEqual([])
  })
})

describe('generateMissingOutputs', () => {
  it('is desktop only', () => {
    h.desktop = false
    expect(generateMissingOutputs([line({})], new Map()).status).toBe('desktop_only')
  })

  it('queues saved-configuration jobs and runs a configuration by version id', async () => {
    const configured = line({ id: 'c', configuration: 'Long', outputKinds: ['step'] })
    const result = generateMissingOutputs(
      [line({}), configured],
      new Map([
        ['l1', missing(['pdf'])],
        ['c', missing(['step'])],
      ]),
    )
    expect(result.status).toBe('queued')
    expect(h.queued).toEqual([{ fileId: 'drw', version: 4, kind: 'pdf', fileName: 'A.slddrw' }])
    // The queue's job finishes; then the configured export runs.
    h.jobs.set('drw:pdf:', { status: 'done' })
    for (const fn of h.listeners) fn({ outputJobs: h.jobs }, { outputJobs: new Map() })
    if (result.status === 'queued') await result.done
    expect(h.ensured).toEqual([['part-v2', 'step', { configuration: 'Long' }]])
    expect(h.jobs.get('part:step:Long')?.status).toBe('done')
  })
})
