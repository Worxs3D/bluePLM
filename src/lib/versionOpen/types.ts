/**
 * "Open with its references" (5.13.0): shared types.
 *
 * A checked-in version opens in SOLIDWORKS from a per-version cache entry under userData that
 * holds the version and its dependency closure (`get_version_dependency_closure`) at the
 * vault-relative paths, retargeted at each other and read-only. The entry's marker records what
 * was staged, so a second open of the same version reuses it without downloading.
 */

/** One staged file, as the marker records it. */
export interface CacheMarkerFile {
  /** Path inside the entry (forward slashes), from `packageRelativePath`. */
  path: string
  fileVersionId: string
  /** The version's content hash (the storage key). */
  originalHash: string
  /** Hash on disk after retargeting; differs from `originalHash` for a retargeted file. */
  packagedHash: string | null
  /** Size and mtime on disk once read-only; a changed file is restaged. */
  size: number
  modifiedTime: string | null
}

export interface CacheMarker {
  format: 'blueplm-version-open'
  formatVersion: 1
  fileVersionId: string
  /** The root file's path inside the entry. */
  rootPath: string
  /** Every edge exact, nothing missing, no conflicts, retargeting clean. */
  exact: boolean
  /** Some edge came from the pre-107 fallback (or a hash mismatch at check-in). */
  approximate: boolean
  stagedAt: string
  files: CacheMarkerFile[]
  missing: number
  conflicts: number
  retargetFailed: number
  retargetMissing: number
}

/** Why the open could not reach the retargeting step on this machine. */
export type VersionOpenServiceReason = 'service_offline' | 'service_outdated'

export type OpenVersionResult =
  | {
      status: 'opened'
      /** The root file opened in SOLIDWORKS. */
      path: string
      /** The cache entry was already complete; nothing was downloaded. */
      reused: boolean
      /** Every reference resolved to the exact version recorded at check-in. */
      exact: boolean
      approximate: boolean
      missing: number
      conflicts: number
      /** Files the service could not retarget, and references it left pointing outside. */
      retargetFailed: number
      retargetMissing: number
    }
  /** A same-named document is open in SOLIDWORKS; it would be used instead of the staged one. */
  | { status: 'same_name_open'; documents: string[] }
  /** An assembly or drawing needs the service to retarget, and it is not usable here. */
  | { status: 'needs_service'; reason: VersionOpenServiceReason }
  /** Not a part, assembly or drawing version. */
  | { status: 'unsupported' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string; failedFiles?: string[] }

export interface VersionOpenProgress {
  phase: 'resolving' | 'checking' | 'downloading' | 'retargeting' | 'opening'
  completed: number
  total: number
}

/**
 * Whether a version's references are frozen: `frozen` when every edge of its closure is the exact
 * version recorded at check-in and nothing is missing; `approximate` when some edge came from the
 * pre-107 fallback (the closure follows today's references instead); `missing` when exact edges
 * name references the vault has no version of (outside the vault, toolbox).
 */
export type FreezeStatus = 'frozen' | 'approximate' | 'missing'
