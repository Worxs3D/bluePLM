import { describe, expect, it } from 'vitest'

import {
  mergeFileOutputVersions,
  outputJobKey,
  type FileOutputVersion,
  type OutputJob,
} from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionedOutput, VersionOutputKind } from '@/types/versionOutputs'

import {
  fileOutputEntries,
  filesInFolder,
  filesNeedingOutput,
  generateJobs,
  generateMenuKinds,
  outputCopyName,
  outputMenuItems,
  outputsToLoad,
  primaryOutputKind,
  type OutputRowInputs,
} from './outputRowModel'

function local(path: string, id: string | null, version = 3, extra: Partial<LocalFile> = {}): LocalFile {
  return {
    name: path.split('/').pop() ?? path,
    path,
    relativePath: path,
    isDirectory: false,
    extension: path.slice(path.lastIndexOf('.')),
    size: 0,
    modifiedTime: '',
    pdmData: id ? { id, version, part_number: 'BR-1', revision: 'A', description: 'Bracket' } : undefined,
    ...extra,
  } as unknown as LocalFile
}

function output(
  kind: VersionOutputKind,
  configuration: string | null = null,
  fileId = 'f1',
  version = 3,
): VersionedOutput {
  return {
    id: `${kind}-${configuration ?? ''}-${version}`,
    kind,
    fileId,
    fileVersionId: `v${version}`,
    version,
    configuration,
    storageHash: 'a'.repeat(64),
    fileSize: 10,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: '2026-11-03T00:00:00Z',
  }
}

function job(fileId: string, kind: VersionOutputKind, over: Partial<OutputJob>): OutputJob {
  return {
    key: outputJobKey(fileId, kind, null),
    fileId,
    fileVersionId: null,
    kind,
    configuration: null,
    fileName: 'x',
    status: 'queued',
    detail: null,
    auto: false,
    updatedAt: 0,
    ...over,
  }
}

const latest: FileOutputVersion = { version: 3, fileVersionId: 'v3' }

function inputs(over: Partial<OutputRowInputs> = {}): OutputRowInputs {
  return { latest, heads: [], jobs: new Map(), canGenerate: true, ...over }
}

const jobs = (...list: OutputJob[]) => new Map(list.map((j) => [j.key, j]))

describe('fileOutputEntries', () => {
  const drawing = local('a/D.SLDDRW', 'f1')
  const part = local('a/P.sldprt', 'f1')

  it('shows a Generate ghost for the primary kinds only, once the outputs are loaded', () => {
    expect(fileOutputEntries(drawing, inputs())).toEqual([
      { kind: 'pdf', output: null, job: null, state: 'missing', stale: false, released: null, secondary: false },
      { kind: 'step', output: null, job: null, state: 'missing', stale: false, released: null, secondary: false },
    ])
    expect(fileOutputEntries(part, inputs()).map((e) => [e.kind, e.state])).toEqual([['step', 'missing']])
    expect(fileOutputEntries(drawing, inputs({ heads: undefined }))).toEqual([])
    expect(fileOutputEntries(drawing, inputs({ canGenerate: false }))).toEqual([])
  })

  it('lists recorded outputs of every kind, a drawing PDF, DXF, STEP (5.9.0 order)', () => {
    const rows = fileOutputEntries(drawing, inputs({ heads: [output('pdf'), output('step'), output('dxf')] }))
    expect(rows.map((e) => [e.kind, e.state])).toEqual([
      ['pdf', 'ready'],
      ['dxf', 'ready'],
      ['step', 'ready'],
    ])
    const stepRows = fileOutputEntries(part, inputs({ heads: [output('step'), output('step', 'Long'), output('stl')] }))
    expect(stepRows.map((e) => [e.kind, e.output?.configuration])).toEqual([
      ['step', null],
      ['step', 'Long'],
      ['stl', null],
    ])
  })

  it('shows queued and running jobs, also for kinds without a ghost', () => {
    const queued = fileOutputEntries(drawing, inputs({ jobs: jobs(job('f1', 'pdf', {})) }))
    expect(queued.map((e) => [e.kind, e.state])).toEqual([
      ['pdf', 'queued'],
      ['step', 'missing'],
    ])
    const running = fileOutputEntries(
      part,
      inputs({ canGenerate: false, jobs: jobs(job('f1', 'iges', { status: 'running', fileVersionId: 'v3' })) }),
    )
    expect(running.map((e) => [e.kind, e.state])).toEqual([['iges', 'running']])
  })

  it('shows one row per kind: an output of an older version is stale, and its generation for the latest runs on it', () => {
    const old = output('pdf', null, 'f1', 2)
    const idle = fileOutputEntries(drawing, inputs({ heads: [old] }))
    expect(idle[0]).toMatchObject({ kind: 'pdf', output: old, state: 'ready', stale: true, job: null })
    const rows = fileOutputEntries(
      drawing,
      inputs({ heads: [old], jobs: jobs(job('f1', 'pdf', { status: 'running', fileVersionId: 'v3' })) }),
    )
    expect(rows.filter((e) => e.kind === 'pdf')).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'ready', stale: true })
    expect(rows[0].job?.status).toBe('running')
    expect(fileOutputEntries(drawing, inputs({ heads: [output('pdf')] }))[0].stale).toBe(false)
  })

  it('shows a failed job of this version, and ignores jobs of other versions', () => {
    const failed = job('f1', 'pdf', { status: 'failed', fileVersionId: 'v3', detail: 'EXPORT_FAILED' })
    expect(fileOutputEntries(drawing, inputs({ jobs: jobs(failed) }))[0]).toMatchObject({ state: 'failed', job: failed })
    const old = job('f1', 'pdf', { status: 'running', fileVersionId: 'v2' })
    expect(fileOutputEntries(drawing, inputs({ jobs: jobs(old) }))[0].state).toBe('missing')
    const oldFailed = job('f1', 'pdf', { status: 'failed', fileVersionId: 'v2' })
    expect(fileOutputEntries(drawing, inputs({ jobs: jobs(oldFailed) }))[0].state).toBe('missing')
  })

  it('ignores outputs of another file, folders, local-only files and other file types', () => {
    expect(fileOutputEntries(drawing, inputs({ heads: [output('pdf', null, 'other')] }))[0].state).toBe('missing')
    expect(fileOutputEntries(local('a/D.slddrw', null), inputs())).toEqual([])
    expect(fileOutputEntries(local('a/notes.txt', 'f1'), inputs())).toEqual([])
    expect(fileOutputEntries({ ...drawing, isDirectory: true }, inputs())).toEqual([])
  })
})

describe('menus', () => {
  it('offers Save next to file on the desktop only, and Regenerate only for an out-of-date output', () => {
    const base = { canGenerate: true, stale: false }
    expect(outputMenuItems({ ...base, desktop: true, isAdmin: false, hasLocalFolder: true, busy: false })).toEqual({
      open: true,
      saveCopy: true,
      saveNextToFile: true,
      copyName: true,
      regenerate: false,
      delete: false,
    })
    const web = outputMenuItems({ ...base, stale: true, desktop: false, isAdmin: true, hasLocalFolder: true, busy: false })
    expect(web.saveNextToFile).toBe(false)
    expect(web.regenerate).toBe(false)
    const desk = { desktop: true, isAdmin: false, hasLocalFolder: true, busy: false }
    expect(outputMenuItems({ ...desk, canGenerate: true, stale: false }).regenerate).toBe(false)
    expect(outputMenuItems({ ...desk, isAdmin: true, canGenerate: true, stale: false }).regenerate).toBe(false)
    expect(outputMenuItems({ ...desk, canGenerate: true, stale: true }).regenerate).toBe(true)
    expect(outputMenuItems({ ...desk, canGenerate: false, stale: true }).regenerate).toBe(false)
    expect(outputMenuItems({ ...desk, canGenerate: true, stale: true, busy: true }).regenerate).toBe(false)
    expect(outputMenuItems({ ...desk, ...base, hasLocalFolder: false }).saveNextToFile).toBe(false)
  })

  it('offers Delete to an administrator or the generator with explorer edit, not while a job runs', () => {
    const base = { desktop: true, hasLocalFolder: true, busy: false, canGenerate: true, stale: false }
    expect(outputMenuItems({ ...base, isAdmin: true }).delete).toBe(true)
    expect(outputMenuItems({ ...base, desktop: false, isAdmin: true }).delete).toBe(true)
    expect(outputMenuItems({ ...base, isAdmin: false }).delete).toBe(false)
    expect(outputMenuItems({ ...base, isAdmin: false, isGeneratorWithEdit: true }).delete).toBe(true)
    expect(outputMenuItems({ ...base, isAdmin: true, busy: true }).delete).toBe(false)
  })

  it('counts checked-in drawings and models for Generate PDF / Generate STEP (a drawing has both)', () => {
    const files = [
      local('D1.slddrw', 'd1'),
      local('D2.SLDDRW', 'd2'),
      local('P.sldprt', 'p'),
      local('A.SLDASM', 'a'),
      local('New.sldprt', null),
      local('notes.pdf', 'n'),
    ]
    expect(generateMenuKinds(files)).toEqual({ pdf: 2, step: 4, drawings: 2 })
    expect(generateMenuKinds([local('New.slddrw', null)])).toEqual({ pdf: 0, step: 0, drawings: 0 })
  })

  it('plans one job per checked-in file of the kind, with its version', () => {
    const files = [local('D.slddrw', 'd', 4), local('P.sldprt', 'p', 2), local('P.sldprt', 'p', 2), local('New.slddrw', null)]
    expect(generateJobs(files, 'pdf')).toEqual([{ fileId: 'd', version: 4, kind: 'pdf', fileName: 'D.slddrw' }])
    expect(generateJobs(files, 'step')).toEqual([
      { fileId: 'd', version: 4, kind: 'step', fileName: 'D.slddrw' },
      { fileId: 'p', version: 2, kind: 'step', fileName: 'P.sldprt' },
    ])
    expect(generateJobs(files, 'pdf', true)[0].regenerate).toBe(true)
  })

  it('names a copy by the organization export pattern', () => {
    const org = { settings: { export_settings: { filename_pattern: '{partNumber}_Rev{rev}' } } }
    expect(outputCopyName(output('step'), local('P.sldprt', 'p'), org)).toBe('BR-1_RevA.step')
    expect(outputCopyName(output('pdf'), local('D.slddrw', 'd'), org)).toBe('BR-1_RevA.pdf')
  })

  it('names the primary kind per file type', () => {
    expect(primaryOutputKind('x/D.SLDDRW')).toBe('pdf')
    expect(primaryOutputKind('x/A.sldasm')).toBe('step')
    expect(primaryOutputKind('x/n.txt')).toBeNull()
  })
})

describe('outputsToLoad', () => {
  const d = local('D.slddrw', 'd', 3)
  const p = local('P.sldprt', 'p', 2)
  const expanded = new Set([d.path, p.path])

  it('resolves unknown or outdated versions and reads heads of newly expanded files', () => {
    const versions = new Map([
      ['d', { version: 3, fileVersionId: 'dv3' }],
      ['p', { version: 1, fileVersionId: 'pv1' }],
    ])
    const heads = new Map([['d', []]])
    const plan = outputsToLoad([d, p], expanded, new Set(), versions, heads, new Map([['d', 3]]), new Set())
    expect(plan).toEqual({ resolve: [{ fileId: 'p', version: 2 }], heads: ['d', 'p'] })
  })

  it('reads nothing for files that stayed expanded and are loaded at their version, or are in flight', () => {
    const versions = new Map([['d', { version: 3, fileVersionId: 'dv3' }]])
    const heads = new Map([['d', []]])
    expect(outputsToLoad([d], expanded, expanded, versions, heads, new Map([['d', 3]]), new Set())).toEqual({
      resolve: [],
      heads: [],
    })
    // Read at an older version of the file: read again.
    expect(outputsToLoad([d], expanded, expanded, versions, heads, new Map([['d', 2]]), new Set()).heads).toEqual(['d'])
    expect(outputsToLoad([p], expanded, new Set(), new Map(), new Map(), new Map(), new Set(['p']))).toEqual({
      resolve: [],
      heads: [],
    })
  })

  it('reads the heads of drawings the Outputs column shows without resolving their version', () => {
    const plan = outputsToLoad([d, p], new Set(), new Set(), new Map(), new Map(), new Map(), new Set(), new Set([d.path]))
    expect(plan).toEqual({ resolve: [], heads: ['d'] })
  })

  it('skips collapsed, local-only and non-CAD files', () => {
    const files = [local('X.slddrw', 'x'), local('L.sldprt', null), local('n.pdf', 'n')]
    const all = new Set(files.map((f) => f.path).filter((path) => path !== 'X.slddrw'))
    expect(outputsToLoad(files, all, new Set(), new Map(), new Map(), new Map(), new Set())).toEqual({
      resolve: [],
      heads: [],
    })
  })
})

describe('bulk generate (toolbar)', () => {
  it('takes the files of a folder, directly or at any depth', () => {
    const files = [local('a/D.slddrw', 'd'), local('a/b/P.sldprt', 'p'), local('c/Q.sldprt', 'q')]
    expect(filesInFolder(files, 'a', false).map((f) => f.path)).toEqual(['a/D.slddrw'])
    expect(filesInFolder(files, 'a', true).map((f) => f.path)).toEqual(['a/D.slddrw', 'a/b/P.sldprt'])
    expect(filesInFolder(files, '', true)).toHaveLength(3)
  })

  it('needs an output that is missing, out of date or not read, and not one that is current or on the way', () => {
    const files = [
      local('D1.slddrw', 'd1', 3),
      local('D2.slddrw', 'd2', 3),
      local('D3.slddrw', 'd3', 3),
      local('D4.slddrw', 'd4', 3),
      local('D5.slddrw', 'd5', 3),
      local('P.sldprt', 'p', 3),
    ]
    const heads = new Map([
      ['d1', [output('pdf', null, 'd1', 3)]],
      ['d2', [output('pdf', null, 'd2', 2)]],
      ['d3', []],
      ['d5', []],
      ['p', []],
    ])
    const running = jobs(job('d5', 'pdf', { status: 'running' }))
    expect(filesNeedingOutput(files, 'pdf', heads, running).map((f) => f.pdmData?.id)).toEqual(['d2', 'd3', 'd4'])
    expect(filesNeedingOutput(files, 'step', heads, running).map((f) => f.pdmData?.id)).toEqual([
      'd1',
      'd2',
      'd3',
      'd4',
      'd5',
      'p',
    ])
  })
})

describe('fileOutputVersions (store)', () => {
  it('keeps the most recently written files up to the bound', () => {
    let map = new Map<string, FileOutputVersion>()
    for (let i = 0; i < 5; i++) map = mergeFileOutputVersions(map, new Map([[`f${i}`, { version: 1, fileVersionId: `v${i}` }]]), 3)
    expect([...map.keys()]).toEqual(['f2', 'f3', 'f4'])
    map = mergeFileOutputVersions(map, new Map([['f2', { version: 2, fileVersionId: 'v2b' }]]), 3)
    expect([...map.keys()]).toEqual(['f3', 'f4', 'f2'])
    expect(map.get('f2')?.version).toBe(2)
  })
})
