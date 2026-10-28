/**
 * Safe extraction of extension packages (.bpx, a zip).
 *
 * Every entry name is checked before anything is written: no absolute paths, no
 * drive letters, no `..` segment, nothing that resolves outside the destination,
 * and no symlink entries. JSZip already rewrites some unsafe names and keeps the
 * original in `unsafeOriginalName`; an entry that has one is refused rather than
 * trusted in its rewritten form.
 *
 * The package is extracted into a staging folder next to the destination and
 * renamed into place only once every file is written. A failed install therefore
 * leaves the previous version exactly as it was.
 *
 * Shared by the store and sideload installs and by the native runtime.
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type JSZip from 'jszip'

/** Default cap on the number of entries in a package. */
export const DEFAULT_MAX_ENTRIES = 5000

/** Default cap on the total uncompressed size of a package (256 MB). */
export const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

export interface SafeExtractOptions {
  maxEntries?: number
  maxTotalBytes?: number
  /**
   * Runs on the staging folder after every file is written and before it replaces
   * the destination (for example, to write install metadata). Throwing aborts the
   * install and leaves the destination untouched.
   */
  beforeCommit?: (stagingDir: string) => void | Promise<void>
}

export interface SafeExtractResult {
  files: number
  bytes: number
}

/** Thrown for any package entry that is refused. */
export class UnsafePackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafePackageError'
  }
}

/**
 * Resolve a zip entry name to a path inside `root`, or throw.
 * Backslashes count as separators on every platform, so a Windows-made `..\x`
 * is caught on Linux as well.
 */
export function resolveEntryPath(root: string, entryName: string): string {
  if (typeof entryName !== 'string' || entryName.length === 0) {
    throw new UnsafePackageError('Package entry has an empty name')
  }
  if (entryName.includes('\0')) {
    throw new UnsafePackageError(`Package entry name contains a NUL byte: ${JSON.stringify(entryName)}`)
  }
  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || path.isAbsolute(entryName)) {
    throw new UnsafePackageError(`Package entry has an absolute path: ${entryName}`)
  }
  const segments = normalized.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) {
    throw new UnsafePackageError(`Package entry has no file name: ${entryName}`)
  }
  for (const segment of segments) {
    if (segment === '..') {
      throw new UnsafePackageError(`Package entry escapes the package folder: ${entryName}`)
    }
    // ':' would name an NTFS alternate data stream or a drive on Windows.
    if (segment.includes(':')) {
      throw new UnsafePackageError(`Package entry name contains ':': ${entryName}`)
    }
  }

  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, ...segments)
  const relative = path.relative(resolvedRoot, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new UnsafePackageError(`Package entry escapes the package folder: ${entryName}`)
  }
  return resolved
}

/** True when the entry is stored as a symbolic link (Unix mode bits). */
export function isSymlinkEntry(entry: JSZip.JSZipObject): boolean {
  const mode = entry.unixPermissions
  const numeric = typeof mode === 'number' ? mode : typeof mode === 'string' ? parseInt(mode, 8) : NaN
  return Number.isFinite(numeric) && (numeric & S_IFMT) === S_IFLNK
}

/**
 * Check every entry of a loaded package without writing anything.
 * Returns the entries in a stable order.
 */
export function validatePackageEntries(
  zip: JSZip,
  options: Pick<SafeExtractOptions, 'maxEntries'> = {},
): JSZip.JSZipObject[] {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const entries = Object.values(zip.files)
  if (entries.length > maxEntries) {
    throw new UnsafePackageError(`Package has ${entries.length} entries; the limit is ${maxEntries}`)
  }
  // A probe root: only the shape of the result matters here.
  const probeRoot = path.resolve('/__bpx_probe__')
  for (const entry of entries) {
    // JSZip records the name as stored in the archive on every file entry it loads;
    // `name` is its resolved form. Check the stored name, and refuse any entry
    // JSZip had to rewrite rather than trusting the rewrite.
    const original = entry.unsafeOriginalName ?? entry.name
    resolveEntryPath(probeRoot, original)
    if (original !== entry.name) {
      throw new UnsafePackageError(`Package entry has an unsafe path: ${original}`)
    }
    if (isSymlinkEntry(entry)) {
      throw new UnsafePackageError(`Package contains a symbolic link: ${entry.name}`)
    }
    resolveEntryPath(probeRoot, entry.name)
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

function removeQuietly(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch {
    // Best effort: a leftover staging folder is harmless and is named so it is never
    // mistaken for an installed extension.
  }
}

/**
 * Extract a loaded package into `destDir`, replacing what is there only on success.
 */
export async function extractPackageSafely(
  zip: JSZip,
  destDir: string,
  options: SafeExtractOptions = {},
): Promise<SafeExtractResult> {
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  const entries = validatePackageEntries(zip, options)

  const dest = path.resolve(destDir)
  const parent = path.dirname(dest)
  const base = path.basename(dest)
  fs.mkdirSync(parent, { recursive: true })

  const staging = path.join(parent, `.${base}.staging-${randomUUID()}`)
  let files = 0
  let bytes = 0

  try {
    fs.mkdirSync(staging)
    for (const entry of entries) {
      const target = resolveEntryPath(staging, entry.name)
      if (entry.dir) {
        fs.mkdirSync(target, { recursive: true })
        continue
      }
      const content = await entry.async('nodebuffer')
      bytes += content.length
      if (bytes > maxTotalBytes) {
        throw new UnsafePackageError(
          `Package is larger than ${Math.round(maxTotalBytes / (1024 * 1024))} MB uncompressed`,
        )
      }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      // 'wx' refuses to follow or overwrite anything already at the path.
      fs.writeFileSync(target, content, { flag: 'wx' })
      files++
    }

    if (options.beforeCommit) {
      await options.beforeCommit(staging)
    }
  } catch (error) {
    removeQuietly(staging)
    throw error
  }

  // Commit: move the old version aside, move the new one in, then drop the old one.
  let backup: string | null = null
  try {
    if (fs.existsSync(dest)) {
      backup = path.join(parent, `.${base}.previous-${randomUUID()}`)
      fs.renameSync(dest, backup)
    }
    fs.renameSync(staging, dest)
  } catch (error) {
    if (backup && !fs.existsSync(dest)) {
      try {
        fs.renameSync(backup, dest)
        backup = null
      } catch {
        // Leave the backup in place; it is still the complete previous version.
      }
    }
    removeQuietly(staging)
    throw error
  }
  if (backup) removeQuietly(backup)

  return { files, bytes }
}
