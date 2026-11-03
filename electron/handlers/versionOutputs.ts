/**
 * Version outputs (5.5.0): open a stored output (drawing PDF, STEP, IGES, STL, DXF) in the
 * default app.
 *
 * An output lives in the vault bucket, not the vault folder, and the general fs channels write
 * only inside the vault. Opening downloads it from a signed URL into a folder of our own under the
 * OS temp folder (one subfolder per open, so a file still open in another app is never
 * overwritten), checks its SHA-256 against the recorded hash, then hands it to the shell. The
 * folder is pruned on every open: entries older than a week go, and at most `MAX_ENTRIES` are kept.
 */
import { ipcMain, shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeReadableStream } from 'stream/web'

const OPEN_DIR = 'blueplm-version-outputs'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 50
/** STEP of a large assembly can be big; refuses anything absurd. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const HASH = /^[0-9a-f]{64}$/
const ALLOWED_EXTENSIONS = new Set(['pdf', 'step', 'stp', 'igs', 'iges', 'stl', 'dxf'])

let log: (message: string, data?: unknown) => void = () => undefined
let logError: (message: string, data?: unknown) => void = () => undefined

export interface VersionOutputHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A bare output file name: no folders, no characters Windows refuses, never empty, and only an
 * output extension (so the shell never runs an executable). Null when the extension is not one.
 */
export function safeOutputName(name: unknown): string | null {
  const raw = typeof name === 'string' ? path.basename(name.replace(/\\/g, '/')) : ''
  const cleaned = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  const dot = cleaned.lastIndexOf('.')
  if (dot < 0) return null
  const ext = cleaned.slice(dot + 1).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) return null
  const base = cleaned.slice(0, dot).slice(0, 120) || 'output'
  return `${base}.${ext}`
}

async function pruneOpenDir(root: string): Promise<void> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs: Array<{ full: string; mtime: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    const stat = await fs.promises.stat(full).catch(() => null)
    if (stat) dirs.push({ full, mtime: stat.mtimeMs })
  }
  dirs.sort((a, b) => b.mtime - a.mtime)
  const now = Date.now()
  for (let i = 0; i < dirs.length; i++) {
    if (i < MAX_ENTRIES && now - dirs[i].mtime < MAX_AGE_MS) continue
    // A file still open in another app is locked on Windows; it goes on a later prune.
    await fs.promises.rm(dirs[i].full, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Download `url` to `target`, hashing as it streams. Rejects on a network or write error, an
 * oversized body or a wrong hash, and then removes the partial file.
 */
export async function downloadVerified(url: string, target: string, expectedHash: string): Promise<number> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)
  const hash = crypto.createHash('sha256')
  let bytes = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > MAX_BYTES) {
        callback(new Error('The output is too large to open'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    // pipeline wires every stream's 'error' (including the file's) and destroys the rest.
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      meter,
      fs.createWriteStream(target),
    )
    if (hash.digest('hex') !== expectedHash) {
      throw new Error('The downloaded output does not match its recorded hash')
    }
  } catch (err) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined)
    throw err
  }
  return bytes
}

export function registerVersionOutputHandlers(deps: VersionOutputHandlerDependencies): void {
  log = deps.log
  logError = deps.logError

  ipcMain.handle(
    'version-outputs:open',
    async (_, url: unknown, fileName: unknown, expectedHash: unknown) => {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return { success: false, error: 'Invalid download URL' }
      }
      const hash = typeof expectedHash === 'string' ? expectedHash.toLowerCase() : ''
      if (!HASH.test(hash)) return { success: false, error: 'Invalid content hash' }
      const name = safeOutputName(fileName)
      if (!name) return { success: false, error: 'Not an output file name' }
      let dir: string | null = null
      try {
        const root = path.join(os.tmpdir(), OPEN_DIR)
        await fs.promises.mkdir(root, { recursive: true })
        await pruneOpenDir(root)
        dir = await fs.promises.mkdtemp(path.join(root, 'o-'))
        const target = path.join(dir, name)
        let bytes: number
        try {
          bytes = await downloadVerified(url, target, hash)
        } catch (err) {
          // Nothing was opened: the folder of this open goes with the partial file.
          await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
          throw err
        }
        const openError = await shell.openPath(target)
        if (openError) {
          logError('[VersionOutputs] Could not open the output', { target, error: openError })
          return { success: false, path: target, error: openError }
        }
        log('[VersionOutputs] Opened output', { target, bytes })
        return { success: true, path: target }
      } catch (err) {
        logError('[VersionOutputs] Failed to open an output', { error: errorMessage(err) })
        return { success: false, error: errorMessage(err) }
      }
    },
  )
}

export function unregisterVersionOutputHandlers(): void {
  ipcMain.removeHandler('version-outputs:open')
}
