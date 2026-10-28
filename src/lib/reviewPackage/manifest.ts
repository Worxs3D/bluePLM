/**
 * The package manifest: `manifest.json` and `manifest.csv`. Pure.
 *
 * Retargeting rewrites the packaged assemblies and drawings, so their bytes no longer match the
 * version hash; the manifest keeps the original hash next to the hash on disk.
 */

import { isRetargetable } from './layout'
import type {
  ManifestRow,
  MergedClosure,
  PackageManifest,
  RetargetStatus,
  StagedFile,
} from './types'

export const MANIFEST_JSON = 'manifest.json'
export const MANIFEST_CSV = 'manifest.csv'

/** The service's per-file result, reduced to what the manifest needs. */
export interface RetargetFileOutcome {
  status: 'retargeted' | 'unchanged' | 'failed'
  /** Old paths of references left `missing` or `ambiguous`. */
  missingReferences: string[]
  error?: string
}

/** Key for matching a service result (absolute path) to a staged file. */
export function packageKey(packagePath: string): string {
  return packagePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

/**
 * Index the service's per-file results by package-relative path. Paths outside `packageRoot`
 * are ignored (the service refuses them anyway).
 */
export function indexRetargetResults(
  packageRoot: string,
  files: ReadonlyArray<{
    filePath: string
    status: 'retargeted' | 'unchanged' | 'failed'
    references: ReadonlyArray<{ oldPath: string; status: string }>
    error?: string
  }>,
): Map<string, RetargetFileOutcome> {
  const root = packageKey(packageRoot).replace(/\/+$/, '')
  const index = new Map<string, RetargetFileOutcome>()
  for (const file of files) {
    const full = packageKey(file.filePath)
    if (!full.startsWith(`${root}/`)) continue
    index.set(full.slice(root.length + 1), {
      status: file.status,
      missingReferences: file.references
        .filter((ref) => ref.status === 'missing' || ref.status === 'ambiguous')
        .map((ref) => ref.oldPath),
      error: file.error,
    })
  }
  return index
}

export interface BuildManifestInput {
  reviewId: string | null
  title: string
  generatedAt: string
  closure: MergedClosure
  staged: ReadonlyArray<StagedFile>
  /** Null when retargeting did not run at all. */
  retarget: ReadonlyMap<string, RetargetFileOutcome> | null
  /** Hash on disk after retargeting, by package key. */
  packagedHashes?: ReadonlyMap<string, string>
}

function retargetStatusOf(
  staged: StagedFile,
  retarget: ReadonlyMap<string, RetargetFileOutcome> | null,
): RetargetStatus {
  if (!isRetargetable(staged.packagePath)) return 'not_applicable'
  if (!retarget) return 'not_run'
  return retarget.get(packageKey(staged.packagePath))?.status ?? 'not_run'
}

export function buildManifest(input: BuildManifestInput): PackageManifest {
  const rows: ManifestRow[] = input.staged.map((staged) => {
    const key = packageKey(staged.packagePath)
    const outcome = input.retarget?.get(key)
    return {
      file: staged.packagePath,
      fileName: staged.file.fileName,
      version: staged.file.version,
      revision: staged.file.revision,
      originalHash: staged.file.contentHash,
      packagedHash: input.packagedHashes?.get(key) ?? null,
      exact: staged.file.exact,
      isReviewItem: staged.file.isRoot,
      deleted: staged.file.deleted,
      stageStatus: staged.status,
      retargetStatus: retargetStatusOf(staged, input.retarget),
      missingReferences: outcome?.missingReferences ?? [],
    }
  })

  const retargetClean = rows.every(
    (row) => row.retargetStatus !== 'failed' && row.missingReferences.length === 0,
  )

  return {
    format: 'blueplm-review-package',
    formatVersion: 1,
    reviewId: input.reviewId,
    title: input.title,
    generatedAt: input.generatedAt,
    exact:
      input.closure.exact && retargetClean && rows.every((row) => row.stageStatus !== 'failed'),
    files: rows,
    missingReferences: input.closure.missing,
    versionConflicts: input.closure.conflicts,
  }
}

export function manifestToJson(manifest: PackageManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const text = String(value)
  // Leading = + - @ would run as a formula when the CSV is opened in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const MANIFEST_CSV_COLUMNS = [
  'file',
  'version',
  'revision',
  'original_hash',
  'packaged_hash',
  'exact',
  'review_item',
  'deleted',
  'stage_status',
  'retarget_status',
  'missing_references',
] as const

/**
 * One row per packaged file, then one `missing` row per reference that could not be packaged
 * (file column = the referenced path, `missing_references` = the parent that references it).
 */
export function manifestToCsv(manifest: PackageManifest): string {
  const lines: string[] = [MANIFEST_CSV_COLUMNS.join(',')]
  for (const row of manifest.files) {
    lines.push(
      [
        row.file,
        row.version,
        row.revision,
        row.originalHash,
        row.packagedHash,
        row.exact,
        row.isReviewItem,
        row.deleted,
        row.stageStatus,
        row.retargetStatus,
        row.missingReferences.join('; '),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  for (const missing of manifest.missingReferences) {
    lines.push(
      [
        missing.referencePath,
        null,
        null,
        null,
        null,
        false,
        false,
        false,
        'missing',
        null,
        missing.parentPath,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

/**
 * Packaged hashes recorded by an earlier run, so a resumed download can skip a file that was
 * already downloaded and retargeted (its bytes no longer match the version hash).
 */
export function previousPackagedHashes(manifestJson: string | null): Map<string, string> {
  const result = new Map<string, string>()
  if (!manifestJson) return result
  try {
    const parsed: unknown = JSON.parse(manifestJson)
    if (!parsed || typeof parsed !== 'object' || !('files' in parsed)) return result
    const files = (parsed as { files: unknown }).files
    if (!Array.isArray(files)) return result
    for (const entry of files) {
      if (!entry || typeof entry !== 'object') continue
      const { file, packagedHash, originalHash } = entry as Record<string, unknown>
      if (typeof file !== 'string' || typeof packagedHash !== 'string') continue
      if (typeof originalHash !== 'string') continue
      // Keyed by path and original hash: a different version at the same path must not match.
      result.set(`${packageKey(file)}|${originalHash}`, packagedHash)
    }
  } catch {
    // An unreadable manifest only means nothing can be skipped.
  }
  return result
}
