/**
 * Types for copying and moving files between two vaults of the same organization.
 *
 * The source is always the active vault: it is the only one whose files are loaded into the
 * store and the only working directory the read IPC will serve. The destination is any other
 * connected vault, and is only ever touched through the server and through the unrestricted
 * `copyFile` / `hashFile` / `fileExists` IPCs.
 */

import type { LocalFile } from '@/stores/types'

export type VaultTransferMode = 'copy' | 'move'

export interface VaultTransferOptions {
  mode: VaultTransferMode
  /** Vault-relative folder in the destination the transfer lands in. Empty is the vault root. */
  destFolder: string
  /**
   * True reproduces each item's source folder path under `destFolder`. False places every
   * selected item directly in `destFolder`; a selected folder still keeps its own contents.
   */
  keepPath: boolean
}

/**
 * Why a file was left out of a transfer. Every reason is something the user can act on, and
 * none of them is an error: the rest of the selection still goes.
 */
export type TransferSkipReason =
  /** Newer on the server than on this machine. Get latest first. */
  | 'outdated'
  /** Matched an ignore pattern, so the vault does not track it. */
  | 'ignored'
  /** The server deleted it; what is left on disk is an orphan, not a file to carry over. */
  | 'deleted-on-server'
  /** Nothing is stored for it, so there is nothing to copy. */
  | 'no-content'
  /** A path is already taken in the destination vault. Never overwritten. */
  | 'exists-in-destination'
  /** A file the destination vault does not track already sits at that path on disk. */
  | 'exists-on-disk'
  /** Two selected files map to the same destination path. The first one wins. */
  | 'duplicate-in-selection'
  /** The destination path would be longer than Windows allows on disk. */
  | 'path-too-long'
  /** Move only: has changes that are not checked in. Moving would strand them. */
  | 'modified'
  /** Move only: checked out. Check it in or undo the checkout first. */
  | 'checked-out'
  /** Move only: its local path differs from the server's. Resolve the pending move first. */
  | 'pending-move'

/**
 * How a file's content gets to the destination.
 *
 * - `cloud`: only in storage. The destination gets a row pointing at the same stored object and
 *   no local copy, so a cloud-only file is never downloaded just to be moved.
 * - `synced-local`: in storage and on disk, unchanged. Row first, then a disk copy whose hash
 *   is checked against the server's.
 * - `upload-local`: on disk and not known to storage under its current bytes (never checked in,
 *   or edited since). Read, hashed and uploaded like a first check-in, then copied.
 */
export type TransferStrategy = 'cloud' | 'synced-local' | 'upload-local'

export interface PlannedTransferFile {
  source: LocalFile
  sourceRelativePath: string
  destRelativePath: string
  strategy: TransferStrategy
  /** `files.id` of the source row. Null for a file that was never checked in. */
  sourceFileId: string | null
  /** The source row's version at planning time, to notice that it moved on before a Move deletes it. */
  sourceVersion: number | null
  /** The hash the server holds for the source row. Null when there is none. */
  serverHash: string | null
  size: number
  /** The source carries a workflow state that a transfer does not bring along. */
  hasWorkflowState: boolean
}

export interface SkippedTransferFile {
  relativePath: string
  destRelativePath: string
  reason: TransferSkipReason
}

export interface VaultTransferPlan {
  files: PlannedTransferFile[]
  skipped: SkippedTransferFile[]
  /** Destination folders to create, shallowest first. Includes selected folders that are empty. */
  folders: string[]
  /** Source folders (vault-relative) the selection covers, for tidying up after a Move. */
  sourceFolders: string[]
  totalBytes: number
  /** Bytes that have to be read from this disk and uploaded. */
  uploadBytes: number
  /** Files whose workflow state does not carry over. */
  workflowStateCount: number
}

export interface TransferTargetSnapshot {
  /** Lower-cased vault-relative paths of every active file the destination vault holds. */
  serverPaths: ReadonlySet<string>
  /** Lower-cased vault-relative paths of destination candidates that exist on its disk. */
  diskPaths: ReadonlySet<string>
  /** The destination vault's local folder, for the path-length check. */
  vaultPath: string
}
