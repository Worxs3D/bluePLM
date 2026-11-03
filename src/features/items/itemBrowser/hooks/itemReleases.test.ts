import { describe, expect, it } from 'vitest'

import type { ItemRow } from '@/types/item'
import type { PDMFile } from '@/types/pdm'
import type { VersionRelease } from '@/types/releases'

import { applyItemReleases, releaseFetchPlan } from './itemReleases'

const row = (version: number): ItemRow => ({
  itemNumber: 'BR-1',
  description: null,
  revision: 'C',
  workflowStateName: 'WIP',
  workflowStateColor: '#aaa',
  fileTypes: ['part'],
  fileCount: 1,
  lastModified: null,
  files: [{ id: 'f1', version } as unknown as PDMFile],
  primaryFile: null,
  designation: null,
  designationId: null,
  designationIsOverride: false,
  primaryFileId: 'f1',
})

const rel = (version: number, revision: string, forced = false): VersionRelease => ({
  fileId: 'f1',
  fileVersionId: `v${version}`,
  version,
  revision,
  releasedAt: '2026-11-03T10:00:00Z',
  releasedBy: null,
  forced,
  reviewId: null,
  note: null,
})

const stages = [
  { id: 's1', name: 'WIP', label: null, color: '#aaa' },
  { id: 's2', name: 'Released', label: null, color: '#0f0' },
]

describe('applyItemReleases', () => {
  it('shows the released version first and the newer WIP version as secondary', () => {
    const [out] = applyItemReleases([row(7)], new Map([['f1', [rel(5, 'B'), rel(3, 'A')]]]), stages)
    expect(out.revision).toBe('B')
    expect(out.workflowStateName).toBe('Released')
    expect(out.workflowStateColor).toBe('#0f0')
    expect(out.release).toEqual({
      fileVersionId: 'v5',
      version: 5,
      revision: 'B',
      forced: false,
      wip: { version: 7, revision: 'C', stateName: 'WIP' },
    })
  })

  it('keeps the current state when the latest version is the released one', () => {
    const r = row(5)
    r.workflowStateName = 'Obsolete'
    const [out] = applyItemReleases([r], new Map([['f1', [rel(5, 'B', true)]]]), stages)
    expect(out.workflowStateName).toBe('Obsolete')
    expect(out.release?.wip).toBeNull()
    expect(out.release?.forced).toBe(true)
  })

  it('leaves a row with no release, or not loaded yet, unchanged', () => {
    const r = row(2)
    expect(applyItemReleases([r], new Map([['f1', []]]), stages)[0]).toBe(r)
    expect(applyItemReleases([r], new Map(), stages)[0]).toBe(r)
  })

  it('falls back to the translated name when no stage is named Released', () => {
    const [out] = applyItemReleases([row(7)], new Map([['f1', [rel(5, 'B')]]]), [])
    expect(out.workflowStateName).toBe('Released')
    expect(out.workflowStateColor).toBeNull()
  })
})

describe('releaseFetchPlan', () => {
  it('asks for files not read yet or changed since, once each', () => {
    const plan = releaseFetchPlan(
      [
        { fileId: 'a', signature: '1:s' },
        { fileId: 'b', signature: '2:s' },
        { fileId: 'b', signature: '2:s' },
        { fileId: 'c', signature: '4:t' },
      ],
      new Map([
        ['a', '1:s'],
        ['c', '3:s'],
      ]),
    )
    expect(plan).toEqual(['b', 'c'])
  })
})
