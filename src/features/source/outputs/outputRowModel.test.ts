import { describe, expect, it } from 'vitest'

import {
  mergeFileOutputVersions,
  outputJobKey,
  type FileOutputVersion,
  type OutputJob,
} from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

import {
  fileOutputEntries,
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

function output(kind: VersionOutputKind, configuration: string | null = null, fileId = 'f1'): VersionOutput {
  return {
    id: `${kind}-${configuration ?? ''}`,
    kind,
    fileId,
    fileVersionId: 'v3',
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
  return { latest, outputs: [], jobs: new Map(), canGenerate: true, ...over }
}

const jobs = (...list: OutputJob[]) => new Map(list.map((j) => [j.key, j]))

describe('fileOutputEntries', () => {
  const drawing = local('a/D.SLDDRW', 'f1')
  const part = local('a/P.sldprt', 'f1')

  it('shows a Generate ghost for the primary kind only, once the outputs are loaded', () => {
    expect(fileOutputEntries(drawing, inputs())).toEqual([{ kind: 'pdf', output: null, job: null, state: 'missing' }])
    expect(fileOutputEntries(part, inputs()).map((e) => [e.kind, e.state])).toEqual([['step', 'missing']])
    expect(fileOutputEntries(drawing, inputs({ outputs: undefined }))).toEqual([])
    expect(fileOutputEntries(drawing, inputs({ canGenerate: false }))).toEqual([])
  })

  it('lists recorded outputs of every kind, the primary first', () => {
    const rows = fileOutputEntries(drawing, inputs({ outputs: [output('pdf'), output('dxf')] }))
    expect(rows.map((e) => [e.kind, e.state])).toEqual([
      ['pdf', 'ready'],
      ['dxf', 'ready'],
    ])
    const stepRows = fileOutputEntries(part, inputs({ outputs: [output('step'), output('step', 'Long'), output('stl')] }))
    expect(stepRows.map((e) => [e.kind, e.output?.configuration])).toEqual([
      ['step', null],
      ['step', 'Long'],
      ['stl', null],
    ])
  })

  it('shows queued and running jobs, also for kinds without a ghost', () => {
    const queued = fileOutputEntries(drawing, inputs({ jobs: jobs(job('f1', 'pdf', {})) }))
    expect(queued.map((e) => e.state)).toEqual(['queued'])
    const running = fileOutputEntries(
      part,
      inputs({ canGenerate: false, jobs: jobs(job('f1', 'iges', { status: 'running', fileVersionId: 'v3' })) }),
    )
    expect(running.map((e) => [e.kind, e.state])).toEqual([['iges', 'running']])
  })

  it('keeps a recorded output ready while it is regenerated', () => {
    const rows = fileOutputEntries(
      drawing,
      inputs({ outputs: [output('pdf')], jobs: jobs(job('f1', 'pdf', { status: 'running', fileVersionId: 'v3' })) }),
    )
    expect(rows[0].state).toBe('ready')
    expect(rows[0].job?.status).toBe('running')
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
    expect(fileOutputEntries(drawing, inputs({ outputs: [output('pdf', null, 'other')] }))[0].state).toBe('missing')
    expect(fileOutputEntries(local('a/D.slddrw', null), inputs())).toEqual([])
    expect(fileOutputEntries(local('a/notes.txt', 'f1'), inputs())).toEqual([])
    expect(fileOutputEntries({ ...drawing, isDirectory: true }, inputs())).toEqual([])
  })
})

describe('menus', () => {
  it('offers Save next to file on the desktop only and Regenerate to administrators', () => {
    expect(outputMenuItems({ desktop: true, isAdmin: false, hasLocalFolder: true, busy: false })).toEqual({
      open: true,
      saveCopy: true,
      saveNextToFile: true,
      copyName: true,
      regenerate: false,
    })
    const web = outputMenuItems({ desktop: false, isAdmin: true, hasLocalFolder: true, busy: false })
    expect(web.saveNextToFile).toBe(false)
    expect(web.regenerate).toBe(false)
    expect(outputMenuItems({ desktop: true, isAdmin: true, hasLocalFolder: true, busy: false }).regenerate).toBe(true)
    expect(outputMenuItems({ desktop: true, isAdmin: true, hasLocalFolder: true, busy: true }).regenerate).toBe(false)
    expect(outputMenuItems({ desktop: true, isAdmin: true, hasLocalFolder: false, busy: false }).saveNextToFile).toBe(false)
  })

  it('counts checked-in drawings and models for Generate PDF / Generate STEP', () => {
    const files = [
      local('D1.slddrw', 'd1'),
      local('D2.SLDDRW', 'd2'),
      local('P.sldprt', 'p'),
      local('A.SLDASM', 'a'),
      local('New.sldprt', null),
      local('notes.pdf', 'n'),
    ]
    expect(generateMenuKinds(files)).toEqual({ pdf: 2, step: 2 })
    expect(generateMenuKinds([local('New.slddrw', null)])).toEqual({ pdf: 0, step: 0 })
  })

  it('plans one job per checked-in file of the kind, with its version', () => {
    const files = [local('D.slddrw', 'd', 4), local('P.sldprt', 'p', 2), local('P.sldprt', 'p', 2), local('New.slddrw', null)]
    expect(generateJobs(files, 'pdf')).toEqual([{ fileId: 'd', version: 4, kind: 'pdf', fileName: 'D.slddrw' }])
    expect(generateJobs(files, 'step')).toEqual([{ fileId: 'p', version: 2, kind: 'step', fileName: 'P.sldprt' }])
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

  it('resolves unknown or outdated versions and loads the rest when newly expanded', () => {
    const versions = new Map([
      ['d', { version: 3, fileVersionId: 'dv3' }],
      ['p', { version: 1, fileVersionId: 'pv1' }],
    ])
    const plan = outputsToLoad([d, p], expanded, new Set(), versions, new Map([['dv3', []]]), new Set())
    expect(plan).toEqual({ resolve: [{ fileId: 'p', version: 2 }], load: ['dv3'] })
  })

  it('reads nothing for files that stayed expanded and are loaded, or are in flight', () => {
    const versions = new Map([['d', { version: 3, fileVersionId: 'dv3' }]])
    expect(outputsToLoad([d], expanded, expanded, versions, new Map([['dv3', []]]), new Set())).toEqual({
      resolve: [],
      load: [],
    })
    expect(outputsToLoad([p], expanded, new Set(), new Map(), new Map(), new Set(['p']))).toEqual({ resolve: [], load: [] })
  })

  it('skips collapsed, local-only and non-CAD files', () => {
    const files = [local('X.slddrw', 'x'), local('L.sldprt', null), local('n.pdf', 'n')]
    const all = new Set(files.map((f) => f.path).filter((path) => path !== 'X.slddrw'))
    expect(outputsToLoad(files, all, new Set(), new Map(), new Map(), new Set())).toEqual({ resolve: [], load: [] })
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
