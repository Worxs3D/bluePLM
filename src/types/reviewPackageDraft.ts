/**
 * The review package a requester is building, before it is submitted with `requestReview`.
 *
 * Held in the `reviews` store slice and persisted locally, keyed by user id, so a half-built
 * package survives a restart and is never shown to another account on the same machine. Every
 * item names a `file_versions` row the server reported: the draft never holds the local working
 * copy's version.
 */

import type { ReviewMode, ReviewPriority } from './reviews'

export interface ReviewPackageDraftItem {
  fileId: string
  /** `file_versions.id` that will be reviewed. */
  fileVersionId: string
  version: number
  revision: string | null
  state: string | null
  fileName: string
  /** Vault-relative path. */
  filePath: string
  extension: string | null
  vaultId: string | null
  /** The file's latest checked-in version when the item was added (to flag an older pick). */
  latestVersion: number
}

export interface ReviewPackageDraft {
  items: ReviewPackageDraftItem[]
  reviewerIds: string[]
  /** Teams are expanded on the server by their reviewer rules (all members when none). */
  teamIds: string[]
  mode: ReviewMode
  priority: ReviewPriority
  /** Calendar date `YYYY-MM-DD`, no time zone. */
  dueDate: string | null
  title: string
  message: string
}

/** The server refuses more (`TOO_MANY_ITEMS`). */
export const MAX_REVIEW_PACKAGE_ITEMS = 500
