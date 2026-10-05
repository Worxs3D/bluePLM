import { describe, expect, it } from 'vitest'

import {
  checkoutLostWithEdits,
  editedFieldsOf,
  editedValueText,
  findStrandedEdits,
  type StrandedEditSource,
} from './strandedEdits'

const ME = 'user-me'
const OTHER = 'user-other'

function file(overrides: Partial<StrandedEditSource> = {}): StrandedEditSource {
  return {
    path: 'C:\\Vault\\ELEC\\A.SLDPRT',
    relativePath: 'ELEC/A.SLDPRT',
    pdmData: { id: 'file-a', checked_out_by: null },
    ...overrides,
  }
}

describe('editedFieldsOf', () => {
  it('counts a present key as an edit, including one that cleared the field', () => {
    expect(editedFieldsOf({ description: '', part_number: null })).toEqual([
      'part_number',
      'description',
    ])
  })

  it('treats an absent or empty pending set as no edit', () => {
    expect(editedFieldsOf(undefined)).toEqual([])
    expect(editedFieldsOf({})).toEqual([])
    expect(editedFieldsOf({ description: undefined })).toEqual([])
  })
})

describe('findStrandedEdits', () => {
  it('finds edits on a file nobody holds, which a checkout would drop', () => {
    const stranded = findStrandedEdits([
      file({ pendingMetadata: { part_number: 'BR-107599', description: 'PCB' } }),
    ])
    expect(stranded).toEqual([
      {
        path: 'C:\\Vault\\ELEC\\A.SLDPRT',
        relativePath: 'ELEC/A.SLDPRT',
        fields: ['part_number', 'description'],
        pending: { part_number: 'BR-107599', description: 'PCB' },
      },
    ])
  })

  it('ignores files without edits, files still held, and files not synced', () => {
    expect(
      findStrandedEdits([
        file(),
        file({ pendingMetadata: {} }),
        file({
          pendingMetadata: { description: 'x' },
          pdmData: { id: 'file-a', checked_out_by: ME },
        }),
        file({ pendingMetadata: { description: 'x' }, pdmData: undefined }),
      ]),
    ).toEqual([])
  })
})

describe('editedValueText', () => {
  it('shows a scalar value, a cleared one as empty, and a configuration map by count', () => {
    expect(editedValueText({ description: 'PCB' }, 'description')).toEqual({
      value: 'PCB',
      configurations: null,
    })
    expect(editedValueText({ description: '' }, 'description')).toEqual({
      value: null,
      configurations: null,
    })
    expect(
      editedValueText({ config_tabs: { Default: '01', Alt: '02' } }, 'config_tabs'),
    ).toEqual({ value: null, configurations: 2 })
  })
})

describe('checkoutLostWithEdits', () => {
  const pending = { description: 'PCB' }

  it('is true when my checkout was released or taken while edits are pending', () => {
    expect(checkoutLostWithEdits({ previousHolder: ME, nextHolder: null, userId: ME, pending })).toBe(true)
    expect(checkoutLostWithEdits({ previousHolder: ME, nextHolder: OTHER, userId: ME, pending })).toBe(true)
  })

  it('is false without edits, when I still hold it, or when I never did', () => {
    expect(checkoutLostWithEdits({ previousHolder: ME, nextHolder: null, userId: ME, pending: {} })).toBe(false)
    expect(checkoutLostWithEdits({ previousHolder: ME, nextHolder: ME, userId: ME, pending })).toBe(false)
    expect(checkoutLostWithEdits({ previousHolder: OTHER, nextHolder: null, userId: ME, pending })).toBe(false)
    expect(checkoutLostWithEdits({ previousHolder: null, nextHolder: null, userId: null, pending })).toBe(false)
  })
})
