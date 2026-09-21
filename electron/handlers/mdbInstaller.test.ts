import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

import { resolveSecrets, type MdbProvisionRequest } from './mdbInstaller'

const request: MdbProvisionRequest = {
  publicUrl: 'https://blueplm.example.test', ftpUrl: 'ftps://ftp.example.test', ftpRemotePath: 'blueplm-mdb',
  ftpUsername: 'deploy', ftpPassword: 'not-used-by-this-test', databaseHost: 'localhost', databasePort: 3306,
  databaseName: 'blueplm', databaseUser: 'blueplm', databasePassword: 'not-used-by-this-test', documentRootConfirmed: true,
}

describe('MDB installer secrets', () => {
  it('generates three independent first-install secrets only when none were supplied', () => {
    const result = resolveSecrets(request)
    expect(result.generated).toBeDefined()
    expect(result.secrets.sessionSecret).toHaveLength(43)
    expect(new Set(Object.values(result.secrets)).size).toBe(3)
  })

  it('rejects partial secret input instead of silently mixing generated and supplied values', () => {
    expect(() => resolveSecrets({ ...request, sessionSecret: 'x'.repeat(32) })).toThrow('Enter all three secrets')
  })

  it('keeps a complete administrator-supplied secret set', () => {
    const supplied = { sessionSecret: 'a'.repeat(32), bootstrapToken: 'b'.repeat(32), maintenanceToken: 'c'.repeat(32) }
    expect(resolveSecrets({ ...request, ...supplied })).toEqual({ secrets: supplied })
  })
})
