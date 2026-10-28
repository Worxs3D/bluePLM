/**
 * Review packages: scratch folders the renderer cannot make on its own.
 *
 * - A staging folder per PDF render, under the OS temp folder, removed after the render. Only
 *   folders this module created can be removed (name prefix under `os.tmpdir()`), so the remove
 *   channel cannot be pointed at anything else.
 * - Reading a render out of a staging folder, and writing a package's manifest wherever the
 *   user put the package (the general fs channels are confined to the vault).
 * - The review PDF cache under userData, bounded in size: the oldest files go first once it
 *   passes the limit.
 */
import { app, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

const STAGING_PREFIX = 'blueplm-review-'
const PDF_CACHE_DIR = 'review-pdf-cache'
const PDF_CACHE_MAX_BYTES = 512 * 1024 * 1024
const MANIFEST_NAMES = new Set(['manifest.json', 'manifest.csv'])

let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error

export interface ReviewPackageHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Whether `dir` is a staging folder this module made: directly under tmpdir, with our prefix. */
export function isStagingDir(dir: string, tmpRoot: string = os.tmpdir()): boolean {
  const resolved = path.resolve(dir)
  return (
    path.dirname(resolved).toLowerCase() === path.resolve(tmpRoot).toLowerCase() &&
    path.basename(resolved).startsWith(STAGING_PREFIX)
  )
}

/** Whether `filePath` lies inside a staging folder this module made. */
export function isInsideStagingDir(filePath: string, tmpRoot: string = os.tmpdir()): boolean {
  const tmp = path.resolve(tmpRoot)
  const relative = path.relative(tmp, path.resolve(filePath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  const first = relative.split(path.sep)[0]
  return first.startsWith(STAGING_PREFIX) && relative.length > first.length
}

/** Clear read-only bits below `dir` so a recursive remove does not fail with EPERM on Windows. */
async function makeWritable(dir: string): Promise<void> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await makeWritable(full)
    else await fs.promises.chmod(full, 0o666).catch(() => undefined)
  }
}

async function pruneCache(dir: string, maxBytes: number): Promise<number> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const files: Array<{ full: string; size: number; mtime: number }> = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = path.join(dir, entry.name)
    const stat = await fs.promises.stat(full).catch(() => null)
    if (stat) files.push({ full, size: stat.size, mtime: stat.mtimeMs })
  }
  let total = files.reduce((sum, f) => sum + f.size, 0)
  let removed = 0
  files.sort((a, b) => a.mtime - b.mtime)
  for (const file of files) {
    if (total <= maxBytes) break
    await fs.promises.rm(file.full, { force: true }).catch(() => undefined)
    total -= file.size
    removed++
  }
  return removed
}

export function registerReviewPackageHandlers(deps: ReviewPackageHandlerDependencies): void {
  log = deps.log
  logError = deps.logError

  ipcMain.handle('review-package:create-staging-dir', async () => {
    try {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), STAGING_PREFIX))
      return { success: true, path: dir }
    } catch (err) {
      logError('[ReviewPackage] Failed to create a staging folder', { error: errorMessage(err) })
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('review-package:remove-staging-dir', async (_, dir: string) => {
    if (typeof dir !== 'string' || !isStagingDir(dir)) {
      return { success: false, error: 'Not a review staging folder' }
    }
    try {
      if (fs.existsSync(dir)) {
        await makeWritable(dir)
        await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3 })
      }
      return { success: true }
    } catch (err) {
      logError('[ReviewPackage] Failed to remove a staging folder', {
        dir,
        error: errorMessage(err),
      })
      return { success: false, error: errorMessage(err) }
    }
  })

  // fs:read-file only reads inside the vault; a render lives in a staging folder.
  ipcMain.handle('review-package:read-staged-file', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !isInsideStagingDir(filePath)) {
      return { success: false, error: 'Not inside a review staging folder' }
    }
    try {
      const data = await fs.promises.readFile(filePath)
      return { success: true, data: data.toString('base64'), size: data.length }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  })

  // fs:write-file only writes inside the vault; a package goes wherever the user chose. Only
  // the manifest names can be written, into a folder that already exists.
  ipcMain.handle(
    'review-package:write-manifest',
    async (_, dir: string, files: Array<{ name: string; content: string }>) => {
      try {
        if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir)) {
          return { success: false, error: 'Package folder not found' }
        }
        if (!Array.isArray(files)) return { success: false, error: 'No files' }
        for (const file of files) {
          if (!MANIFEST_NAMES.has(file?.name) || typeof file.content !== 'string') {
            return { success: false, error: `Not a manifest file: ${String(file?.name)}` }
          }
        }
        for (const file of files) {
          const target = path.join(dir, file.name)
          if (fs.existsSync(target)) await fs.promises.chmod(target, 0o666).catch(() => undefined)
          await fs.promises.writeFile(target, file.content, 'utf8')
        }
        return { success: true }
      } catch (err) {
        logError('[ReviewPackage] Failed to write the manifest', { dir, error: errorMessage(err) })
        return { success: false, error: errorMessage(err) }
      }
    },
  )

  // The review viewer reads a cached PDF by path; fs:read-file is vault-only. Only a `.pdf`
  // directly inside the cache folder can be read.
  ipcMain.handle('review-package:read-cached-pdf', async (_, filePath: string) => {
    const dir = path.join(app.getPath('userData'), PDF_CACHE_DIR)
    if (
      typeof filePath !== 'string' ||
      path.dirname(path.resolve(filePath)).toLowerCase() !== path.resolve(dir).toLowerCase() ||
      path.extname(filePath).toLowerCase() !== '.pdf'
    ) {
      return { success: false, error: 'Not a cached review PDF' }
    }
    try {
      const data = await fs.promises.readFile(filePath)
      return { success: true, data: data.toString('base64'), size: data.length }
    } catch (err) {
      return { success: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('review-package:get-pdf-cache-dir', async () => {
    try {
      const dir = path.join(app.getPath('userData'), PDF_CACHE_DIR)
      await fs.promises.mkdir(dir, { recursive: true })
      const removed = await pruneCache(dir, PDF_CACHE_MAX_BYTES)
      if (removed > 0) log('[ReviewPackage] Pruned the review PDF cache', { removed })
      return { success: true, path: dir }
    } catch (err) {
      logError('[ReviewPackage] Review PDF cache unavailable', { error: errorMessage(err) })
      return { success: false, error: errorMessage(err) }
    }
  })
}

export function unregisterReviewPackageHandlers(): void {
  ipcMain.removeHandler('review-package:create-staging-dir')
  ipcMain.removeHandler('review-package:remove-staging-dir')
  ipcMain.removeHandler('review-package:get-pdf-cache-dir')
  ipcMain.removeHandler('review-package:read-staged-file')
  ipcMain.removeHandler('review-package:read-cached-pdf')
  ipcMain.removeHandler('review-package:write-manifest')
}
