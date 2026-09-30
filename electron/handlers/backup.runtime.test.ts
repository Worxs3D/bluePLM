import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
vi.mock('./backupDevice', () => ({ resolveMdbBackupRuntime: vi.fn(async () => ({ access_key_encrypted: 'main-access', secret_key_encrypted: 'main-secret', restic_password_encrypted: 'main-password' })) }))

import { resolveMainProcessRuntime, sanitizeBackupResult } from './backup'

describe('MDB main-only backup runtime transport', () => {
  it.each(['backup', 'list', 'delete', 'restore'])('%s replaces renderer placeholders with main runtime credentials', async () => {
    const resolved = await resolveMainProcessRuntime({ mdbRuntime: true, accessKey: 'renderer-access', secretKey: 'renderer-secret', resticPassword: 'renderer-password', operation: 'test' })
    expect(resolved).toMatchObject({ accessKey: 'main-access', secretKey: 'main-secret', resticPassword: 'main-password' })
    expect(resolved.accessKey).not.toBe('renderer-access')
  })

  it('keeps legacy backend credentials untouched and removes credential-shaped response fields', async () => {
    const legacy = await resolveMainProcessRuntime({ accessKey: 'legacy-access', secretKey: 'legacy-secret', resticPassword: 'legacy-password' })
    expect(legacy).toEqual({ accessKey: 'legacy-access', secretKey: 'legacy-secret', resticPassword: 'legacy-password' })
    expect(sanitizeBackupResult({ success: true, snapshotId: 'safe', accessKey: 'main-access', secretKey: 'main-secret', resticPassword: 'main-password' })).toEqual({ success: true, snapshotId: 'safe' })
  })
})
