import { getGoogleDriveToken } from '@/features/integrations/google-drive/lib/sheetTemplates'

const GOOGLE_DRIVE_STORAGE_PREFIX = 'gdrive:'

export function requireGoogleDriveVaultToken(): string {
  const token = getGoogleDriveToken()
  if (!token) {
    throw new Error('Connect Google Drive for this Windows user before using a Google Drive vault.')
  }
  return token
}

/** A revision pointer that cannot be confused with a network-vault path. */
export function googleDriveRevisionStoragePath(fileId: string): string {
  if (!/^[A-Za-z0-9_-]{10,512}$/.test(fileId)) {
    throw new Error('Google Drive returned an invalid revision id.')
  }
  return `${GOOGLE_DRIVE_STORAGE_PREFIX}${fileId}`
}

export function googleDriveFileIdFromStoragePath(storagePath: string | null | undefined): string | null {
  if (!storagePath?.startsWith(GOOGLE_DRIVE_STORAGE_PREFIX)) return null
  const fileId = storagePath.slice(GOOGLE_DRIVE_STORAGE_PREFIX.length)
  return /^[A-Za-z0-9_-]{10,512}$/.test(fileId) ? fileId : null
}
