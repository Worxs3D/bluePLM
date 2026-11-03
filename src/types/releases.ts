/**
 * Released file versions (schema 509). A version is released when its file enters a workflow
 * state that releases (`workflow_state.releases_version`), and stays released while the file
 * moves on: later versions are work in progress. Releasing freezes the version's exports (PDF,
 * STEP, IGES, STL, DXF) and inspection reports: none can be replaced, overwritten or deleted. A
 * drawing is released through an approved review of that version; without one the release can be
 * forced, and is recorded as forced. Plan: `.cursor/plans/release-versions-5.9.plan.md`.
 */

/** The release of one file version (columns of `file_version`). */
export interface VersionRelease {
  fileId: string
  fileVersionId: string
  version: number
  revision: string | null
  releasedAt: string
  releasedBy: string | null
  /** Released without an approved review of this version (drawings only). */
  forced: boolean
  /** The approved review that released it, when there was one. */
  reviewId: string | null
  /** The reason given for a forced release, or the transition comment. */
  note: string | null
}

/** Why the release gate refused a transition (`TransitionResult.error_code`). */
export const RELEASE_NOT_REVIEWED = 'RELEASE_NOT_REVIEWED'

/** The hint an output or report write is refused with when its version is released. */
export const VERSION_RELEASED = 'RELEASED'
