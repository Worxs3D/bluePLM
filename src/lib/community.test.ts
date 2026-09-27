import { describe, expect, it } from 'vitest'

import { communityObjectStoragePath, normalizeCommunityOrgVaultAccess } from './community'

describe('communityObjectStoragePath', () => {
  it('uses a content-addressed immutable object path', () => {
    const hash = 'AB'.repeat(32)

    expect(communityObjectStoragePath(hash)).toBe(`.blueplm/objects/ab/${hash.toLowerCase()}`)
  })

  it('rejects values that are not SHA-256 hashes', () => {
    expect(() => communityObjectStoragePath('../not-a-hash')).toThrow('SHA-256')
  })
})

describe('normalizeCommunityOrgVaultAccess', () => {
  it('converts the legacy user-to-vault response into the client vault-to-user contract', () => {
    expect(
      normalizeCommunityOrgVaultAccess(
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

    expect(normalizeCommunityOrgVaultAccess(accessMap, ['vault-a', 'vault-b'])).toEqual(accessMap)
  })
})
