import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import { buildTransferMetadata } from './metadata'

function file(
  server: Partial<PDMFile> | null,
  pending?: LocalFile['pendingMetadata'],
): LocalFile {
  return {
    name: 'a.SLDPRT',
    path: 'C:\\v\\a.SLDPRT',
    relativePath: 'a.SLDPRT',
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '',
    pendingMetadata: pending,
    pdmData: server === null ? undefined : ({ id: 'x', ...server } as PDMFile),
  }
}

describe('buildTransferMetadata', () => {
  it('carries what the server holds', () => {
    const result = buildTransferMetadata(
      file({ part_number: 'BR-1', description: 'Bracket', revision: 'B' }),
    )

    expect(result).toMatchObject({ partNumber: 'BR-1', description: 'Bracket', revision: 'B' })
  })

  it('prefers an edit that has not been checked in', () => {
    const result = buildTransferMetadata(
      file({ part_number: 'BR-1', description: 'Bracket' }, { description: 'Bracket, rev 2' }),
    )

    expect(result.partNumber).toBe('BR-1')
    expect(result.description).toBe('Bracket, rev 2')
  })

  it('keeps a field the user cleared cleared', () => {
    const result = buildTransferMetadata(file({ part_number: 'BR-1' }, { part_number: '' }))

    expect(result.partNumber).toBeNull()
  })

  it('has nothing to carry for a file that was never checked in', () => {
    expect(buildTransferMetadata(file(null))).toEqual({
      partNumber: null,
      description: null,
      revision: null,
      customProperties: {},
    })
  })

  it('copies custom properties without sharing them with the source row', () => {
    const source = file({ custom_properties: { Material: 'Steel', Mass: 4, nested: { a: 1 } } })

    const result = buildTransferMetadata(source)
    ;(result.customProperties.nested as { a: number }).a = 2

    expect(result.customProperties).toMatchObject({ Material: 'Steel', Mass: 4 })
    expect((source.pdmData?.custom_properties as { nested: { a: number } }).nested.a).toBe(1)
  })

  it('merges edited configuration tabs over the committed ones', () => {
    const result = buildTransferMetadata(
      file(
        { custom_properties: { _config_tabs: { Default: '001', Long: '002' } } },
        { config_tabs: { Long: '009' } },
      ),
    )

    expect(result.customProperties._config_tabs).toEqual({ Default: '001', Long: '009' })
  })

  it('brings edited configuration descriptions along even when none were committed', () => {
    const result = buildTransferMetadata(
      file({ custom_properties: {} }, { config_descriptions: { Default: 'Short' } }),
    )

    expect(result.customProperties._config_descriptions).toEqual({ Default: 'Short' })
  })

  it('ignores a custom_properties value that is not an object', () => {
    expect(buildTransferMetadata(file({ custom_properties: 'oops' })).customProperties).toEqual({})
    expect(buildTransferMetadata(file({ custom_properties: [1, 2] })).customProperties).toEqual({})
  })
})
