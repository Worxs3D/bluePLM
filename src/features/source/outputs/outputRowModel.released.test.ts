import { describe, expect, it } from 'vitest'

import { toggleSetKey } from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionRelease } from '@/types/releases'
import type { VersionedOutput, VersionOutputKind } from '@/types/versionOutputs'

import { columnOutput, fileOutputEntries, outputMenuItems, OUTPUT_REASON_CODES } from './outputRowModel'

function local(path: string, version: number): LocalFile {
  return { name: path, path, relativePath: path, isDirectory: false, pdmData: { id: 'f1', version } } as unknown as LocalFile
}

function out(kind: VersionOutputKind, version: number, configuration: string | null = null): VersionedOutput {
  return {
    id: `${kind}-${version}-${configuration ?? ''}`,
    kind,
    fileId: 'f1',
    fileVersionId: `v${version}`,
    version,
    configuration,
    storageHash: 'a'.repeat(64),
    fileSize: 1,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: '2026-11-03T00:00:00Z',
  }
}

const release = (version: number, revision: string | null = 'B'): VersionRelease => ({
  fileId: 'f1',
  fileVersionId: `v${version}`,
  version,
  revision,
  releasedAt: '2026-11-01T00:00:00Z',
  releasedBy: null,
  forced: false,
  reviewId: null,
  note: null,
})

const rows = (file: LocalFile, heads: VersionedOutput[], releases: VersionRelease[], byVersion: [string, VersionedOutput[]][] = []) =>
  fileOutputEntries(file, {
    latest: undefined,
    heads,
    jobs: new Map(),
    canGenerate: true,
    releases,
    versionOutputs: new Map(byVersion),
  }).map((e) => [e.kind, e.output?.version ?? null, e.released?.version ?? null, e.secondary, e.stale])

describe('released exports first (5.9.0)', () => {
  const part = local('P.sldprt', 5)

  it('lists the released export, then the newer work in progress, stale only on the newest', () => {
    expect(rows(part, [out('step', 4)], [release(2)], [['v2', [out('step', 2)]]])).toEqual([
      ['step', 2, 2, false, false],
      ['step', 4, null, true, true],
    ])
  })

  it('marks the released row stale when nothing newer exists and the file moved on', () => {
    expect(rows(part, [out('step', 2)], [release(2)], [['v2', [out('step', 2)]]])).toEqual([['step', 2, 2, false, true]])
  })

  it('knows a head of the released version is released before its outputs are read', () => {
    expect(rows(part, [out('step', 2)], [release(2)])).toEqual([['step', 2, 2, false, true]])
  })

  it('uses the newest release only, and keeps configurations apart', () => {
    const entries = rows(
      part,
      [out('step', 5, 'Long'), out('step', 3)],
      [release(3), release(1)],
      [['v3', [out('step', 3)]]],
    )
    expect(entries).toEqual([
      ['step', 3, 3, false, true],
      ['step', 5, null, false, false],
    ])
  })

  it('lists work in progress as before when nothing is released', () => {
    expect(rows(part, [out('step', 5)], [])).toEqual([['step', 5, null, false, false]])
  })
})

describe('columnOutput', () => {
  it('shows the released export and takes the stale mark from the newest', () => {
    const column = columnOutput('f1', 'pdf', 5, [out('pdf', 4)], [release(2)], new Map([['v2', [out('pdf', 2)]]]))
    expect([column.shown?.version, column.released?.version, column.newest?.version, column.stale]).toEqual([2, 2, 4, true])
  })

  it('shows the newest when no release has the kind', () => {
    const column = columnOutput('f1', 'pdf', 4, [out('pdf', 4)], [release(2)], new Map([['v2', [out('step', 2)]]]))
    expect([column.shown?.version, column.released, column.stale]).toEqual([4, null, false])
  })
})

describe('frozen released exports', () => {
  const desk = { desktop: true, isAdmin: true, canGenerate: true, stale: true, hasLocalFolder: true, busy: false }

  it('offers no Regenerate and no Delete on a released export', () => {
    expect(outputMenuItems(desk)).toMatchObject({ regenerate: true, delete: true })
    expect(outputMenuItems({ ...desk, released: true })).toMatchObject({ regenerate: false, delete: false, open: true, saveCopy: true })
  })

  it('explains a RELEASED refusal', () => {
    expect(OUTPUT_REASON_CODES).toContain('RELEASED')
  })
})

describe('section toggles', () => {
  it('flips a key and drops the oldest past the cap', () => {
    let set = toggleSetKey(new Set(), 'a', 2)
    set = toggleSetKey(set, 'b', 2)
    set = toggleSetKey(set, 'c', 2)
    expect([...set]).toEqual(['b', 'c'])
    expect([...toggleSetKey(set, 'b', 2)]).toEqual(['c'])
  })
})
