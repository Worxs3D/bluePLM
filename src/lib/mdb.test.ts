import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearMdbConfig, mdbObjectStoragePath, normalizeMdbOrgVaultAccess, saveMdbConfig } from './mdb'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mdbObjectStoragePath', () => {
  it('uses a content-addressed immutable object path', () => {
    const hash = 'AB'.repeat(32)

    expect(mdbObjectStoragePath(hash)).toBe(`.blueplm/objects/ab/${hash.toLowerCase()}`)
  })

  it('rejects values that are not SHA-256 hashes', () => {
    expect(() => mdbObjectStoragePath('../not-a-hash')).toThrow('SHA-256')
  })
})

describe('normalizeMdbOrgVaultAccess', () => {
  it('converts the legacy user-to-vault response into the client vault-to-user contract', () => {
    expect(
      normalizeMdbOrgVaultAccess(
        {
          'user-1': ['vault-a', 'vault-b'],
          'user-2': ['vault-b'],
        },
        ['vault-a', 'vault-b'],
      ),
    ).toEqual({
      'vault-a': ['user-1'],
      'vault-b': ['user-1', 'user-2'],
    })
  })

  it('keeps a corrected vault-to-user response unchanged', () => {
    const accessMap = {
      'vault-a': ['user-1'],
      'vault-b': ['user-1', 'user-2'],
    }

    expect(normalizeMdbOrgVaultAccess(accessMap, ['vault-a', 'vault-b'])).toEqual(accessMap)
  })
})

describe('MDB config backup bridge', () => {
  it('does not require a renderer window in the Node test context', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })

    expect(() => saveMdbConfig({ version: 1, serverUrl: 'http://localhost:3000', accessToken: 'token' })).not.toThrow()
    expect(() => clearMdbConfig()).not.toThrow()
  })
})
