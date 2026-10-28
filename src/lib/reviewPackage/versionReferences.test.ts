import { describe, expect, it } from 'vitest'

import type { SWReference } from '@/lib/supabase/files/mutations'
import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import {
  candidatesFromFiles,
  mapVersionReferences,
  type VaultFileCandidate,
} from './versionReferences'

const candidates: VaultFileCandidate[] = [
  {
    path: 'C:\\Vault\\Parts\\Bracket.SLDPRT',
    relativePath: 'Parts/Bracket.SLDPRT',
    name: 'Bracket.SLDPRT',
    fileId: 'bracket',
    contentHash: 'h-bracket',
  },
  {
    path: 'C:\\Vault\\Parts\\Plate.SLDPRT',
    relativePath: 'Parts/Plate.SLDPRT',
    name: 'Plate.SLDPRT',
    fileId: 'plate-1',
    contentHash: null,
  },
  {
    path: 'C:\\Vault\\Old\\Plate.SLDPRT',
    relativePath: 'Old/Plate.SLDPRT',
    name: 'Plate.SLDPRT',
    fileId: 'plate-2',
    contentHash: 'h-plate-2',
  },
  {
    path: 'C:\\Vault\\Asm\\Top.SLDASM',
    relativePath: 'Asm/Top.SLDASM',
    name: 'Top.SLDASM',
    fileId: 'top',
    contentHash: 'h-top',
  },
]

function ref(childFilePath: string, extra: Partial<SWReference> = {}): SWReference {
  return { childFilePath, quantity: 1, referenceType: 'reference', ...extra }
}

describe('mapVersionReferences', () => {
  it('matches by absolute path, case- and slash-insensitively, with the local hash', () => {
    expect(mapVersionReferences([ref('c:/vault/parts/bracket.sldprt')], candidates)).toEqual([
      {
        childFileId: 'bracket',
        childContentHash: 'h-bracket',
        configuration: null,
        referenceType: 'reference',
        quantity: 1,
      },
    ])
  })

  it('matches by vault-relative path under another root (the stored path of a moved vault)', () => {
    const out = mapVersionReferences(
      [ref('D:\\Work\\Vault\\Asm\\Top.SLDASM')],
      candidates,
      'D:\\Work\\Vault',
    )
    expect(out[0]).toMatchObject({ childFileId: 'top', childContentHash: 'h-top' })
  })

  it('falls back to a unique file name, never an ambiguous one', () => {
    const out = mapVersionReferences(
      [ref('E:\\Somewhere\\Bracket.sldprt'), ref('E:\\Somewhere\\Plate.sldprt')],
      candidates,
    )
    expect(out[0]).toMatchObject({ childFileId: 'bracket' })
    expect(out[1]).toEqual({
      childFileId: null,
      childPath: 'E:\\Somewhere\\Plate.sldprt',
      configuration: null,
      referenceType: 'reference',
      quantity: 1,
    })
  })

  it('sends a reference outside the vault by path', () => {
    const out = mapVersionReferences([ref('C:\\SOLIDWORKS Data\\Toolbox\\bolt.sldprt')], candidates)
    expect(out[0]).toMatchObject({
      childFileId: null,
      childPath: 'C:\\SOLIDWORKS Data\\Toolbox\\bolt.sldprt',
    })
  })

  it('keeps one row per child and configuration, and carries type and quantity', () => {
    const out = mapVersionReferences(
      [
        ref('C:\\Vault\\Asm\\Top.SLDASM', {
          configuration: 'Default',
          referenceType: 'component',
          quantity: 4,
        }),
        ref('c:\\vault\\asm\\top.sldasm', {
          configuration: 'Default',
          referenceType: 'component',
          quantity: 4,
        }),
        ref('C:\\Vault\\Asm\\Top.SLDASM', {
          configuration: 'Long',
          referenceType: 'component',
          quantity: 2,
        }),
      ],
      candidates,
    )
    expect(out).toEqual([
      {
        childFileId: 'top',
        childContentHash: 'h-top',
        configuration: 'Default',
        referenceType: 'component',
        quantity: 4,
      },
      {
        childFileId: 'top',
        childContentHash: 'h-top',
        configuration: 'Long',
        referenceType: 'component',
        quantity: 2,
      },
    ])
  })
})

function local(partial: Partial<LocalFile> & { pdm?: Partial<PDMFile> }): LocalFile {
  const { pdm, ...rest } = partial
  return {
    name: 'P.sldprt',
    path: 'C:\\Vault\\P.sldprt',
    relativePath: 'P.sldprt',
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '',
    pdmData: pdm ? ({ id: 'p', content_hash: 'server-hash', ...pdm } as PDMFile) : undefined,
    ...rest,
  }
}

describe('candidatesFromFiles', () => {
  it('uses the local hash, else the server hash only when the file is in sync', () => {
    const out = candidatesFromFiles([
      local({ pdm: {}, localHash: 'local-hash', diffStatus: 'modified' }),
      local({ pdm: { id: 'q' }, path: 'C:\\Vault\\Q.sldprt' }),
      local({ pdm: { id: 'r' }, path: 'C:\\Vault\\R.sldprt', diffStatus: 'outdated' }),
    ])
    expect(out.map((c) => [c.fileId, c.contentHash])).toEqual([
      ['p', 'local-hash'],
      ['q', 'server-hash'],
      ['r', null],
    ])
  })

  it('skips folders, unsynced files, cloud-only files and moved-away stubs', () => {
    const out = candidatesFromFiles([
      local({ isDirectory: true, pdm: {} }),
      local({}),
      local({ pdm: {}, diffStatus: 'cloud' }),
      local({ pdm: {}, diffStatus: 'moved_away' }),
    ])
    expect(out).toEqual([])
  })
})
