import { describe, expect, it } from 'vitest'

import { cloudRowsForFolderRefresh, pdmDataFromServerFile } from './refreshFolderCloudRows'
import type { ServerFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

const VAULT = 'C:/vault'

function serverFile(filePath: string, hash: string): ServerFile {
  return {
    id: `id-${filePath}`,
    file_path: filePath,
    name: filePath.split('/').pop() || '',
    extension: '.sldprt',
    content_hash: hash,
  }
}

describe('cloudRowsForFolderRefresh', () => {
  it('does not resurrect a hash-duplicate server path as a cloud row', () => {
    const result = cloudRowsForFolderRefresh({
      serverFiles: [serverFile('copies/bolt.sldprt', 'hash-bolt')],
      localPathSet: new Set(),
      existingPdmMap: new Map(),
      claimedServerPathToLocalPath: new Map(),
      localContentHashes: new Set(['hash-bolt']),
      folderPath: '',
      folderPrefix: '',
      vaultPath: VAULT,
    })

    expect(result.rows).toHaveLength(0)
    expect(result.skippedHashDuplicates).toBe(1)
    expect(result.skippedHashless).toBe(0)
  })

  it('synthesizes pdmData.content_hash from ServerFile when existingPdmMap has no row', () => {
    const sf = serverFile('cloud/part.sldprt', 'hash-part')
    const result = cloudRowsForFolderRefresh({
      serverFiles: [sf],
      localPathSet: new Set(),
      existingPdmMap: new Map(),
      claimedServerPathToLocalPath: new Map(),
      localContentHashes: new Set(),
      folderPath: '',
      folderPrefix: '',
      vaultPath: VAULT,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].diffStatus).toBe('cloud')
    expect(result.rows[0].pdmData?.id).toBe(sf.id)
    expect(result.rows[0].pdmData?.content_hash).toBe('hash-part')
    expect(result.rows[0].pdmData?.file_path).toBe('cloud/part.sldprt')
  })

  it('fills a missing hash on existing pdmData from ServerFile rather than emitting a ghost', () => {
    const sf = serverFile('cloud/part.sldprt', 'hash-part')
    const existing = {
      id: 'existing-id',
      file_path: 'cloud/part.sldprt',
      file_name: 'part.sldprt',
    } as PDMFile

    const result = cloudRowsForFolderRefresh({
      serverFiles: [sf],
      localPathSet: new Set(),
      existingPdmMap: new Map([['cloud/part.sldprt', existing]]),
      claimedServerPathToLocalPath: new Map(),
      localContentHashes: new Set(),
      folderPath: '',
      folderPrefix: '',
      vaultPath: VAULT,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].pdmData?.id).toBe('existing-id')
    expect(result.rows[0].pdmData?.content_hash).toBe('hash-part')
  })

  it('never emits a cloud row with no hash', () => {
    const result = cloudRowsForFolderRefresh({
      serverFiles: [{ ...serverFile('cloud/empty.sldprt', ''), content_hash: '' }],
      localPathSet: new Set(),
      existingPdmMap: new Map(),
      claimedServerPathToLocalPath: new Map(),
      localContentHashes: new Set(),
      folderPath: '',
      folderPrefix: '',
      vaultPath: VAULT,
    })

    expect(result.rows).toHaveLength(0)
    expect(result.skippedHashless).toBe(1)
  })

  it('still emits a moved_away stub for a claimed server path, even when the hash is local', () => {
    const sf = serverFile('old/part.sldprt', 'hash-moved')
    const result = cloudRowsForFolderRefresh({
      serverFiles: [sf],
      localPathSet: new Set(['new/part.sldprt']),
      existingPdmMap: new Map(),
      claimedServerPathToLocalPath: new Map([['old/part.sldprt', 'new/part.sldprt']]),
      localContentHashes: new Set(['hash-moved']),
      folderPath: '',
      folderPrefix: '',
      vaultPath: VAULT,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].diffStatus).toBe('moved_away')
    expect(result.rows[0].movedToRelativePath).toBe('new/part.sldprt')
    expect(result.skippedHashDuplicates).toBe(0)
  })

  it('skips paths already on disk in this folder', () => {
    const result = cloudRowsForFolderRefresh({
      serverFiles: [serverFile('folder/part.sldprt', 'hash-part')],
      localPathSet: new Set(['folder/part.sldprt']),
      existingPdmMap: new Map(),
      claimedServerPathToLocalPath: new Map(),
      localContentHashes: new Set(),
      folderPath: 'folder',
      folderPrefix: 'folder/',
      vaultPath: VAULT,
    })

    expect(result.rows).toHaveLength(0)
  })
})

describe('pdmDataFromServerFile', () => {
  it('copies id, path, name, extension, and hash', () => {
    const sf = serverFile('a/b.sldprt', 'abc')
    const pdm = pdmDataFromServerFile(sf)
    expect(pdm.id).toBe(sf.id)
    expect(pdm.file_path).toBe(sf.file_path)
    expect(pdm.file_name).toBe(sf.name)
    expect(pdm.extension).toBe(sf.extension)
    expect(pdm.content_hash).toBe('abc')
  })
})
