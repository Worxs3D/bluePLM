import { describe, expect, it } from 'vitest'

import type { ReviewItemDetail, ReviewItemOutcome } from '@/types/reviews'

import {
  defaultResubmitSelection,
  itemsNeedingNewVersion,
  newerVersionOptions,
  planResubmit,
  type VersionOption,
} from './resubmit'

function item(id: string, fileId: string, version: number, outcome: ReviewItemOutcome): ReviewItemDetail {
  return {
    id,
    fileId,
    vaultId: 'v',
    sortOrder: 0,
    outcome,
    addedInRound: 1,
    file: {
      fileName: `${fileId}.slddrw`,
      filePath: `${fileId}.slddrw`,
      extension: '.slddrw',
      partNumber: null,
      description: null,
      latestVersion: version + 2,
      deleted: false,
    },
    version: {
      fileVersionId: `${fileId}-v${version}`,
      version,
      revision: 'A',
      contentHash: 'h',
      fileSize: 1,
      state: null,
      createdAt: null,
      createdBy: null,
      referencesRecorded: true,
    },
    pdf: null,
    rounds: [],
  }
}

function versions(fileId: string, ...nums: number[]): VersionOption[] {
  return nums.map((n) => ({ fileVersionId: `${fileId}-v${n}`, version: n, revision: null, createdAt: null }))
}

const items = [
  item('i1', 'f1', 3, 'approved'),
  item('i2', 'f2', 5, 'changes_requested'),
  item('i3', 'f3', 2, 'rejected'),
]

describe('resubmit selection', () => {
  it('asks for a new version of every item not approved', () => {
    expect(itemsNeedingNewVersion(items).map((i) => i.id)).toEqual(['i2', 'i3'])
  })

  it('offers only newer versions, newest first', () => {
    expect(newerVersionOptions(items[1], versions('f2', 4, 5, 6, 7)).map((v) => v.version)).toEqual([7, 6])
  })

  it('defaults to the newest newer version, or nothing when there is none', () => {
    const selection = defaultResubmitSelection(items, {
      f2: versions('f2', 5, 6, 7),
      f3: versions('f3', 1, 2),
    })
    expect(selection).toEqual({ i2: 'f2-v7', i3: null })
  })

  it('is ready only when every item needing changes has a newer version', () => {
    const notReady = planResubmit(items, { i2: 'f2-v7', i3: null })
    expect(notReady.ready).toBe(false)
    expect(notReady.missing).toEqual(['i3'])

    const ready = planResubmit(items, { i2: 'f2-v7', i3: 'f3-v4' })
    expect(ready.ready).toBe(true)
    expect(ready.payload).toEqual([
      { itemId: 'i2', fileVersionId: 'f2-v7' },
      { itemId: 'i3', fileVersionId: 'f3-v4' },
    ])
  })

  it('refuses the version already reviewed', () => {
    expect(planResubmit(items, { i2: 'f2-v5', i3: 'f3-v4' }).missing).toEqual(['i2'])
  })
})
