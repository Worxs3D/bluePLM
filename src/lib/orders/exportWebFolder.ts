/**
 * "Save files to folder" on BluePLM Web (5.13.0), through the File System Access API
 * (`showDirectoryPicker`) where the browser has it (Chromium); elsewhere the button is hidden
 * (`webFolderExportSupported`).
 *
 * The user picks a folder; the export goes into a new subfolder named after the order
 * (`ORD-0001`, or `ORD-0001 (2)` when taken, never into an existing one). Each content is fetched
 * once, checked against its recorded SHA-256 exactly as the web zip checks it, and only then
 * written to every path that names it, so memory holds a few files at a time, not the export. Any
 * failure (a hash mismatch, a download or write error) removes the new subfolder: no partial
 * export is left.
 *
 * The picker needs the click's user activation, so `exportOrder` calls `pickWebExportFolder`
 * before anything else it awaits.
 */

import { WEB_DOWNLOAD_MAX_BYTES, WEB_DOWNLOAD_MAX_FILES } from '@/lib/webDownload'
import type { ExportOrderResult, OrderExportErrorCode, OrderExportProgress } from '@/types/orders'

import type { OrderExportPlan } from './exportPlan'

/** Contents fetched and written at once. */
const WEB_FOLDER_CONCURRENCY = 4
const MAX_FOLDER_ATTEMPTS = 1000

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite'
  id?: string
}

type DirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>

function picker(): DirectoryPicker | null {
  if (typeof window === 'undefined') return null
  const fn = (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker
  return typeof fn === 'function' ? (fn as DirectoryPicker).bind(window) : null
}

/** Whether this browser can save an export into a folder (the button shows only then). */
export function webFolderExportSupported(): boolean {
  return picker() !== null
}

export class WebFolderExportError extends Error {
  constructor(
    readonly code: OrderExportErrorCode,
    message: string,
    readonly files?: string[],
  ) {
    super(message)
    this.name = 'WebFolderExportError'
  }
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Ask for the folder. Null when the user cancels. Throws `DESKTOP_ONLY` where there is no picker. */
export async function pickWebExportFolder(): Promise<FileSystemDirectoryHandle | null> {
  const pick = picker()
  if (!pick) throw new WebFolderExportError('DESKTOP_ONLY', 'This browser cannot save to a folder')
  try {
    return await pick({ mode: 'readwrite', id: 'blueplm-order-export' })
  } catch (error) {
    if (errorName(error) === 'AbortError') return null
    throw new WebFolderExportError('WRITE_FAILED', errorMessage(error))
  }
}

/** A new subfolder `<name>`, or `<name> (2)` and so on when taken. Never reuses one. */
async function createUniqueFolder(parent: FileSystemDirectoryHandle, name: string): Promise<{ name: string; handle: FileSystemDirectoryHandle }> {
  for (let n = 1; n <= MAX_FOLDER_ATTEMPTS; n++) {
    const candidate = n === 1 ? name : `${name} (${n})`
    try {
      await parent.getDirectoryHandle(candidate)
      continue
    } catch (error) {
      // TypeMismatchError: a file of that name; NotFoundError: free.
      if (errorName(error) === 'TypeMismatchError') continue
      if (errorName(error) !== 'NotFoundError') throw error
    }
    return { name: candidate, handle: await parent.getDirectoryHandle(candidate, { create: true }) }
  }
  throw new WebFolderExportError('WRITE_FAILED', 'No free folder name')
}

/** Write `data` at the plan's relative path (`/`-separated, already safe) under `root`. */
async function writeAt(root: FileSystemDirectoryHandle, relativePath: string, data: Blob | string): Promise<void> {
  const segments = relativePath.split('/')
  const fileName = segments.pop()!
  let dir = root
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true })
  const handle = await dir.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

export interface WebFolderExportDeps {
  /** The content of `hash`, already checked against it (throws `HASH_MISMATCH` otherwise). */
  fetchVerified: (hash: string, name: string) => Promise<Blob>
}

/**
 * Write the plan into a new subfolder of `parent`. Returns `saved` with the folder's path as the
 * browser names it (`<picked>/<subfolder>`). Throws `WebFolderExportError` (or the fetch's error)
 * after removing the subfolder.
 */
export async function exportToWebFolder(
  parent: FileSystemDirectoryHandle,
  plan: OrderExportPlan,
  deps: WebFolderExportDeps,
  onProgress?: (progress: OrderExportProgress) => void,
): Promise<ExportOrderResult> {
  if (plan.entries.length > WEB_DOWNLOAD_MAX_FILES) {
    throw new WebFolderExportError('TOO_MANY_FILES', `More than ${WEB_DOWNLOAD_MAX_FILES} files`)
  }
  // Each content is held whole while it is hashed.
  const tooBig = plan.entries.filter((e) => e.fileSize > WEB_DOWNLOAD_MAX_BYTES).map((e) => e.zipPath)
  if (tooBig.length > 0) {
    throw new WebFolderExportError('TOO_LARGE', `Too large for the browser: ${tooBig.join(', ')}`, tooBig)
  }
  const folder = await createUniqueFolder(parent, plan.baseName)
  try {
    const groups = new Map<string, string[]>()
    for (const entry of plan.entries) {
      const paths = groups.get(entry.storageHash)
      if (paths) paths.push(entry.zipPath)
      else groups.set(entry.storageHash, [entry.zipPath])
    }
    const total = plan.entries.length
    let completed = 0
    onProgress?.({ phase: 'downloading', completed, total })
    const work = [...groups.entries()]
    let next = 0
    let failure: unknown = null
    // The first failure stops every worker before it takes another content.
    const worker = async () => {
      while (failure === null && next < work.length) {
        const [hash, paths] = work[next++]
        try {
          const blob = await deps.fetchVerified(hash, paths[0])
          for (const p of paths) {
            if (failure !== null) return
            try {
              await writeAt(folder.handle, p, blob)
            } catch (error) {
              throw new WebFolderExportError('WRITE_FAILED', `${p}: ${errorMessage(error)}`, [p])
            }
            onProgress?.({ phase: 'downloading', completed: ++completed, total })
          }
        } catch (error) {
          if (failure === null) failure = error
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(WEB_FOLDER_CONCURRENCY, work.length) }, worker))
    if (failure !== null) throw failure
    onProgress?.({ phase: 'writing', completed: 0, total: 2 })
    await writeAt(folder.handle, plan.csv.name, plan.csv.content)
    await writeAt(folder.handle, plan.json.name, plan.json.content)
    onProgress?.({ phase: 'writing', completed: 2, total: 2 })
    return { status: 'saved', path: `${parent.name}/${folder.name}`, files: plan.entries.length, missing: plan.missing.length }
  } catch (error) {
    // The subfolder is ours (just created): nothing of a failed export stays.
    await parent.removeEntry(folder.name, { recursive: true }).catch(() => undefined)
    throw error
  }
}
