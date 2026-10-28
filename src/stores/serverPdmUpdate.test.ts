/**
 * What a realtime update of a file's server row does to its store row.
 *
 * Every realtime UPDATE goes through here, and nothing tested it directly: the nightly mutation
 * run left about a hundred of its mutants alive (the diff-status fallbacks, the `moved_away` stub
 * relocation, the cloud folders a relocated stub needs). Each case below is the status or row a
 * load would show for the same disk and server.
 */
import { describe, expect, it } from 'vitest'

import type { PDMFile } from '@/types/pdm'
import { applyServerPdmUpdate, applyServerPdmUpdates } from './serverPdmUpdate'
import type { LocalFile } from './types'

const VAULT = 'C:\\vault'

function pdm(overrides: Partial<PDMFile> & Pick<PDMFile, 'id' | 'file_path'>): PDMFile {
  return { ...overrides } as PDMFile
}

function file(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  const name = relativePath.split('/').pop() || ''
  return {
    name,
    path: `${VAULT}\\${relativePath.split('/').join('\\')}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: 'then',
    ...overrides,
  }
}

function folder(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return file(relativePath, { isDirectory: true, extension: '', size: 0, ...overrides })
}

const synced = (overrides: Partial<LocalFile> = {}) =>
  file('A/part.sldprt', { pdmData: pdm({ id: 'f1', file_path: 'A/part.sldprt' }), ...overrides })

describe('applyServerPdmUpdate', () => {
  it('leaves a row with no server row untouched', () => {
    const local = file('A/new.sldprt', { diffStatus: 'added' })
    expect(applyServerPdmUpdate(local, { content_hash: 'h2' })).toBe(local)
  })

  describe('with a local hash', () => {
    it('marks the row outdated when the server hash differs', () => {
      const row = applyServerPdmUpdate(synced({ localHash: 'h1' }), { content_hash: 'h2' })
      expect(row.diffStatus).toBe('outdated')
      expect(row.pdmData?.content_hash).toBe('h2')
    })

    it('clears outdated when the server hash now matches', () => {
      const row = applyServerPdmUpdate(synced({ localHash: 'h1', diffStatus: 'outdated' }), {
        content_hash: 'h1',
      })
      expect(row.diffStatus).toBeUndefined()
    })

    it('keeps any other status when the hashes match', () => {
      const row = applyServerPdmUpdate(synced({ localHash: 'h1', diffStatus: 'added' }), {
        content_hash: 'h1',
      })
      expect(row.diffStatus).toBe('added')
    })

    it('treats an empty local hash as no hash and falls back to versions', () => {
      const row = applyServerPdmUpdate(
        synced({ localHash: '', localVersion: 3, diffStatus: 'outdated' }),
        { content_hash: 'h2', version: 3 },
      )
      expect(row.diffStatus).toBeUndefined()
    })
  })

  describe('without a local hash, by tracked version', () => {
    it('marks an older local version outdated', () => {
      const row = applyServerPdmUpdate(synced({ localVersion: 2 }), { version: 3 })
      expect(row.diffStatus).toBe('outdated')
    })

    it('clears outdated when the versions match', () => {
      const row = applyServerPdmUpdate(synced({ localVersion: 3, diffStatus: 'outdated' }), {
        version: 3,
      })
      expect(row.diffStatus).toBeUndefined()
    })

    it('keeps modified when the versions match', () => {
      const row = applyServerPdmUpdate(synced({ localVersion: 3, diffStatus: 'modified' }), {
        version: 3,
      })
      expect(row.diffStatus).toBe('modified')
    })

    it('keeps the status of a local version ahead of the server', () => {
      expect(applyServerPdmUpdate(synced({ localVersion: 4 }), { version: 3 }).diffStatus).toBeUndefined()
      expect(
        applyServerPdmUpdate(synced({ localVersion: 4, diffStatus: 'modified' }), { version: 3 })
          .diffStatus,
      ).toBe('modified')
    })
  })

  describe('with nothing to compare against', () => {
    it('clears an unverifiable outdated on an update that carries a hash', () => {
      const row = applyServerPdmUpdate(synced({ diffStatus: 'outdated' }), { content_hash: 'h2' })
      expect(row.diffStatus).toBeUndefined()
    })

    it('clears an unverifiable outdated on an update that carries only a version', () => {
      const row = applyServerPdmUpdate(synced({ diffStatus: 'outdated' }), { version: 4 })
      expect(row.diffStatus).toBeUndefined()
    })

    it('clears outdated on a version update when only the server side has a version', () => {
      const row = applyServerPdmUpdate(synced({ diffStatus: 'outdated', localVersion: undefined }), {
        version: 4,
      })
      expect(row.diffStatus).toBeUndefined()
    })

    it('keeps outdated on an update that says nothing about the content', () => {
      const row = applyServerPdmUpdate(synced({ diffStatus: 'outdated', localVersion: 2 }), {
        file_path: 'A/part.sldprt',
      })
      expect(row.diffStatus).toBe('outdated')
    })
  })

  describe('a pending move', () => {
    it('is resolved when the server path becomes the local path, in any case', () => {
      const moved = file('B/Part.sldprt', {
        diffStatus: 'moved',
        pdmData: pdm({ id: 'f1', file_path: 'A/part.sldprt' }),
      })
      expect(applyServerPdmUpdate(moved, { file_path: 'b/part.SLDPRT' }).diffStatus).toBeUndefined()
    })

    it('outranks a content difference while the paths still disagree', () => {
      const moved = file('B/part.sldprt', {
        diffStatus: 'moved',
        localHash: 'h1',
        pdmData: pdm({ id: 'f1', file_path: 'A/part.sldprt' }),
      })
      expect(applyServerPdmUpdate(moved, { content_hash: 'h2' }).diffStatus).toBe('moved')
    })
  })

  describe('a locally deleted file', () => {
    const deleted = () => synced({ diffStatus: 'deleted' })

    it('becomes cloud-only once its checkout is released', () => {
      expect(applyServerPdmUpdate(deleted(), { checked_out_by: null }).diffStatus).toBe('cloud')
    })

    it('stays deleted while someone holds it, or when the update is not about the checkout', () => {
      expect(applyServerPdmUpdate(deleted(), { checked_out_by: 'u2' }).diffStatus).toBe('deleted')
      expect(applyServerPdmUpdate(deleted(), { description: 'x' }).diffStatus).toBe('deleted')
    })
  })

  describe('pending metadata', () => {
    const edited = () =>
      synced({
        localHash: 'h1',
        pdmData: pdm({ id: 'f1', file_path: 'A/part.sldprt', description: 'old', content_hash: 'h1' }),
        pendingMetadata: { description: 'mine' },
      })

    it('keeps an edit the server has not accepted, and the row modified', () => {
      const row = applyServerPdmUpdate(edited(), { content_hash: 'h1', description: 'theirs' })
      expect(row.pendingMetadata).toEqual({ description: 'mine' })
      expect(row.pdmData?.description).toBe('theirs')
      expect(row.diffStatus).toBe('modified')
    })

    it('drops an edit the server now holds, and the row is no longer modified', () => {
      const row = applyServerPdmUpdate(edited(), { content_hash: 'h1', description: 'mine' })
      expect(row.pendingMetadata).toBeUndefined()
      expect(row.diffStatus).toBeUndefined()
    })

    it('drops a mirrored value that equals what the row held before the update', () => {
      const mirrored = synced({
        localHash: 'h1',
        pdmData: pdm({ id: 'f1', file_path: 'A/part.sldprt', part_number: 'P-1' }),
        pendingMetadata: { part_number: 'P-1' },
      })
      const row = applyServerPdmUpdate(mirrored, { content_hash: 'h1', part_number: 'P-2' })
      expect(row.pendingMetadata).toBeUndefined()
      expect(row.diffStatus).toBeUndefined()
    })
  })
})

describe('applyServerPdmUpdates', () => {
  it('applies every update for a row in arrival order', () => {
    const files = [synced(), file('A/other.sldprt', { pdmData: pdm({ id: 'f2', file_path: 'A/other.sldprt' }) })]
    const [first, second] = applyServerPdmUpdates(files, [
      { fileId: 'f1', pdmData: { description: 'one', revision: 'A' } },
      { fileId: 'f1', pdmData: { revision: 'B' } },
    ])
    expect(first.pdmData).toMatchObject({ description: 'one', revision: 'B' })
    expect(second).toBe(files[1])
  })

  it('updates a row whose server row has no path without failing', () => {
    const row = file('A/part.sldprt', { pdmData: { id: 'f1' } as PDMFile })
    const [updated] = applyServerPdmUpdates([row], [{ fileId: 'f1', pdmData: { description: 'x' } }])
    expect(updated.pdmData?.description).toBe('x')
  })

  describe('a moved_away stub', () => {
    const stubAt = (relativePath: string, path?: string) =>
      file(relativePath, {
        ...(path ? { path } : {}),
        diffStatus: 'moved_away',
        movedToRelativePath: 'B/part.sldprt',
        pdmData: pdm({ id: 'f1', file_path: relativePath }),
      })
    const movedRow = () =>
      file('B/part.sldprt', { diffStatus: 'moved', pdmData: pdm({ id: 'f1', file_path: 'A/part.sldprt' }) })

    it('goes once the server records the local path, with the cloud folder it alone held', () => {
      const files = [folder('A', { diffStatus: 'cloud' }), stubAt('A/part.sldprt'), folder('B'), movedRow()]
      const result = applyServerPdmUpdates(files, [{ fileId: 'f1', pdmData: { file_path: 'b/PART.sldprt' } }])
      expect(result.map((f) => f.relativePath)).toEqual(['B', 'B/part.sldprt'])
      expect(result[1].diffStatus).toBeUndefined()
    })

    it('stays where it is when the update leaves the server path alone', () => {
      const stub = stubAt('A/Part.sldprt')
      const files = [folder('A', { diffStatus: 'cloud' }), stub, movedRow()]
      const result = applyServerPdmUpdates(files, [
        { fileId: 'f1', pdmData: { file_path: 'a/part.SLDPRT', description: 'x' } },
      ])
      expect(result.map((f) => f.relativePath)).toEqual(['A', 'A/Part.sldprt', 'B/part.sldprt'])
      expect(result[1]).toMatchObject({ diffStatus: 'moved_away', path: stub.path, name: 'Part.sldprt' })
    })

    it('follows the server path, with cloud folders for the folders it now needs', () => {
      const files = [
        folder('A', { diffStatus: 'cloud' }),
        stubAt('A/part.sldprt'),
        folder('D'),
        file('E/loose.sldprt'),
        folder('B'),
        movedRow(),
      ]
      const result = applyServerPdmUpdates(files, [
        { fileId: 'f1', pdmData: { file_path: 'D/sub/Renamed.SLDPRT' } },
      ])

      const stub = result.find((f) => f.diffStatus === 'moved_away')
      expect(stub).toMatchObject({
        relativePath: 'D/sub/Renamed.SLDPRT',
        path: `${VAULT}\\D\\sub\\Renamed.SLDPRT`,
        name: 'Renamed.SLDPRT',
        extension: '.sldprt',
        movedToRelativePath: 'B/part.sldprt',
      })
      // The vacated cloud folder goes; only the missing folder above the stub is added, and
      // nothing is added for folders above rows that are not stubs.
      const paths = result.map((f) => f.relativePath)
      expect(paths).not.toContain('A')
      expect(paths).not.toContain('E')
      expect(paths.filter((p) => p === 'D')).toHaveLength(1)
      expect(result.find((f) => f.relativePath === 'D/sub')).toEqual({
        name: 'sub',
        path: `${VAULT}\\D\\sub`,
        relativePath: 'D/sub',
        isDirectory: true,
        extension: '',
        size: 0,
        modifiedTime: '',
        diffStatus: 'cloud',
        pdmData: undefined,
        movedToRelativePath: undefined,
      })
      expect(result.find((f) => f.relativePath === 'B/part.sldprt')?.diffStatus).toBe('moved')
    })

    it('keeps a forward-slash vault root and gives a name without a dot no extension', () => {
      const files = [stubAt('A/part.sldprt', '/vault/A/part.sldprt'), movedRow()]
      const result = applyServerPdmUpdates(files, [{ fileId: 'f1', pdmData: { file_path: 'C/README' } }])
      const stub = result.find((f) => f.diffStatus === 'moved_away')
      expect(stub).toMatchObject({ path: '/vault/C/README', name: 'README', extension: '' })
      expect(result.find((f) => f.relativePath === 'C')).toMatchObject({
        path: '/vault/C',
        isDirectory: true,
        diffStatus: 'cloud',
      })
    })
  })
})
