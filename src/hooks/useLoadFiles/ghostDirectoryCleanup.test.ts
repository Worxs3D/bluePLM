import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalFile } from '@/stores/types'
import { removeGhostDirectories, resetGhostDirectoryMemo } from './ghostDirectoryCleanup'

function dir(relativePath: string, modifiedTime = '2026-10-01T00:00:00.000Z'): LocalFile {
  return {
    name: relativePath,
    path: `C:/Vault/${relativePath}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime,
  }
}

const DELETED = [{ folder_path: 'WLC Fibre', deleted_at: '2026-10-20T00:00:00.000Z' }]

describe('removeGhostDirectories', () => {
  beforeEach(() => resetGhostDirectoryMemo())

  it('recycles the ghost and reports it for removal from the store', async () => {
    const fetchDeletedFolders = vi.fn().mockResolvedValue({ folders: DELETED })
    const trashEmptyDirs = vi.fn().mockResolvedValue({
      results: [{ path: 'C:/Vault/WLC Fibre', success: true }],
    })

    const result = await removeGhostDirectories({
      vaultId: 'v1',
      files: [dir('WLC Fibre'), dir('Mine')],
      serverFolderPaths: new Set(),
      fetchDeletedFolders,
      trashEmptyDirs,
    })

    expect(fetchDeletedFolders).toHaveBeenCalledWith(['WLC Fibre', 'Mine'])
    expect(trashEmptyDirs).toHaveBeenCalledWith(['C:/Vault/WLC Fibre'])
    expect(result).toEqual({ removed: ['C:/Vault/WLC Fibre'], kept: 0 })
  })

  it('does not query the server when there is nothing unasserted', async () => {
    const fetchDeletedFolders = vi.fn()
    const result = await removeGhostDirectories({
      vaultId: 'v1',
      files: [dir('Live')],
      serverFolderPaths: new Set(['Live']),
      fetchDeletedFolders,
      trashEmptyDirs: vi.fn(),
    })
    expect(fetchDeletedFolders).not.toHaveBeenCalled()
    expect(result).toEqual({ removed: [], kept: 0 })
  })

  it('asks about a settled folder only once, until it changes', async () => {
    const fetchDeletedFolders = vi.fn().mockResolvedValue({ folders: [] })
    const input = {
      vaultId: 'v1',
      serverFolderPaths: new Set<string>(),
      fetchDeletedFolders,
      trashEmptyDirs: vi.fn(),
    }

    await removeGhostDirectories({ ...input, files: [dir('Mine')] })
    await removeGhostDirectories({ ...input, files: [dir('Mine')] })
    expect(fetchDeletedFolders).toHaveBeenCalledTimes(1)

    await removeGhostDirectories({ ...input, files: [dir('Mine', '2026-10-25T00:00:00.000Z')] })
    expect(fetchDeletedFolders).toHaveBeenCalledTimes(2)
  })

  it('does not retry a ghost the main process refused', async () => {
    const fetchDeletedFolders = vi.fn().mockResolvedValue({ folders: DELETED })
    const trashEmptyDirs = vi.fn().mockResolvedValue({
      results: [{ path: 'C:/Vault/WLC Fibre', success: false }],
    })
    const input = {
      vaultId: 'v1',
      files: [dir('WLC Fibre')],
      serverFolderPaths: new Set<string>(),
      fetchDeletedFolders,
      trashEmptyDirs,
    }

    expect(await removeGhostDirectories(input)).toEqual({ removed: [], kept: 1 })
    await removeGhostDirectories(input)
    expect(trashEmptyDirs).toHaveBeenCalledTimes(1)
  })

  it('looks again at a folder the server listed in between, once it is deleted', async () => {
    const fetchDeletedFolders = vi.fn().mockResolvedValue({ folders: [] })
    const base = { vaultId: 'v1', files: [dir('X')], fetchDeletedFolders, trashEmptyDirs: vi.fn() }

    await removeGhostDirectories({ ...base, serverFolderPaths: new Set() })
    await removeGhostDirectories({ ...base, serverFolderPaths: new Set(['X']) })
    await removeGhostDirectories({ ...base, serverFolderPaths: new Set() })
    expect(fetchDeletedFolders).toHaveBeenCalledTimes(2)
  })

  it('touches nothing when the lookup fails', async () => {
    const trashEmptyDirs = vi.fn()
    const result = await removeGhostDirectories({
      vaultId: 'v1',
      files: [dir('WLC Fibre')],
      serverFolderPaths: new Set(),
      fetchDeletedFolders: vi.fn().mockResolvedValue({ folders: [], error: 'offline' }),
      trashEmptyDirs,
    })
    expect(trashEmptyDirs).not.toHaveBeenCalled()
    expect(result.error).toBe('offline')
  })
})
