import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))
vi.mock('basic-ftp', () => ({ Client: class {} }))
import { assertOwnerOrAdmin, classifyMdbServerUpdate, executeMdbServerUpdatePlan } from './mdbServerUpdate'

const activation = { targetRoot: '/live', stageRoot: '/stage', backupRoot: '/backup', existing: [], promoted: [] }

describe('MDB server update seam', () => {
  it('classifies missing, matching, and changed deployment manifests', () => {
    const packaged = { version: 1 as const, releaseVersion: '4.4.4', digest: 'a'.repeat(64), fileCount: 3 }
    expect(classifyMdbServerUpdate(packaged, null)).toBe('unknown')
    expect(classifyMdbServerUpdate(packaged, { bundleVersion: 1, bundleReleaseVersion: '4.4.4', bundleDigest: packaged.digest, bundleFileCount: 3 })).toBe('current')
    expect(classifyMdbServerUpdate(packaged, { bundleVersion: 1, bundleReleaseVersion: '4.4.3', bundleDigest: 'b'.repeat(64), bundleFileCount: 3 })).toBe('update-available')
    expect(classifyMdbServerUpdate(packaged, { bundleVersion: 1, bundleReleaseVersion: '4.4.5', bundleDigest: 'b'.repeat(64), bundleFileCount: 3 })).toBe('server-newer')
    expect(classifyMdbServerUpdate(packaged, { bundleVersion: 1, bundleReleaseVersion: '4.4.4', bundleDigest: 'b'.repeat(64), bundleFileCount: 3 })).toBe('same-version-different')
    expect(classifyMdbServerUpdate({ ...packaged, releaseVersion: '4.4.4-beta.2' }, { bundleVersion: 1, bundleReleaseVersion: '4.4.4-beta.10', bundleDigest: 'b'.repeat(64), bundleFileCount: 3 })).toBe('server-newer')
    expect(classifyMdbServerUpdate({ ...packaged, releaseVersion: '4.4.4-beta.10' }, { bundleVersion: 1, bundleReleaseVersion: '4.4.4-beta.2', bundleDigest: 'b'.repeat(64), bundleFileCount: 3 })).toBe('update-available')
  })

  it('does not activate when migrations fail, and always cleans up', async () => {
    const activate = vi.fn(async () => activation)
    const rollback = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    const result = await executeMdbServerUpdatePlan({
      migrate: async () => { throw new Error('migration failed') },
      activate,
      verifyHealth: async () => true,
      finalize: async () => undefined,
      rollback,
      cleanup,
    })
    expect(result).toMatchObject({ success: false, status: 'failure', errorCode: 'DEPLOYMENT_FAILED' })
    expect(activate).not.toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('rolls files back when activation health does not match', async () => {
    const rollback = vi.fn(async () => undefined)
    const finalize = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    const result = await executeMdbServerUpdatePlan({
      migrate: async () => undefined,
      activate: async () => activation,
      verifyHealth: async () => false,
      finalize,
      rollback,
      cleanup,
    })
    expect(result).toMatchObject({ success: false, status: 'rollback', errorCode: 'HEALTH_MISMATCH' })
    expect(rollback).toHaveBeenCalledWith(activation)
    expect(finalize).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('preserves staged evidence when rollback fails', async () => {
    const cleanup = vi.fn(async () => undefined)
    const result = await executeMdbServerUpdatePlan({
      migrate: async () => undefined,
      activate: async () => activation,
      verifyHealth: async () => false,
      finalize: async () => undefined,
      rollback: async () => { throw new Error('restore failed') },
      cleanup,
    })
    expect(result).toMatchObject({ success: false, status: 'failure', errorCode: 'ROLLBACK_FAILED' })
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('activates and finalizes only after migration and health verification', async () => {
    const calls: string[] = []
    const result = await executeMdbServerUpdatePlan({
      migrate: async () => { calls.push('migrate') },
      activate: async () => { calls.push('activate'); return activation },
      verifyHealth: async () => { calls.push('verify'); return true },
      finalize: async () => { calls.push('finalize') },
      rollback: async () => { calls.push('rollback') },
      cleanup: async () => { calls.push('cleanup') },
    })
    expect(result).toMatchObject({ success: true, status: 'current' })
    expect(calls).toEqual(['migrate', 'activate', 'verify', 'finalize', 'cleanup'])
  })

  it('requires an owner or admin proof tied to the requested organization', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { organizationId: 'org-1', role: 'admin' } }), { status: 200 })))
    await expect(assertOwnerOrAdmin('https://mdb.example.test', 'session', 'org-1')).resolves.toBeUndefined()
    await expect(assertOwnerOrAdmin('https://mdb.example.test', 'session', 'org-2')).rejects.toThrow('NOT_AUTHORIZED')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { organizationId: 'org-1', role: 'member' } }), { status: 200 })))
    await expect(assertOwnerOrAdmin('https://mdb.example.test', 'session', 'org-1')).rejects.toThrow('NOT_AUTHORIZED')
    vi.unstubAllGlobals()
  })

  it('fails closed when the maintenance token is rejected before activation', async () => {
    const result = await executeMdbServerUpdatePlan({
      migrate: async () => { throw new Error('Migration token is invalid.') },
      activate: async () => activation,
      verifyHealth: async () => true,
      finalize: async () => undefined,
      rollback: async () => undefined,
      cleanup: async () => undefined,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'MAINTENANCE_TOKEN_REJECTED' })
  })
})
