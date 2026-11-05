/**
 * The cache entry's marker: written last when an entry is staged, read on the next open to decide
 * whether the entry can be reused as it is. Pure.
 *
 * An entry is reused only when the marker names the same version, lists exactly the files of the
 * closure fetched now (same versions, same content, same paths: an approximate closure follows
 * today's references, so it can change), and every file is still on disk with the size and mtime
 * recorded once it was made read-only. Anything else restages; files that still match are kept.
 */

import { packageRelativePath } from '@/lib/reviewPackage/layout'
import { packageKey } from '@/lib/reviewPackage/manifest'
import type { MergedClosure } from '@/lib/reviewPackage/types'

import type { CacheMarker, CacheMarkerFile } from './types'

export const MARKER_FORMAT = 'blueplm-version-open'

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function parseFile(v: unknown): CacheMarkerFile | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!isString(r.path) || !isString(r.fileVersionId) || !isString(r.originalHash)) return null
  if (typeof r.size !== 'number' || !Number.isFinite(r.size)) return null
  return {
    path: r.path,
    fileVersionId: r.fileVersionId,
    originalHash: r.originalHash,
    packagedHash: isString(r.packagedHash) ? r.packagedHash : null,
    size: r.size,
    modifiedTime: isString(r.modifiedTime) ? r.modifiedTime : null,
  }
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** The marker in `json`, or null when it is missing, unreadable or of another format. */
export function parseMarker(json: string | null | undefined): CacheMarker | null {
  if (!json) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Record<string, unknown>
  if (r.format !== MARKER_FORMAT || r.formatVersion !== 1) return null
  if (!isString(r.fileVersionId) || !isString(r.rootPath) || !Array.isArray(r.files)) return null
  const files: CacheMarkerFile[] = []
  for (const f of r.files) {
    const file = parseFile(f)
    if (!file) return null
    files.push(file)
  }
  return {
    format: MARKER_FORMAT,
    formatVersion: 1,
    fileVersionId: r.fileVersionId,
    rootPath: r.rootPath,
    exact: r.exact === true,
    approximate: r.approximate === true,
    stagedAt: isString(r.stagedAt) ? r.stagedAt : '',
    files,
    missing: count(r.missing),
    conflicts: count(r.conflicts),
    retargetFailed: count(r.retargetFailed),
    retargetMissing: count(r.retargetMissing),
  }
}

const fileKey = (path: string, fileVersionId: string, hash: string) =>
  `${packageKey(path)}|${fileVersionId}|${hash}`

/** Whether `marker` was staged from exactly this closure of `fileVersionId`. */
export function markerMatchesClosure(
  marker: CacheMarker | null,
  fileVersionId: string,
  closure: MergedClosure,
): boolean {
  if (!marker || marker.fileVersionId !== fileVersionId) return false
  if (marker.files.length !== closure.files.length) return false
  const staged = new Set(marker.files.map((f) => fileKey(f.path, f.fileVersionId, f.originalHash)))
  return closure.files.every((f) =>
    staged.has(fileKey(packageRelativePath(f.filePath), f.fileVersionId, f.contentHash)),
  )
}

/**
 * `path|originalHash` -> hash on disk after an earlier staging's retargeting, so `stageFiles`
 * skips a retargeted file that is still as it was left instead of downloading it again.
 */
export function previousHashesFromMarker(marker: CacheMarker | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of marker?.files ?? []) {
    if (f.packagedHash) out.set(`${packageKey(f.path)}|${f.originalHash}`, f.packagedHash)
  }
  return out
}

/** Whether a file on disk still is what the marker recorded. */
export function fileUnchanged(
  recorded: Pick<CacheMarkerFile, 'size' | 'modifiedTime'>,
  onDisk: { success: boolean; size?: number; modifiedTime?: string; isDirectory?: boolean },
): boolean {
  return (
    onDisk.success &&
    !onDisk.isDirectory &&
    recorded.modifiedTime !== null &&
    onDisk.size === recorded.size &&
    onDisk.modifiedTime === recorded.modifiedTime
  )
}

export function markerToJson(marker: CacheMarker): string {
  return JSON.stringify(marker, null, 2)
}
