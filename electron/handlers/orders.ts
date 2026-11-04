/**
 * Orders (5.11.0): export an order's files as a zip, or into a new folder, on the desktop.
 *
 * The renderer plans the export (names, hashes, the CSV and order.json) and signs a URL for each
 * stored file; this process owns the rest. It asks where to save (a save dialog for a zip, a
 * folder picker for a folder), downloads each URL streaming to disk while hashing it, and fails
 * the whole export when any download is not the content it names: nothing is left behind, and no
 * partial zip or folder is kept. Memory stays bounded: files stream to a temp folder (or straight
 * into the new folder) and the zip streams from them without compression (CAD outputs barely
 * compress), so neither is held whole.
 *
 * Every input is checked here: https URLs only (plain http only to this machine, for a local
 * Supabase), SHA-256 hashes, sizes and counts within limits, and every path inside the export a
 * plain relative path (no `..`, no absolute path, no drive letter, no characters or names Windows
 * refuses, no two paths that differ only in case).
 */
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import JSZip from 'jszip'
import os from 'os'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeReadableStream } from 'stream/web'

export const ORDER_EXPORT_CHANNEL = 'orders:export'
export const ORDER_EXPORT_PROGRESS_CHANNEL = 'orders:export-progress'

/** Files one export may hold. */
export const ORDER_EXPORT_MAX_FILES = 2000
/** One file at most (a STEP of a large assembly can be big). */
export const ORDER_EXPORT_MAX_FILE_BYTES = 2 * 1024 ** 3
/** A zip at most: JSZip writes no ZIP64, so a zip stays well under 4 GiB. */
export const ORDER_EXPORT_MAX_ZIP_BYTES = 3.5 * 1024 ** 3
/** A folder export at most. */
export const ORDER_EXPORT_MAX_FOLDER_BYTES = 50 * 1024 ** 3
/** The CSV and order.json: a few texts of bounded size. */
const MAX_TEXTS = 4
const MAX_TEXT_BYTES = 16 * 1024 * 1024
const MAX_PATH_LENGTH = 240
const MAX_SEGMENT_LENGTH = 200
const DOWNLOAD_CONCURRENCY = 4
const TEMP_DIR = 'blueplm-order-export'
const HASH = /^[0-9a-f]{64}$/
// eslint-disable-next-line no-control-regex
const INVALID_SEGMENT_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export type OrderExportMode = 'zip' | 'folder'

export interface OrderExportFile {
  /** Relative path inside the export. */
  path: string
  /** Signed download URL. */
  url: string
  /** SHA-256 the content must hash to. */
  sha256: string
  /** Expected bytes (the recorded size); a sanity limit, the hash decides. */
  size: number
}

export interface OrderExportText {
  path: string
  content: string
}

export interface OrderExportRequest {
  mode: OrderExportMode
  /** Base name of the zip or folder (the order number). */
  name: string
  files: OrderExportFile[]
  texts: OrderExportText[]
}

export type OrderExportErrorCode =
  | 'INVALID_REQUEST'
  | 'TOO_MANY_FILES'
  | 'TOO_LARGE'
  | 'HASH_MISMATCH'
  | 'DOWNLOAD_FAILED'
  | 'WRITE_FAILED'

export type OrderExportResult =
  | { success: true; path: string; files: number; bytes: number }
  | { success: false; canceled: true }
  | { success: false; canceled?: false; code: OrderExportErrorCode; error: string; path?: string }

export interface OrderExportProgress {
  phase: 'downloading' | 'writing'
  completed: number
  total: number
}

export interface OrderHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

let log: (message: string, data?: unknown) => void = () => undefined
let logError: (message: string, data?: unknown) => void = () => undefined

class ExportError extends Error {
  constructor(
    readonly code: OrderExportErrorCode,
    message: string,
    readonly exportPath?: string,
  ) {
    super(message)
    this.name = 'ExportError'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * A relative path inside the export, with `/` separators, or null when it is not one: empty, too
 * long, absolute, a drive letter, a backslash, `.` / `..` / empty segments, characters Windows
 * refuses, a device name, or a segment ending in a dot or space.
 */
export function safeExportPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) return null
  if (value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/.test(value)) return null
  const segments = value.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null
    if (segment.length > MAX_SEGMENT_LENGTH) return null
    if (INVALID_SEGMENT_CHARS.test(segment)) return null
    if (RESERVED_NAMES.test(segment)) return null
    if (/[. ]$/.test(segment) || /^ /.test(segment)) return null
  }
  return segments.join('/')
}

/** A base name for the zip or folder: no folders, nothing Windows refuses, never empty. */
export function safeExportName(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  return cleaned && !RESERVED_NAMES.test(cleaned) ? cleaned : 'order'
}

/** https, or http to this machine only (a local Supabase). */
export function allowedDownloadUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The request, checked and normalized. Throws `ExportError` naming the first problem. */
export function validateExportRequest(input: unknown): OrderExportRequest {
  const bad = (message: string): never => {
    throw new ExportError('INVALID_REQUEST', message)
  }
  if (!isRecord(input)) return bad('Not an export request')
  const mode = input.mode
  if (mode !== 'zip' && mode !== 'folder') return bad('Unknown export mode')
  if (!Array.isArray(input.files) || !Array.isArray(input.texts)) return bad('Missing files')
  if (input.files.length > ORDER_EXPORT_MAX_FILES) {
    throw new ExportError('TOO_MANY_FILES', `More than ${ORDER_EXPORT_MAX_FILES} files`)
  }
  if (input.texts.length > MAX_TEXTS) return bad('Too many text files')

  const seen = new Set<string>()
  const claim = (p: unknown): string => {
    const safe = safeExportPath(p)
    if (!safe) return bad(`Not a safe path inside the export: ${String(p)}`)
    const key = safe.toLowerCase()
    if (seen.has(key)) return bad(`Two files at one path: ${safe}`)
    seen.add(key)
    return safe
  }

  let total = 0
  const files: OrderExportFile[] = input.files.map((f: unknown) => {
    if (!isRecord(f)) return bad('Not a file entry')
    const filePath = claim(f.path)
    if (!allowedDownloadUrl(f.url)) return bad(`Not an https download URL: ${filePath}`)
    const sha256 = typeof f.sha256 === 'string' ? f.sha256.toLowerCase() : ''
    if (!HASH.test(sha256)) return bad(`Not a SHA-256 hash: ${filePath}`)
    const size = f.size
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return bad(`Bad size: ${filePath}`)
    if (size > ORDER_EXPORT_MAX_FILE_BYTES) throw new ExportError('TOO_LARGE', `Too large: ${filePath}`)
    total += size
    return { path: filePath, url: f.url as string, sha256, size }
  })
  const texts: OrderExportText[] = input.texts.map((t: unknown) => {
    if (!isRecord(t) || typeof t.content !== 'string') return bad('Not a text entry')
    const textPath = claim(t.path)
    if (Buffer.byteLength(t.content, 'utf8') > MAX_TEXT_BYTES) return bad(`Text too large: ${textPath}`)
    total += Buffer.byteLength(t.content, 'utf8')
    return { path: textPath, content: t.content }
  })
  if (files.length + texts.length === 0) return bad('Nothing to export')
  const max = mode === 'zip' ? ORDER_EXPORT_MAX_ZIP_BYTES : ORDER_EXPORT_MAX_FOLDER_BYTES
  if (total > max) throw new ExportError('TOO_LARGE', `The export is larger than ${(max / 1024 ** 3).toFixed(1)} GiB`)

  return { mode, name: safeExportName(input.name), files, texts }
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

/** Bytes one export may still download, shared by its parallel downloads. */
export interface DownloadBudget {
  used: number
  max: number
}

/**
 * Download `url` to `target`, hashing as it streams. Rejects (and removes the partial file) on a
 * network or write error, a body over `maxBytes`, an export over its `budget` (both
 * `TOO_LARGE`, counted from the bytes that really arrive, not the sizes declared), an abort, or a
 * hash other than `expectedHash` (`HASH_MISMATCH`).
 */
export async function downloadToFile(
  url: string,
  target: string,
  expectedHash: string,
  maxBytes: number,
  signal?: AbortSignal,
  budget?: DownloadBudget,
): Promise<number> {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) {
    throw new ExportError('DOWNLOAD_FAILED', `Download failed (HTTP ${response.status})`)
  }
  const hash = crypto.createHash('sha256')
  let bytes = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        callback(new ExportError('TOO_LARGE', 'A file is larger than its limit'))
        return
      }
      if (budget) {
        budget.used += chunk.length
        if (budget.used > budget.max) {
          callback(new ExportError('TOO_LARGE', 'The export is larger than its limit'))
          return
        }
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      meter,
      fs.createWriteStream(target, { flags: 'wx' }),
      { signal },
    )
    if (hash.digest('hex') !== expectedHash) {
      throw new ExportError('HASH_MISMATCH', 'A downloaded file does not match its recorded hash')
    }
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined)
    throw error
  }
  return bytes
}

/** Download every file to `targetOf(file)`, a few at a time; the first failure aborts the rest. */
async function downloadAll(
  files: readonly OrderExportFile[],
  targetOf: (file: OrderExportFile, index: number) => Promise<string>,
  onProgress: (completed: number) => void,
  maxTotal: number,
): Promise<number> {
  const controller = new AbortController()
  const budget: DownloadBudget = { used: 0, max: maxTotal }
  let next = 0
  let completed = 0
  let bytes = 0
  let failure: unknown = null
  const worker = async () => {
    while (failure === null && next < files.length) {
      const index = next++
      const file = files[index]
      try {
        const target = await targetOf(file, index)
        // The recorded size can be off for old rows; the hash decides, the cap only bounds.
        const written = await downloadToFile(
          file.url,
          target,
          file.sha256,
          ORDER_EXPORT_MAX_FILE_BYTES,
          controller.signal,
          budget,
        )
        // Added after the await: `bytes += await ...` would read `bytes` before other workers add theirs.
        bytes += written
        onProgress(++completed)
      } catch (error) {
        if (failure === null) {
          failure = error instanceof ExportError ? new ExportError(error.code, `${file.path}: ${error.message}`) : error
          controller.abort()
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, files.length) }, worker))
  if (failure !== null) {
    if (failure instanceof ExportError) throw failure
    throw new ExportError('DOWNLOAD_FAILED', errorMessage(failure))
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** A new folder `<parent>/<name>`, or `<name> (2)` and so on when taken. Never reuses one. */
async function createUniqueFolder(parent: string, name: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(parent, n === 1 ? name : `${name} (${n})`)
    try {
      await fs.promises.mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new ExportError('WRITE_FAILED', 'No free folder name')
}

/** `root` joined with a validated relative path, checked to stay inside `root`. */
function inside(root: string, relative: string): string {
  const full = path.resolve(root, ...relative.split('/'))
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ExportError('INVALID_REQUEST', `Path leaves the export: ${relative}`)
  }
  return full
}

export async function exportToFolder(
  request: OrderExportRequest,
  parent: string,
  onProgress: (progress: OrderExportProgress) => void,
): Promise<{ path: string; bytes: number }> {
  const root = await createUniqueFolder(parent, request.name)
  try {
    const total = request.files.length
    const bytes = await downloadAll(
      request.files,
      async (file) => {
        const target = inside(root, file.path)
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        return target
      },
      (completed) => onProgress({ phase: 'downloading', completed, total }),
      ORDER_EXPORT_MAX_FOLDER_BYTES,
    )
    onProgress({ phase: 'writing', completed: 0, total: request.texts.length })
    for (const text of request.texts) {
      const target = inside(root, text.path)
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, text.content, { encoding: 'utf8', flag: 'wx' })
    }
    return { path: root, bytes }
  } catch (error) {
    // The folder is ours (just created): nothing of a failed export stays.
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * A stream of `file` that opens it on the first read. JSZip takes every entry's stream up front,
 * and an export of a couple of thousand files must not hold that many files open at once.
 */
export function lazyReadStream(file: string): Readable {
  let inner: fs.ReadStream | null = null
  const outer: Readable = new Readable({
    read() {
      if (inner) {
        inner.resume()
        return
      }
      inner = fs.createReadStream(file)
      inner.on('data', (chunk) => {
        if (!outer.push(chunk)) inner?.pause()
      })
      inner.on('end', () => outer.push(null))
      inner.on('error', (error) => outer.destroy(error))
    },
    destroy(error, callback) {
      inner?.destroy()
      callback(error)
    },
  })
  return outer
}

export async function exportToZip(
  request: OrderExportRequest,
  zipPath: string,
  onProgress: (progress: OrderExportProgress) => void,
  maxBytes = ORDER_EXPORT_MAX_ZIP_BYTES,
): Promise<{ path: string; bytes: number }> {
  const tempRoot = path.join(os.tmpdir(), TEMP_DIR)
  await fs.promises.mkdir(tempRoot, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(tempRoot, 'e-'))
  const partial = `${zipPath}.partial-${crypto.randomBytes(4).toString('hex')}`
  try {
    const total = request.files.length
    const staged: string[] = new Array(total)
    const bytes = await downloadAll(
      request.files,
      async (_file, index) => {
        staged[index] = path.join(staging, `f${index}`)
        return staged[index]
      },
      (completed) => onProgress({ phase: 'downloading', completed, total }),
      maxBytes,
    )
    // The real total (the declared sizes can be wrong): JSZip writes no ZIP64, so an archive past
    // 4 GiB would be broken. Refused before a byte of the zip is written.
    const textBytes = request.texts.reduce((sum, t) => sum + Buffer.byteLength(t.content, 'utf8'), 0)
    if (bytes + textBytes > maxBytes) {
      throw new ExportError('TOO_LARGE', 'The downloaded files are too large for one zip; save them to a folder')
    }
    onProgress({ phase: 'writing', completed: 0, total: 1 })
    const zip = new JSZip()
    request.files.forEach((file, index) => {
      zip.file(file.path, lazyReadStream(staged[index]), { binary: true })
    })
    for (const text of request.texts) zip.file(text.path, text.content)
    await pipeline(
      zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE' }),
      fs.createWriteStream(partial, { flags: 'wx' }),
    )
    // Replaces a zip the user chose to overwrite in the save dialog, in one step.
    await fs.promises.rename(partial, zipPath)
    onProgress({ phase: 'writing', completed: 1, total: 1 })
    return { path: zipPath, bytes }
  } catch (error) {
    await fs.promises.rm(partial, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  return fs.promises.access(p).then(
    () => true,
    () => false,
  )
}

/**
 * Where a zip goes, from the save dialog's answer. A path ending in `.zip` is the user's choice
 * (the dialog asked before overwriting it). A path without it gets `.zip` added, and since no
 * dialog asked about that name, an existing file is never overwritten: `name (2).zip` and so on.
 */
export async function zipTargetFor(chosen: string): Promise<string> {
  if (/\.zip$/i.test(chosen)) return chosen
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? `${chosen}.zip` : `${chosen} (${n}).zip`
    if (!(await exists(candidate))) return candidate
  }
  throw new ExportError('WRITE_FAILED', 'No free file name for the zip')
}

async function askWhere(event: IpcMainInvokeEvent, request: OrderExportRequest): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (request.mode === 'zip') {
    // The default name and the filter carry .zip, so the OS dialog asks before an overwrite.
    const options = {
      title: 'Export order',
      defaultPath: `${request.name}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return zipTargetFor(result.filePath)
  }
  const options = {
    title: 'Save order files to a folder',
    properties: ['openDirectory' as const, 'createDirectory' as const],
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export async function handleOrderExport(event: IpcMainInvokeEvent, input: unknown): Promise<OrderExportResult> {
  let request: OrderExportRequest
  try {
    request = validateExportRequest(input)
  } catch (error) {
    const code = error instanceof ExportError ? error.code : 'INVALID_REQUEST'
    logError('[Orders] Export refused', { code, error: errorMessage(error) })
    return { success: false, code, error: errorMessage(error) }
  }
  let where: string | null
  try {
    where = await askWhere(event, request)
  } catch (error) {
    const code = error instanceof ExportError ? error.code : 'WRITE_FAILED'
    logError('[Orders] Export target refused', { code, error: errorMessage(error) })
    return { success: false, code, error: errorMessage(error) }
  }
  if (!where) return { success: false, canceled: true }
  const send = (progress: OrderExportProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send(ORDER_EXPORT_PROGRESS_CHANNEL, progress)
  }
  try {
    const done =
      request.mode === 'zip' ? await exportToZip(request, where, send) : await exportToFolder(request, where, send)
    log('[Orders] Exported order', { mode: request.mode, path: done.path, files: request.files.length, bytes: done.bytes })
    return { success: true, path: done.path, files: request.files.length, bytes: done.bytes }
  } catch (error) {
    const code = error instanceof ExportError ? error.code : 'WRITE_FAILED'
    logError('[Orders] Export failed', { mode: request.mode, code, error: errorMessage(error) })
    return { success: false, code, error: errorMessage(error) }
  }
}

export function registerOrderHandlers(deps: OrderHandlerDependencies): void {
  log = deps.log
  logError = deps.logError
  ipcMain.handle(ORDER_EXPORT_CHANNEL, handleOrderExport)
}

export function unregisterOrderHandlers(): void {
  ipcMain.removeHandler(ORDER_EXPORT_CHANNEL)
}
