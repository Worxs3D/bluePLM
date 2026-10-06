import { describe, expect, it } from 'vitest'

import type { PDMFile } from '@/types/pdm'

import type { FieldComparison, FileDivergence } from './divergence'
import {
  buildMetadataRestorePlan,
  restoreStatesOf,
  type MetadataRestoreFileState,
} from './metadataRestorePlan'
import type { MetadataOverlaySource } from './overlay'

const USER_ID = 'user-me'
const OTHER_USER_ID = 'user-other'

function comparison(overrides: Partial<FieldComparison>): FieldComparison {
  return {
    field: 'part_number',
    scope: 'file',
    databaseValue: null,
    fileValue: 'BR-100077-01',
    databaseRepairValue: 'BR-100077',
    divergence: 'database-empty',
    recoverability: 'unattributed',
    unattributedReason: 'database-never-held-it',
    ...overrides,
  } as FieldComparison
}

function file(overrides: Partial<FileDivergence> & { fieldComparisons: FieldComparison[] }) {
  return {
    fileId: 'file-1',
    relativePath: 'ELEC/FATHOM-X-ELEC-PCB-R1.SLDPRT',
    fileName: 'FATHOM-X-ELEC-PCB-R1.SLDPRT',
    fileType: 'part',
    ...overrides,
  } as FileDivergence
}

const fathom = file({
  fieldComparisons: [
    comparison({}),
    comparison({
      field: 'description',
      fileValue: 'PCB, Fathom-X',
      databaseRepairValue: 'PCB, Fathom-X',
    }),
  ],
})

describe('buildMetadataRestorePlan', () => {
  it('plans the base item number and description for an empty row', () => {
    const plan = buildMetadataRestorePlan([fathom], { userId: USER_ID })

    expect(plan.files).toHaveLength(1)
    expect(plan.files[0].values).toEqual({
      part_number: 'BR-100077',
      description: 'PCB, Fathom-X',
    })
    expect(plan.valueCount).toBe(2)
  })

  it('never plans a value for a row that holds one, whatever the file says', () => {
    const plan = buildMetadataRestorePlan(
      [
        file({
          fieldComparisons: [
            comparison({ divergence: 'both-set-differ', databaseValue: 'BR-1' }),
            comparison({ field: 'description', divergence: 'file-empty' }),
            comparison({ field: 'description', divergence: 'agrees' }),
          ],
        }),
      ],
      { userId: USER_ID },
    )

    expect(plan.files).toEqual([])
  })

  it('ignores drawings, configuration scope, other fields and values without a repair key', () => {
    const plan = buildMetadataRestorePlan(
      [
        file({ fileType: 'drawing', fieldComparisons: [comparison({})] }),
        file({
          fileId: 'file-2',
          fieldComparisons: [
            comparison({ scope: 'configuration' }),
            comparison({ field: 'revision' }),
            comparison({ databaseRepairValue: null }),
            comparison({ field: 'description', databaseRepairValue: '   ' }),
          ],
        }),
      ],
      { userId: USER_ID },
    )

    expect(plan.files).toEqual([])
  })

  it('leaves out excluded prefixes, case-insensitively and with either separator', () => {
    const toolbox = file({
      fileId: 'file-2',
      relativePath: '0 - Shared\\01-Toolbox\\screw.sldprt',
      fieldComparisons: [comparison({})],
    })
    const lookalike = file({
      fileId: 'file-3',
      relativePath: '0 - SHARED/01-TOOLBOX-OLD/screw.sldprt',
      fieldComparisons: [comparison({})],
    })

    const plan = buildMetadataRestorePlan([fathom, toolbox, lookalike], {
      userId: USER_ID,
      excludePrefixes: ['0 - SHARED/01-TOOLBOX/'],
    })

    expect(plan.files.map((entry) => entry.fileId)).toEqual(['file-1', 'file-3'])
    expect(plan.excluded.map((entry) => entry.fileId)).toEqual(['file-2'])
  })

  it('skips a file somebody else has checked out', () => {
    const plan = buildMetadataRestorePlan([fathom], {
      userId: USER_ID,
      stateOf: () => ({ checkedOutBy: OTHER_USER_ID, pendingFields: new Set() }),
    })

    expect(plan.files).toEqual([])
    expect(plan.heldByOthers.map((entry) => entry.fileId)).toEqual(['file-1'])
  })

  it('keeps a pending edit for a field and plans only the others', () => {
    const state: MetadataRestoreFileState = {
      checkedOutBy: USER_ID,
      pendingFields: new Set(['part_number']),
    }

    const plan = buildMetadataRestorePlan([fathom], { userId: USER_ID, stateOf: () => state })

    expect(plan.files[0].values).toEqual({ description: 'PCB, Fathom-X' })
    expect(plan.pendingEditsKept).toBe(1)
    expect(plan.valueCount).toBe(1)
  })

  it('drops a file whose every value has a pending edit', () => {
    const plan = buildMetadataRestorePlan([fathom], {
      userId: USER_ID,
      stateOf: () => ({
        checkedOutBy: null,
        pendingFields: new Set(['part_number', 'description'] as const),
      }),
    })

    expect(plan.files).toEqual([])
    expect(plan.pendingEditsKept).toBe(2)
  })
})

describe('restoreStatesOf', () => {
  function loaded(
    pdmData: { id: string; checked_out_by: string | null },
    pendingMetadata?: MetadataOverlaySource['pendingMetadata'],
  ): MetadataOverlaySource {
    return { pdmData: pdmData as PDMFile, pendingMetadata }
  }

  it('records the holder and the fields with a pending edit, including a cleared one', () => {
    const states = restoreStatesOf([
      loaded({ id: 'file-1', checked_out_by: USER_ID }, { description: '' }),
    ])
    expect(states.get('file-1')?.checkedOutBy).toBe(USER_ID)
    expect([...(states.get('file-1')?.pendingFields ?? [])]).toEqual(['description'])
  })

  it('merges the two rows a moved file shows as, keeping the holder and every pending field', () => {
    const states = restoreStatesOf([
      loaded({ id: 'file-1', checked_out_by: null }, { part_number: 'BR-1' }),
      loaded({ id: 'file-1', checked_out_by: OTHER_USER_ID }, { description: 'x' }),
    ])
    expect(states.get('file-1')?.checkedOutBy).toBe(OTHER_USER_ID)
    expect([...(states.get('file-1')?.pendingFields ?? [])].sort()).toEqual([
      'description',
      'part_number',
    ])
  })

  it('skips rows that are not in the vault yet', () => {
    expect(restoreStatesOf([{ pendingMetadata: { part_number: 'x' } }]).size).toBe(0)
  })
})
