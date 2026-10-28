/**
 * Batch store actions added for the 4.7.2 slowness work. Each one replaces a loop of single
 * `set()` calls (every set runs persist and wakes every subscriber), so each is pinned to the
 * result of the loop it replaces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CheckoutHydrationStatus, LocalFile } from '../types'
import { usePDMStore } from '../pdmStore'

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const VAULT_ID = 'vault-a'

function status(ownerId: string): CheckoutHydrationStatus {
  return { ownerId, state: 'pending', attempt: 0, lastError: null, requestId: 'req', updatedAt: 1 }
}

function localFile(id: string, diffStatus?: LocalFile['diffStatus']): LocalFile {
  return {
    name: `${id}.sldprt`,
    path: `C:\\vault\\${id}.sldprt`,
    relativePath: `${id}.sldprt`,
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '2026-01-01T00:00:00Z',
    diffStatus,
    isSynced: true,
    pdmData: { id, file_path: `${id}.sldprt`, checked_out_by: null } as LocalFile['pdmData'],
  }
}

describe('removeCloudFiles', () => {
  beforeEach(() => {
    usePDMStore.setState({
      files: [
        localFile('cloud-1', 'cloud'),
        localFile('cloud-2', 'cloud'),
        localFile('local-1'),
        localFile('local-2'),
        localFile('keep'),
      ],
      serverFiles: ['cloud-1', 'cloud-2', 'local-1', 'local-2', 'keep'].map((id) => ({
        id,
        file_path: `${id}.sldprt`,
        name: `${id}.sldprt`,
        extension: '.sldprt',
        content_hash: 'h',
      })),
    })
  })

  const ids = ['cloud-1', 'local-1', 'unknown']

  it('matches one removeCloudFile call per id', () => {
    const initial = usePDMStore.getState()
    for (const id of ids) usePDMStore.getState().removeCloudFile(id)
    const sequential = {
      files: usePDMStore.getState().files,
      serverFiles: usePDMStore.getState().serverFiles,
    }

    usePDMStore.setState({ files: initial.files, serverFiles: initial.serverFiles })
    usePDMStore.getState().removeCloudFiles(ids)

    expect(usePDMStore.getState().files).toEqual(sequential.files)
    expect(usePDMStore.getState().serverFiles).toEqual(sequential.serverFiles)
  })

  it('drops cloud rows, orphans local rows, and leaves the rest untouched', () => {
    const keep = usePDMStore.getState().files.find((file) => file.relativePath === 'keep.sldprt')

    usePDMStore.getState().removeCloudFiles(ids)

    const files = usePDMStore.getState().files
    expect(files.map((file) => file.relativePath)).toEqual([
      'cloud-2.sldprt',
      'local-1.sldprt',
      'local-2.sldprt',
      'keep.sldprt',
    ])
    const orphaned = files.find((file) => file.relativePath === 'local-1.sldprt')
    expect(orphaned?.diffStatus).toBe('deleted_remote')
    expect(orphaned?.pdmData).toBeUndefined()
    expect(files.find((file) => file.relativePath === 'keep.sldprt')).toBe(keep)
    expect(usePDMStore.getState().serverFiles.map((file) => file.id)).toEqual([
      'cloud-2',
      'local-2',
      'keep',
    ])
  })

  it('is one store update for the whole batch', () => {
    const listener = vi.fn()
    const unsubscribe = usePDMStore.subscribe(listener)

    usePDMStore.getState().removeCloudFiles(['cloud-1', 'cloud-2', 'local-1', 'local-2'])
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not touch the store when nothing matches', () => {
    const before = usePDMStore.getState().files
    usePDMStore.getState().removeCloudFiles(['nope'])

    expect(usePDMStore.getState().files).toBe(before)
  })
})

describe('checkout hydration batches', () => {
  beforeEach(() => {
    usePDMStore.getState().clearCheckoutHydration()
  })

  it('sets many statuses in one update, same result as the loop', () => {
    const listener = vi.fn()
    const unsubscribe = usePDMStore.subscribe(listener)

    usePDMStore.getState().setCheckoutHydrationStatuses([
      ['a', status('o1')],
      ['b', status('o2')],
    ])
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(usePDMStore.getState().checkoutHydration).toEqual({ a: status('o1'), b: status('o2') })
  })

  it('clears many statuses in one update and ignores unknown ids', () => {
    usePDMStore.getState().setCheckoutHydrationStatuses([
      ['a', status('o1')],
      ['b', status('o2')],
      ['c', status('o3')],
    ])
    const listener = vi.fn()
    const unsubscribe = usePDMStore.subscribe(listener)

    usePDMStore.getState().clearCheckoutHydrationStatuses(['a', 'c', 'zzz'])
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(Object.keys(usePDMStore.getState().checkoutHydration)).toEqual(['b'])
  })

  it('does not update the store for an empty batch or ids that are not there', () => {
    const before = usePDMStore.getState().checkoutHydration
    usePDMStore.getState().setCheckoutHydrationStatuses([])
    usePDMStore.getState().clearCheckoutHydrationStatuses(['nope'])

    expect(usePDMStore.getState().checkoutHydration).toBe(before)
  })
})

describe('auto-download exclusion batches', () => {
  beforeEach(() => {
    usePDMStore.getState().clearAutoDownloadExclusions(VAULT_ID)
  })

  it('adds many exclusions in one update, skipping duplicates', () => {
    usePDMStore.getState().addAutoDownloadExclusion(VAULT_ID, 'a.sldprt')
    const listener = vi.fn()
    const unsubscribe = usePDMStore.subscribe(listener)

    usePDMStore.getState().addAutoDownloadExclusions(VAULT_ID, ['a.sldprt', 'b.sldprt', 'b.sldprt', 'c.sldprt'])
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(usePDMStore.getState().autoDownloadExcludedFiles[VAULT_ID]).toEqual([
      'a.sldprt',
      'b.sldprt',
      'c.sldprt',
    ])
  })

  it('leaves the store alone when every path is already excluded', () => {
    usePDMStore.getState().addAutoDownloadExclusions(VAULT_ID, ['a.sldprt'])
    const before = usePDMStore.getState().autoDownloadExcludedFiles

    usePDMStore.getState().addAutoDownloadExclusions(VAULT_ID, ['a.sldprt'])

    expect(usePDMStore.getState().autoDownloadExcludedFiles).toBe(before)
  })

  it('removes many exclusions in one update', () => {
    usePDMStore.getState().addAutoDownloadExclusions(VAULT_ID, ['a', 'b', 'c', 'd'])
    const listener = vi.fn()
    const unsubscribe = usePDMStore.subscribe(listener)

    usePDMStore.getState().removeAutoDownloadExclusions(VAULT_ID, new Set(['b', 'd', 'x']))
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(usePDMStore.getState().autoDownloadExcludedFiles[VAULT_ID]).toEqual(['a', 'c'])
  })
})
