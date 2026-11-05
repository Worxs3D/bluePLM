/**
 * Output requests (5.13.0, schema 515): a user on the web or on a machine without SOLIDWORKS asks
 * for a missing output of a checked-in version, and any signed-in desktop with SOLIDWORKS that can
 * read the vault picks it up and generates it through the normal output path. Table
 * `version_output_request`; every write goes through a `version_output_request_*` RPC, and a
 * request is marked `done` by trigger once its output is recorded.
 */

import type { VersionOutputKind } from './versionOutputs'

export type OutputRequestStatus = 'pending' | 'claimed' | 'done' | 'failed' | 'cancelled'

export const OUTPUT_REQUEST_STATUSES: readonly OutputRequestStatus[] = ['pending', 'claimed', 'done', 'failed', 'cancelled']

/** Statuses of a request that is still waiting for its output (a chip shows "Requested"). */
export const ACTIVE_OUTPUT_REQUEST_STATUSES: readonly OutputRequestStatus[] = ['pending', 'claimed']

/** A `version_output_request` row. */
export interface OutputRequest {
  id: string
  orgId: string
  vaultId: string | null
  fileVersionId: string
  kind: VersionOutputKind
  /** The configuration asked for; null = the one the version was saved in. */
  configuration: string | null
  status: OutputRequestStatus
  requestedBy: string | null
  requestedAt: string
  claimedBy: string | null
  claimedAt: string | null
  finishedAt: string | null
  /** Why it failed (an error code or message). */
  error: string | null
  /** The order it was asked for from, if any (context only). */
  orderId: string | null
}

/** One element of `version_output_request_create(p_items)`. */
export interface OutputRequestItem {
  fileVersionId: string
  kind: VersionOutputKind
  configuration?: string | null
  orderId?: string | null
}

/** Why the server skipped an item (`skipped[].reason`), or `UNKNOWN`. */
export type OutputRequestSkipReason = 'EXISTS' | 'BAD_KIND' | 'NOT_FOUND' | 'NO_VAULT_ACCESS' | 'UNKNOWN'

export const OUTPUT_REQUEST_SKIP_REASONS: readonly OutputRequestSkipReason[] = [
  'EXISTS',
  'BAD_KIND',
  'NOT_FOUND',
  'NO_VAULT_ACCESS',
]

export interface RequestOutputsResult {
  /** New requests. */
  created: number
  /** Items that already had a pending or claimed request (nothing new was made). */
  existing: number
  skipped: Array<{ fileVersionId: string; kind: VersionOutputKind; reason: OutputRequestSkipReason }>
}

/** Why a request RPC refused (its `HINT`), or `UNKNOWN`. */
export type OutputRequestErrorCode =
  | 'NOT_MEMBER'
  | 'NOT_FOUND'
  | 'NO_VAULT_ACCESS'
  | 'NO_EDIT_PERMISSION'
  | 'NOT_ALLOWED'
  | 'NOT_CLAIMER'
  | 'BAD_STATUS'
  | 'BAD_KIND'
  | 'BAD_PATCH'
  | 'NO_OUTPUT'
  | 'UNKNOWN'

export const OUTPUT_REQUEST_ERROR_CODES: readonly OutputRequestErrorCode[] = [
  'NOT_MEMBER',
  'NOT_FOUND',
  'NO_VAULT_ACCESS',
  'NO_EDIT_PERMISSION',
  'NOT_ALLOWED',
  'NOT_CLAIMER',
  'BAD_STATUS',
  'BAD_KIND',
  'BAD_PATCH',
  'NO_OUTPUT',
]

/** What every request write returns; nothing throws for a refusal. */
export type OutputRequestResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: OutputRequestErrorCode; message: string }
