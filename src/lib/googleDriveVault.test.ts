import { describe, expect, it } from 'vitest'

import { googleDriveFileIdFromStoragePath, googleDriveRevisionStoragePath } from './googleDriveVault'

describe('Google Drive revision pointers', () => {
  const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_012345'

  it('uses a distinct, non-filesystem storage path', () => {
    expect(googleDriveRevisionStoragePath(fileId)).toBe(`gdrive:${fileId}`)
    expect(googleDriveFileIdFromStoragePath(`gdrive:${fileId}`)).toBe(fileId)
  })

  it('rejects paths that could be interpreted as a local path', () => {
    expect(googleDriveFileIdFromStoragePath('.blueplm/objects/aa/object')).toBeNull()
    expect(googleDriveFileIdFromStoragePath('gdrive:../../secret')).toBeNull()
    expect(() => googleDriveRevisionStoragePath('../not-a-drive-id')).toThrow('invalid revision id')
  })
})
