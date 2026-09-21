import { createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ipcMain } from 'electron'

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024

export interface GoogleDriveUploadRequest {
  sourcePath: string
  parentFolderId: string
  fileName: string
  accessToken: string
}

export interface GoogleDriveDownloadRequest {
  fileId: string
  targetPath: string
  accessToken: string
}

export interface GoogleDriveTransferResult {
  success: boolean
  fileId?: string
  size?: number
  error?: string
}

export interface GoogleDriveSmallReadResult extends GoogleDriveTransferResult {
  data?: string
}

const MAX_SMALL_READ_BYTES = 3 * 1024 * 1024

function isGoogleDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,512}$/.test(value)
}

function isAccessToken(value: string): boolean {
  return value.trim().length >= 20 && value.length <= 8_192
}

function isFileName(value: string): boolean {
  return value.trim().length > 0 && value.length <= 512 && !/[\\/\0]/.test(value)
}

function errorFromResponse(prefix: string, response: Response): string {
  return `${prefix} (${response.status} ${response.statusText || 'request failed'})`
}

async function startResumableUpload(
  request: GoogleDriveUploadRequest,
  size: number,
): Promise<{ location?: string; error?: string }> {
  const response = await fetch(
    `${DRIVE_UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'application/octet-stream',
      },
      body: JSON.stringify({ name: request.fileName, parents: [request.parentFolderId] }),
    },
  )

  if (!response.ok) return { error: errorFromResponse('Could not start Google Drive upload', response) }
  const location = response.headers.get('location')
  return location ? { location } : { error: 'Google Drive did not return an upload session.' }
}

/**
 * Streams a local file to the Drive resumable-upload endpoint.  Keeping this in
 * the Electron main process avoids loading a complete CAD file into Chromium.
 */
export async function uploadGoogleDriveFile(
  request: GoogleDriveUploadRequest,
): Promise<GoogleDriveTransferResult> {
  if (
    !request.sourcePath ||
    !isGoogleDriveId(request.parentFolderId) ||
    !isFileName(request.fileName) ||
    !isAccessToken(request.accessToken)
  ) {
    return { success: false, error: 'Invalid Google Drive upload request.' }
  }

  try {
    const source = await stat(request.sourcePath)
    if (!source.isFile()) return { success: false, error: 'The selected upload source is not a file.' }

    const session = await startResumableUpload(request, source.size)
    if (!session.location) return { success: false, error: session.error || 'Could not start Google Drive upload.' }

    const handle = await open(request.sourcePath, 'r')
    try {
      let offset = 0
      while (offset < source.size) {
        const bytes = Math.min(RESUMABLE_CHUNK_BYTES, source.size - offset)
        const chunk = Buffer.allocUnsafe(bytes)
        const { bytesRead } = await handle.read(chunk, 0, bytes, offset)
        if (bytesRead !== bytes) {
          return { success: false, error: 'The local file changed while it was uploaded.' }
        }

        const response = await fetch(session.location, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${request.accessToken}`,
            'Content-Length': String(bytesRead),
            'Content-Range': `bytes ${offset}-${offset + bytesRead - 1}/${source.size}`,
          },
          body: chunk,
        })

        if (response.status === 308) {
          offset += bytesRead
          continue
        }

        if (!response.ok) {
          return { success: false, error: errorFromResponse('Google Drive upload failed', response) }
        }

        const result = (await response.json()) as { id?: string; size?: string }
        if (!result.id || !isGoogleDriveId(result.id)) {
          return { success: false, error: 'Google Drive did not return an uploaded file id.' }
        }
        return { success: true, fileId: result.id, size: result.size ? Number(result.size) : source.size }
      }
    } finally {
      await handle.close()
    }

    // A zero-byte file does not enter the chunk loop, but remains a real Drive object.
    const response = await fetch(session.location, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${request.accessToken}`,
        'Content-Length': '0',
        'Content-Range': 'bytes */0',
      },
    })
    if (!response.ok) return { success: false, error: errorFromResponse('Google Drive upload failed', response) }
    const result = (await response.json()) as { id?: string; size?: string }
    return result.id && isGoogleDriveId(result.id)
      ? { success: true, fileId: result.id, size: result.size ? Number(result.size) : 0 }
      : { success: false, error: 'Google Drive did not return an uploaded file id.' }
  } catch {
    return { success: false, error: 'Google Drive upload could not access the local file or network.' }
  }
}

/** Downloads to a sibling temporary file and only replaces the target after a complete stream. */
export async function downloadGoogleDriveFile(
  request: GoogleDriveDownloadRequest,
): Promise<GoogleDriveTransferResult> {
  if (!request.targetPath || !isGoogleDriveId(request.fileId) || !isAccessToken(request.accessToken)) {
    return { success: false, error: 'Invalid Google Drive download request.' }
  }

  const targetDirectory = path.dirname(request.targetPath)
  const temporaryPath = `${request.targetPath}.blueplm-download-${process.pid}-${Date.now()}.tmp`
  try {
    await mkdir(targetDirectory, { recursive: true })
    const response = await fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(request.fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${request.accessToken}` } },
    )
    if (!response.ok || !response.body) {
      return { success: false, error: errorFromResponse('Google Drive download failed', response) }
    }

    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporaryPath, { flags: 'wx' }))
    const downloaded = await stat(temporaryPath)
    await rename(temporaryPath, request.targetPath)
    return { success: true, size: downloaded.size }
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    return { success: false, error: 'Google Drive download could not write the local file or access the network.' }
  }
}

/** Item images are deliberately capped; CAD revisions must use the streaming API above. */
export async function readSmallGoogleDriveFile(
  fileId: string,
  accessToken: string,
): Promise<GoogleDriveSmallReadResult> {
  if (!isGoogleDriveId(fileId) || !isAccessToken(accessToken)) {
    return { success: false, error: 'Invalid Google Drive read request.' }
  }
  try {
    const response = await fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!response.ok) return { success: false, error: errorFromResponse('Google Drive image download failed', response) }
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_SMALL_READ_BYTES) {
      return { success: false, error: 'Google Drive image is larger than the 3 MB display limit.' }
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_SMALL_READ_BYTES) {
      return { success: false, error: 'Google Drive image is larger than the 3 MB display limit.' }
    }
    return { success: true, size: bytes.length, data: bytes.toString('base64') }
  } catch {
    return { success: false, error: 'Google Drive image could not be read.' }
  }
}

export function registerGoogleDriveStorageHandlers(): void {
  ipcMain.handle('google-drive-storage:upload', async (_event, request: GoogleDriveUploadRequest) =>
    uploadGoogleDriveFile(request),
  )
  ipcMain.handle('google-drive-storage:download', async (_event, request: GoogleDriveDownloadRequest) =>
    downloadGoogleDriveFile(request),
  )
  ipcMain.handle('google-drive-storage:read-small', async (_event, fileId: string, accessToken: string) =>
    readSmallGoogleDriveFile(fileId, accessToken),
  )
}

export function unregisterGoogleDriveStorageHandlers(): void {
  ipcMain.removeHandler('google-drive-storage:upload')
  ipcMain.removeHandler('google-drive-storage:download')
  ipcMain.removeHandler('google-drive-storage:read-small')
}
