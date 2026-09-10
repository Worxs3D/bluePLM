import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalFile } from '@/stores/types'

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const getSyncIndex = vi.fn<(vaultId: string) => Promise<Map<string, { orphanedAt?: number }>>>()
const addToSyncIndex = vi.fn<(vaultId: string, paths: string[]) => Promise<void>>()
const removeFromSyncIndex = vi.fn<(vaultId: string, paths: string[]) => Promise<void>>()
const updateInodes = vi.fn<
  (
    vaultId: string,
    entries: Array<{ path: string; ino: number; localVersion?: number; localHash?: string }>,
  ) => Promise<void>
>()

vi.mock('@/lib/cache/localSyncIndex', () => ({
  getSyncIndex,
  addToSyncIndex,
  removeFromSyncIndex,
  updateInodes,
}))

const { repairSyncIndex } = await import('./syncIndexRepair')

function file(overrides: Partial<LocalFile>): LocalFile {
  return {
    name: overrides.name ?? 'part.sldprt',
    path: overrides.path ?? 'C:/vault/part.sldprt',
    relativePath: overrides.relativePath ?? 'part.sldprt',
    isDirectory: false,
    extension: '.sldprt',
    size: 0,
    modifiedTime: new Date().toISOString(),
    ...overrides,
  } as LocalFile
}

function serverBacked(overrides: Partial<LocalFile> = {}): LocalFile {
  return file({
    pdmData: { id: 'server-row' } as LocalFile['pdmData'],
    ...overrides,
  })
}

const VAULT_ID = 'vault-1'

describe('repairSyncIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addToSyncIndex.mockResolvedValue(undefined)
    removeFromSyncIndex.mockResolvedValue(undefined)
    updateInodes.mockResolvedValue(undefined)
  })

  it('preserves an orphan tombstone that has no matching current file', async () => {
    // The tombstone's path is not held by any current server-backed file - the exact
    // shape a naive clear-and-rebuild would misread as safe to drop.
    getSyncIndex.mockResolvedValue(
      new Map([['gone.sldprt', { orphanedAt: Date.now() - 1000 }]]),
    )

    const result = await repairSyncIndex({ vaultId: VAULT_ID, files: [] })

    expect(removeFromSyncIndex).not.toHaveBeenCalled()
    expect(result.outcome).toBe('nothing-to-do')
  })

  it('removes a stale, non-tombstoned entry that matches no current server-backed file', async () => {
    getSyncIndex.mockResolvedValue(new Map([['stale.sldprt', {}]]))

    await repairSyncIndex({ vaultId: VAULT_ID, files: [] })

    expect(removeFromSyncIndex).toHaveBeenCalledWith(VAULT_ID, ['stale.sldprt'])
  })

  it('never removes a tombstoned entry even when nothing else needs repair', async () => {
    getSyncIndex.mockResolvedValue(new Map([['tombstoned.sldprt', { orphanedAt: Date.now() }]]))
    const synced = serverBacked({ relativePath: 'synced.sldprt' })

    await repairSyncIndex({ vaultId: VAULT_ID, files: [synced] })

    // 'synced.sldprt' is missing from the index and gets added; 'tombstoned.sldprt' must
    // never appear in a removeFromSyncIndex call.
    expect(removeFromSyncIndex).not.toHaveBeenCalled()
    expect(addToSyncIndex).toHaveBeenCalledWith(VAULT_ID, ['synced.sldprt'])
  })

  it('adds a currently server-backed file missing from the index', async () => {
    getSyncIndex.mockResolvedValue(new Map())
    const outdated = serverBacked({ relativePath: 'outdated.sldprt', diffStatus: 'outdated' })

    const result = await repairSyncIndex({ vaultId: VAULT_ID, files: [outdated] })

    expect(addToSyncIndex).toHaveBeenCalledWith(VAULT_ID, ['outdated.sldprt'])
    expect(result.outcome).toBe('ok')
    expect(result.attempted).toBe(1)
  })

  it('re-stamps ino, localVersion and localHash for every server-backed file', async () => {
    getSyncIndex.mockResolvedValue(new Map([['part.sldprt', {}]]))
    const target = serverBacked({
      relativePath: 'part.sldprt',
      ino: 42,
      localVersion: 7,
      localHash: 'abc123',
    })

    await repairSyncIndex({ vaultId: VAULT_ID, files: [target] })

    expect(updateInodes).toHaveBeenCalledWith(VAULT_ID, [
      { path: 'part.sldprt', ino: 42, localVersion: 7, localHash: 'abc123' },
    ])
  })

  it('excludes moved and moved_away rows so an unresolved move is never written into the index', async () => {
    getSyncIndex.mockResolvedValue(new Map())
    const moved = serverBacked({ relativePath: 'new-name.sldprt', diffStatus: 'moved' })
    const movedAway = serverBacked({ relativePath: 'old-name.sldprt', diffStatus: 'moved_away' })

    const result = await repairSyncIndex({ vaultId: VAULT_ID, files: [moved, movedAway] })

    expect(addToSyncIndex).not.toHaveBeenCalled()
    expect(result.outcome).toBe('nothing-to-do')
  })

  it('excludes local-only and cloud-only files, which have no server row to repair against', async () => {
    getSyncIndex.mockResolvedValue(new Map())
    const localOnly = file({ relativePath: 'new.sldprt', diffStatus: 'added' })
    const cloudOnly = serverBacked({ relativePath: 'cloud.sldprt', diffStatus: 'cloud' })

    const result = await repairSyncIndex({ vaultId: VAULT_ID, files: [localOnly, cloudOnly] })

    expect(addToSyncIndex).not.toHaveBeenCalled()
    expect(result.outcome).toBe('nothing-to-do')
  })

  it('makes no index writes when the index already matches current truth', async () => {
    getSyncIndex.mockResolvedValue(new Map([['part.sldprt', {}]]))
    const target = serverBacked({ relativePath: 'part.sldprt' })

    const result = await repairSyncIndex({ vaultId: VAULT_ID, files: [target] })

    // No ino on this file, so updateInodes has nothing to restamp; the path is already
    // indexed, so nothing is added or removed either.
    expect(addToSyncIndex).not.toHaveBeenCalled()
    expect(removeFromSyncIndex).not.toHaveBeenCalled()
    expect(updateInodes).not.toHaveBeenCalled()
    expect(result.outcome).toBe('ok')
  })
})
