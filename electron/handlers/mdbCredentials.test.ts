import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let root = ''
const { encryptSpy } = vi.hoisted(() => ({ encryptSpy: vi.fn((value: string) => Buffer.from(value, 'utf8')) }))
;(globalThis as { __mdbCredentialsRoot?: string }).__mdbCredentialsRoot = ''
vi.mock('electron', () => ({
  app: { getPath: () => (globalThis as { __mdbCredentialsRoot?: string }).__mdbCredentialsRoot ?? '' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: encryptSpy,
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

import { clearMdbServerCredentials, getMdbServerCredentialState, readMdbServerCredentials, saveMdbServerCredentials, storedCredentialFilePathsForTests } from './mdbCredentials'

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'blueplm-mdb-credentials-'))
  ;(globalThis as { __mdbCredentialsRoot?: string }).__mdbCredentialsRoot = root
})

afterEach(async () => {
  await clearMdbServerCredentials()
  await fs.rm(root, { recursive: true, force: true })
})

describe('MDB deployment credential storage', () => {
  it('uses installer FTPS validation for root paths, ports, and unsafe input', async () => {
    await expect(saveMdbServerCredentials({ ftpUrl: 'ftps://example.invalid:21', ftpSecurity: 'explicit', ftpRemotePath: '', ftpUsername: 'deploy' }, { ftpPassword: 'password-value', maintenanceToken: 'maintenance-value' }, { serverUrl: 'https://example.invalid', organizationId: 'org-1' })).resolves.toBeUndefined()
    await clearMdbServerCredentials()
    for (const profile of [
      { ftpUrl: 'ftps://example.invalid:990', ftpSecurity: 'explicit' as const, ftpRemotePath: '', ftpUsername: 'deploy' },
      { ftpUrl: 'ftps://example.invalid:21', ftpSecurity: 'explicit' as const, ftpRemotePath: '../escape', ftpUsername: 'deploy' },
      { ftpUrl: 'ftps://example.invalid:21', ftpSecurity: 'explicit' as const, ftpRemotePath: '', ftpUsername: 'deploy\r\nuser' },
    ]) await expect(saveMdbServerCredentials(profile, { ftpPassword: 'password-value', maintenanceToken: 'maintenance-value' }, { serverUrl: 'https://example.invalid', organizationId: 'org-1' })).rejects.toThrow('INVALID_PROFILE')
  })

  it('stores secrets only through the encrypted file and never as plaintext', async () => {
    await saveMdbServerCredentials(
      { ftpUrl: 'ftps://example.invalid:21', ftpSecurity: 'explicit', ftpRemotePath: '/srv/blueplm', ftpUsername: 'deploy' },
      { ftpPassword: 'password-value', maintenanceToken: 'maintenance-value' },
      { serverUrl: 'https://example.invalid', organizationId: 'org-1' },
    )
    const files = storedCredentialFilePathsForTests()
    const rawSecretFile = await fs.readFile(files.secrets, 'utf8')
    const rawProfile = await fs.readFile(files.profile, 'utf8')
    expect(encryptSpy).toHaveBeenCalled()
    expect(rawSecretFile).not.toContain('ftps://example.invalid')
    expect(rawSecretFile).not.toContain('deploy')
    expect(rawSecretFile).not.toContain('password-value')
    expect(rawSecretFile).not.toContain('maintenance-value')
    expect(rawProfile).not.toContain('password-value')
    expect(rawProfile).not.toContain('maintenance-value')
    expect(await readMdbServerCredentials()).not.toBeNull()
    expect((await getMdbServerCredentialState()).hasCredentials).toBe(true)
  })
})
