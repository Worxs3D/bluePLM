/**
 * Planning a cross-vault transfer.
 *
 * Pure: no I/O, no store access. Given what the user selected, what the active vault holds, and
 * a snapshot of what the destination holds, it decides for every file where it lands, how its
 * content gets there, and, when it cannot go, exactly why. The dialog previews this and the
 * command executes it, so the two cannot disagree about what "N files will be copied" means.
 *
 * Nothing here deletes or overwrites: a path that is already taken in the destination is a skip,
 * never a replacement. That is the rule everything else leans on, and the engine enforces it a
 * second time at the database (`insertOnly`) for the case where the path was taken in between.
 */

import type { LocalFile } from '@/stores/types'
import { isPathWithinDirectory } from '@/lib/utils/path'

import type {
  PlannedTransferFile,
  SkippedTransferFile,
  TransferSkipReason,
  TransferStrategy,
  TransferTargetSnapshot,
  VaultTransferOptions,
  VaultTransferPlan,
} from './types'

/** Longest path Windows accepts without the extended-length prefix. */
export const WINDOWS_MAX_PATH = 259

const INVALID_SEGMENT_CHARS = /[<>:"|?*]/
const LAST_CONTROL_CHAR_CODE = 0x1f

function hasInvalidChar(segment: string): boolean {
  if (INVALID_SEGMENT_CHARS.test(segment)) return true
  for (let index = 0; index < segment.length; index++) {
    if (segment.charCodeAt(index) <= LAST_CONTROL_CHAR_CODE) return true
  }
  return false
}

/**
 * Clean a user-supplied destination folder: forward slashes, no leading or trailing slash.
 * Returns `null` for anything that is not a plain vault-relative folder (`..`, a drive, a
 * character Windows refuses in a name), and an empty string for the vault root.
 */
export function normalizeDestFolder(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (cleaned === '') return ''

  const segments = cleaned.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null
    if (hasInvalidChar(segment)) return null
    if (segment.endsWith('.') || segment.endsWith(' ')) return null
  }
  return segments.join('/')
}

function dirname(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}

function joinRelative(folder: string, tail: string): string {
  return folder === '' ? tail : `${folder}/${tail}`
}

function depth(relativePath: string): number {
  return relativePath.split('/').length
}

/** Where a source path lands, given the top-level item it was reached through. */
function mapDestination(
  sourceRelativePath: string,
  topLevelRelativePath: string,
  options: Pick<VaultTransferOptions, 'destFolder' | 'keepPath'>,
): string {
  if (options.keepPath) return joinRelative(options.destFolder, sourceRelativePath)

  const parent = dirname(topLevelRelativePath)
  const tail = parent === '' ? sourceRelativePath : sourceRelativePath.slice(parent.length + 1)
  return joinRelative(options.destFolder, tail)
}

interface ExpandedFile {
  file: LocalFile
  destRelativePath: string
}

interface Expansion {
  files: ExpandedFile[]
  /** Destination folder paths for every selected folder and every folder inside one. */
  folders: Set<string>
  sourceFolders: Set<string>
}

/** A stub names a file whose content is elsewhere; the row that holds the content is the one to move. */
function isStub(file: LocalFile): boolean {
  return file.diffStatus === 'moved_away'
}

/**
 * Turn the selection into the files it covers, each with its destination.
 *
 * A folder brings everything inside it. Shallower items are walked first so that a folder
 * selected together with one of its own files is walked as a folder, and every source file is
 * visited once however many ways the selection reaches it.
 */
function expandSelection(
  selection: readonly LocalFile[],
  vaultFiles: readonly LocalFile[],
  options: Pick<VaultTransferOptions, 'destFolder' | 'keepPath'>,
): Expansion {
  const result: Expansion = { files: [], folders: new Set(), sourceFolders: new Set() }
  const visited = new Set<string>()

  const ordered = [...selection].sort(
    (left, right) => depth(left.relativePath) - depth(right.relativePath),
  )

  for (const item of ordered) {
    if (isStub(item)) continue

    if (!item.isDirectory) {
      const key = item.relativePath.toLowerCase()
      if (visited.has(key)) continue
      visited.add(key)
      result.files.push({
        file: item,
        destRelativePath: mapDestination(item.relativePath, item.relativePath, options),
      })
      continue
    }

    result.sourceFolders.add(item.relativePath)
    result.folders.add(mapDestination(item.relativePath, item.relativePath, options))

    for (const candidate of vaultFiles) {
      if (candidate.relativePath.length <= item.relativePath.length) continue
      if (!isPathWithinDirectory(candidate.relativePath, item.relativePath)) continue

      if (candidate.isDirectory) {
        result.sourceFolders.add(candidate.relativePath)
        result.folders.add(mapDestination(candidate.relativePath, item.relativePath, options))
        continue
      }
      if (isStub(candidate)) continue

      const key = candidate.relativePath.toLowerCase()
      if (visited.has(key)) continue
      visited.add(key)
      result.files.push({
        file: candidate,
        destRelativePath: mapDestination(candidate.relativePath, item.relativePath, options),
      })
    }
  }

  return result
}

/**
 * Every destination path the selection would write a file to. The caller probes these on the
 * destination's disk and hands the answer back as `TransferTargetSnapshot.diskPaths`, which
 * keeps the planner synchronous without making it guess.
 */
export function candidateDestinationPaths(
  selection: readonly LocalFile[],
  vaultFiles: readonly LocalFile[],
  options: Pick<VaultTransferOptions, 'destFolder' | 'keepPath'>,
): string[] {
  return expandSelection(selection, vaultFiles, options).files.map((entry) => entry.destRelativePath)
}

type Classification =
  | { kind: 'transfer'; strategy: TransferStrategy }
  | { kind: 'skip'; reason: TransferSkipReason }

function hasLocalContent(file: LocalFile): boolean {
  return file.diffStatus !== 'cloud' && file.diffStatus !== 'deleted'
}

/** What the source row alone says about whether, and how, this file can go. */
function classifySource(file: LocalFile, mode: VaultTransferOptions['mode']): Classification {
  const status = file.diffStatus
  const serverHash = file.pdmData?.content_hash ?? null
  const isMove = mode === 'move'

  if (status === 'ignored') return { kind: 'skip', reason: 'ignored' }
  if (status === 'deleted_remote') return { kind: 'skip', reason: 'deleted-on-server' }
  if (status === 'outdated') return { kind: 'skip', reason: 'outdated' }

  if (isMove) {
    if (file.pdmData?.checked_out_by) return { kind: 'skip', reason: 'checked-out' }
    if (status === 'modified') return { kind: 'skip', reason: 'modified' }
    if (status === 'moved') return { kind: 'skip', reason: 'pending-move' }
  }

  if (!hasLocalContent(file)) {
    return serverHash
      ? { kind: 'transfer', strategy: 'cloud' }
      : { kind: 'skip', reason: 'no-content' }
  }

  // On disk. Unchanged and known to the server: its stored object is the content.
  const unchanged = status === undefined && file.pdmData !== undefined && serverHash !== null
  return { kind: 'transfer', strategy: unchanged ? 'synced-local' : 'upload-local' }
}

export interface PlanVaultTransferInput {
  selection: readonly LocalFile[]
  /** Every row of the active vault, for expanding folders. */
  vaultFiles: readonly LocalFile[]
  options: VaultTransferOptions
  target: TransferTargetSnapshot
}

export function planVaultTransfer(input: PlanVaultTransferInput): VaultTransferPlan {
  const { selection, vaultFiles, options, target } = input
  const expansion = expandSelection(selection, vaultFiles, options)

  const files: PlannedTransferFile[] = []
  const skipped: SkippedTransferFile[] = []
  const claimed = new Set<string>()

  let totalBytes = 0
  let uploadBytes = 0
  let workflowStateCount = 0

  function skip(entry: ExpandedFile, reason: TransferSkipReason): void {
    skipped.push({
      relativePath: entry.file.relativePath,
      destRelativePath: entry.destRelativePath,
      reason,
    })
  }

  for (const entry of expansion.files) {
    const { file, destRelativePath } = entry
    const classification = classifySource(file, options.mode)
    if (classification.kind === 'skip') {
      skip(entry, classification.reason)
      continue
    }

    const destKey = destRelativePath.toLowerCase()

    if (target.serverPaths.has(destKey)) {
      skip(entry, 'exists-in-destination')
      continue
    }
    if (target.diskPaths.has(destKey)) {
      skip(entry, 'exists-on-disk')
      continue
    }
    if (claimed.has(destKey)) {
      skip(entry, 'duplicate-in-selection')
      continue
    }
    if (
      classification.strategy !== 'cloud' &&
      target.vaultPath.length + 1 + destRelativePath.length > WINDOWS_MAX_PATH
    ) {
      skip(entry, 'path-too-long')
      continue
    }

    claimed.add(destKey)

    const size = file.pdmData?.file_size ?? file.size
    const hasWorkflowState = Boolean(file.pdmData?.workflow_state_id)
    totalBytes += size
    if (classification.strategy === 'upload-local') uploadBytes += size
    if (hasWorkflowState) workflowStateCount++

    files.push({
      source: file,
      sourceRelativePath: file.relativePath,
      destRelativePath,
      strategy: classification.strategy,
      sourceFileId: file.pdmData?.id ?? null,
      sourceVersion: file.pdmData?.version ?? null,
      serverHash: file.pdmData?.content_hash ?? null,
      size,
      hasWorkflowState,
    })
  }

  const folders = [...expansion.folders]
    .filter((folder) => folder !== '')
    .sort((left, right) => depth(left) - depth(right) || left.localeCompare(right))

  return {
    files,
    skipped,
    folders,
    sourceFolders: [...expansion.sourceFolders],
    totalBytes,
    uploadBytes,
    workflowStateCount,
  }
}
