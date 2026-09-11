/**
 * Replay of the doris "Burn Wire Release" download race against the real
 * files slice. `refreshCurrentFolder` classifies a disk file as `added`
 * (local-only) when it has no `pdmData` AND is missing from `serverFiles`.
 * The old download called `removeFilesFromStore` on the folder first, which
 * prefix-pruned both. The new download only updates in place.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'

import type { LocalFile, PDMStoreState, FilesSlice, ServerFile } from '../types'
import type { PDMFile } from '../../types/pdm'
import { createFilesSlice } from './filesSlice'

vi.mock('@/stores/pdmStore', () => ({
  usePDMStore: { getState: vi.fn() },
}))

type FilesSliceCreator = StateCreator<PDMStoreState, [['zustand/persist', unknown]], [], FilesSlice>
type StoreSet = Parameters<FilesSliceCreator>[0]
type StoreGet = Parameters<FilesSliceCreator>[1]

const VAULT = 'C:\\BluePLM\\doris'

function cloudFolder(relativePath: string): LocalFile {
  return {
    name: relativePath.split('/').pop() || '',
    path: `${VAULT}\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: '',
    diffStatus: 'cloud',
    isSynced: false,
  }
}

function cloudFile(relativePath: string): LocalFile {
  const name = relativePath.split('/').pop() || ''
  return {
    name,
    path: `${VAULT}\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 100,
    modifiedTime: '',
    diffStatus: 'cloud',
    isSynced: false,
    pdmData: { id: `row-${name}`, file_path: relativePath, version: 3 } as PDMFile,
  }
}

function serverFile(filePath: string): ServerFile {
  return {
    id: `s-${filePath}`,
    file_path: filePath,
    name: filePath.split('/').pop() || '',
    extension: '.sldprt',
    content_hash: 'hash',
  }
}

/** The classification `refreshCurrentFolder` applies to a file it just scanned on disk. */
function classifyAfterFolderRefresh(
  existing: LocalFile | undefined,
  serverPaths: Set<string>,
  relativePath: string,
): 'added' | 'synced' {
  if (existing?.pdmData) return 'synced'
  return serverPaths.has(relativePath.toLowerCase()) ? 'synced' : 'added'
}

describe('download folder race — file-pane Refresh classification', () => {
  let store: PDMStoreState

  const parent = cloudFolder('Burn Wire Release')
  const nested = cloudFolder('Burn Wire Release/STEP Files')
  const file = cloudFile('Burn Wire Release/nut.sldprt')
  const nestedFile = cloudFile('Burn Wire Release/STEP Files/nut.STEP')

  beforeEach(() => {
    vi.stubGlobal('window', { electronAPI: { log: vi.fn() } })
    store = {} as unknown as PDMStoreState
    const set: StoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(store) : partial
      store = { ...store, ...update }
    }
    const get: StoreGet = () => store
    const filesSlice = createFilesSlice(set, get, {} as Parameters<FilesSliceCreator>[2])
    store = {
      ...filesSlice,
      files: [],
      serverFiles: [],
      selectedFiles: [],
      user: null,
      vaultPath: VAULT,
      persistedPendingMetadata: {},
      persistedMetadataWriteState: {},
      persistedCopySource: {},
    } as unknown as PDMStoreState

    store.setFiles([parent, nested, file, nestedFile])
    store.setServerFiles([
      serverFile(file.relativePath),
      serverFile(nestedFile.relativePath),
    ])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the old remove-then-update sequence makes Refresh classify the files as local-only', () => {
    store.removeFilesFromStore([parent.path])
    store.updateFilesAndClearProcessing(
      [
        {
          path: file.path,
          updates: { localHash: 'h', localVersion: 3, diffStatus: undefined, isSynced: true },
        },
      ],
      [],
    )

    expect(store.files).toHaveLength(0)
    expect(store.serverFiles).toHaveLength(0)

    const serverPaths = new Set(store.serverFiles.map((sf) => sf.file_path.toLowerCase()))
    const existing = store.files.find((f) => f.path === file.path)
    expect(classifyAfterFolderRefresh(existing, serverPaths, file.relativePath)).toBe('added')
  })

  it('in-place folder+file updates keep pdmData and serverFiles, so Refresh stays synced', () => {
    store.updateFilesAndClearProcessing(
      [
        {
          path: file.path,
          updates: { localHash: 'h', localVersion: 3, diffStatus: undefined, isSynced: true },
        },
        {
          path: nestedFile.path,
          updates: { localHash: 'h', localVersion: 3, diffStatus: undefined, isSynced: true },
        },
        { path: parent.path, updates: { diffStatus: undefined, isSynced: true } },
        { path: nested.path, updates: { diffStatus: undefined, isSynced: true } },
      ],
      [],
    )

    expect(store.files).toHaveLength(4)
    expect(store.serverFiles).toHaveLength(2)
    expect(store.files.find((f) => f.path === file.path)?.pdmData?.id).toBe('row-nut.sldprt')
    expect(store.files.find((f) => f.path === parent.path)?.diffStatus).toBeUndefined()
    expect(store.files.find((f) => f.path === nested.path)?.diffStatus).toBeUndefined()

    const serverPaths = new Set(store.serverFiles.map((sf) => sf.file_path.toLowerCase()))
    const existing = store.files.find((f) => f.path === file.path)
    expect(classifyAfterFolderRefresh(existing, serverPaths, file.relativePath)).not.toBe('added')
    const existingNested = store.files.find((f) => f.path === nestedFile.path)
    expect(
      classifyAfterFolderRefresh(existingNested, serverPaths, nestedFile.relativePath),
    ).not.toBe('added')
  })
})
