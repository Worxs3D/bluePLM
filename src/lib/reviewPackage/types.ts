/**
 * Review package pipeline: shared types.
 *
 * A review package is every review item at its pinned version plus each item's dependency
 * closure (`get_version_dependency_closure`), merged and deduplicated, laid out under a folder
 * at the files' vault-relative paths. The same staging serves two callers: the reviewer's
 * "Download package" and the PDF generator, which stages one drawing version in a temp folder.
 */

import type { ReferenceType } from '@/types/reviews'

/** One file version that goes into a package. */
export interface PackageFile {
  fileVersionId: string
  fileId: string | null
  /** Vault-relative path as the server records it (forward slashes). */
  filePath: string
  fileName: string
  version: number | null
  revision: string | null
  /** SHA-256 of the version's content; the storage key. */
  contentHash: string
  fileSize: number
  /** False when any edge that reached this version was approximate. */
  exact: boolean
  /** A review item itself (depth 0), not only a dependency. */
  isRoot: boolean
  /** The file was deleted in the vault since; its version content is still stored. */
  deleted: boolean
}

/** A reference that cannot be packaged: out of the vault, toolbox, or no version resolved. */
export interface MissingReference {
  /** Path as the parent referenced it. */
  referencePath: string
  /** The parent version's file path, when known. */
  parentPath: string | null
  parentVersionId: string | null
  referenceType: ReferenceType | null
}

/** Two different versions of one vault path reached through different items. Only one fits. */
export interface VersionConflict {
  filePath: string
  keptFileVersionId: string
  keptVersion: number | null
  droppedFileVersionId: string
  droppedVersion: number | null
}

export interface MergedClosure {
  files: PackageFile[]
  missing: MissingReference[]
  conflicts: VersionConflict[]
  /** Every file exact, nothing missing, no conflicts. */
  exact: boolean
  totalBytes: number
}

/** What happened to one file when it was staged. */
export type StageFileStatus = 'downloaded' | 'copied' | 'skipped' | 'failed'

export interface StagedFile {
  file: PackageFile
  /** Absolute path on disk. */
  localPath: string
  /** Path inside the package folder (forward slashes). */
  packagePath: string
  status: StageFileStatus
  error?: string
}

export interface StageProgress {
  phase: 'resolving' | 'downloading' | 'retargeting' | 'finishing'
  completed: number
  total: number
  /** The file being worked on, when there is one. */
  fileName?: string
}

export type StageProgressCallback = (progress: StageProgress) => void

export interface StageResult {
  root: string
  closure: MergedClosure
  staged: StagedFile[]
  failed: StagedFile[]
}

/** Retarget outcome for one packaged file, as written to the manifest. */
export type RetargetStatus =
  | 'retargeted'
  | 'unchanged'
  | 'failed'
  /** Not a file the service rewrites (parts, PDFs, ...). */
  | 'not_applicable'
  /** The service is not available or too old; references still point at the vault. */
  | 'not_run'

export interface ManifestRow {
  file: string
  fileName: string
  version: number | null
  revision: string | null
  originalHash: string
  /** Hash on disk after retargeting, when known; differs from the original once retargeted. */
  packagedHash: string | null
  exact: boolean
  isReviewItem: boolean
  deleted: boolean
  stageStatus: StageFileStatus
  retargetStatus: RetargetStatus
  /** References of this file that point outside the package after retargeting. */
  missingReferences: string[]
}

export interface PackageManifest {
  format: 'blueplm-review-package'
  formatVersion: 1
  reviewId: string | null
  title: string
  generatedAt: string
  exact: boolean
  files: ManifestRow[]
  /** References that are not in the vault or could not be resolved to a version. */
  missingReferences: MissingReference[]
  versionConflicts: VersionConflict[]
}

// ---------------------------------------------------------------------------
// PDF generation and preview
// ---------------------------------------------------------------------------

/** Why a PDF could not be generated on this machine. */
export type PdfUnavailableReason =
  /** The BluePLM SOLIDWORKS service is not running. */
  | 'service_offline'
  /** The service is older than the retargetReferences release. */
  | 'service_outdated'
  /** Only Document Manager is present; exportPdf needs full SOLIDWORKS. */
  | 'solidworks_not_installed'

export type EnsureDrawingPdfResult =
  | {
      status: 'cached' | 'generated'
      storageHash: string
      fileSize: number
      closureExact: boolean | null
    }
  | { status: 'needs_solidworks'; reason: PdfUnavailableReason }
  | { status: 'not_a_drawing' }
  | { status: 'failed'; error: string; errorCode?: string }

export interface PdfProgress {
  phase: 'checking' | 'staging' | 'retargeting' | 'exporting' | 'uploading' | 'recording'
  /** Staging progress while `phase === 'staging'`. */
  completed?: number
  total?: number
}

export type PdfProgressCallback = (progress: PdfProgress) => void

/**
 * What the review viewer can show for an item.
 * - `pdf`: a local PDF file (the item's own `.pdf` version, or the stored render of a drawing).
 * - `pdf_pending`: a drawing without a stored PDF yet; someone with SOLIDWORKS must generate it.
 * - `unsupported`: neither a PDF nor a drawing.
 */
export type ReviewItemPreview =
  { kind: 'pdf'; localPath: string } | { kind: 'pdf_pending' } | { kind: 'unsupported' }
