/**
 * What `restore-metadata-from-files` would write: the file-scope part number and description a
 * part or assembly still holds in its own properties, for rows whose column is empty.
 *
 * The divergence scan reports these as `unattributed` (`database-never-held-it`) and never repairs
 * them, because nothing in a pair of values says whether an empty column lost its value or never
 * had one. That stays the scan's answer. This plan is the explicit, admin-run decision the scan
 * leaves to a person, and it is narrow on purpose:
 *
 * - Only `database-empty`: the row is empty and the file is not. A row holding any value is never
 *   touched, whatever the file says.
 * - Only parts and assemblies, where the row owns the field. A drawing's copy is its parent's.
 * - Only the value under a key BluePLM itself writes (`databaseRepairValue`): `Base Item Number`
 *   for the part number, never the composite `Number`, which carries the tab.
 * - Never a file somebody else holds, and never a field the current user has a pending edit for -
 *   that edit is what their check-in will commit.
 *
 * Pure: no I/O, no store access.
 */

import { isEmptyColumnWithFileValue, type EmptyColumnField, type FileDivergence } from './divergence'
import { resolveDescription, resolvePartNumber, type MetadataOverlaySource } from './overlay'

export type RestorableField = EmptyColumnField

/** One file's empty columns and the value its document holds for each. */
export interface MetadataRestoreFile {
  fileId: string
  relativePath: string
  fileName: string
  values: Partial<Record<RestorableField, string>>
}

/** What the plan knows about a file's live state, read from the store at plan time. */
export interface MetadataRestoreFileState {
  /** The user holding the checkout, or null. */
  checkedOutBy: string | null
  /** Fields the current user has a pending (not yet checked-in) edit for. */
  pendingFields: ReadonlySet<RestorableField>
}

export interface MetadataRestorePlanOptions {
  /** The user who would run the restore. */
  userId: string
  /** Relative-path prefixes to leave out, compared case-insensitively. */
  excludePrefixes?: readonly string[]
  /** Live state per file id. A file the store does not know is planned from the report alone. */
  stateOf?: (fileId: string) => MetadataRestoreFileState | undefined
}

export interface MetadataRestorePlan {
  files: MetadataRestoreFile[]
  /** Files that would have been planned but sit under an excluded prefix. */
  excluded: MetadataRestoreFile[]
  /** Files that would have been planned but are checked out by another user. */
  heldByOthers: MetadataRestoreFile[]
  /** Values left alone because the current user has a pending edit for that field. */
  pendingEditsKept: number
  /** Total values in `files`. */
  valueCount: number
}

/**
 * Live state per file id, read from the loaded files.
 *
 * A `moved_away` stub and its partner share an id, so both rows are merged. A pending edit is
 * detected through the overlay - presence decides, so an edit that cleared the field still counts.
 */
export function restoreStatesOf(
  files: readonly MetadataOverlaySource[],
): Map<string, MetadataRestoreFileState> {
  const states = new Map<string, { checkedOutBy: string | null; pending: Set<RestorableField> }>()
  for (const file of files) {
    const fileId = file.pdmData?.id
    if (!fileId) continue
    const state = states.get(fileId) ?? { checkedOutBy: null, pending: new Set<RestorableField>() }
    state.checkedOutBy = state.checkedOutBy ?? file.pdmData?.checked_out_by ?? null
    if (resolvePartNumber(file).source === 'pending') state.pending.add('part_number')
    if (resolveDescription(file).source === 'pending') state.pending.add('description')
    states.set(fileId, state)
  }
  return new Map(
    [...states].map(([fileId, state]) => [
      fileId,
      { checkedOutBy: state.checkedOutBy, pendingFields: state.pending },
    ]),
  )
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

function isExcluded(relativePath: string, prefixes: readonly string[]): boolean {
  const path = normalizePath(relativePath)
  return prefixes.some((prefix) => {
    const normalized = normalizePath(prefix).replace(/\/+$/, '')
    return normalized !== '' && (path === normalized || path.startsWith(`${normalized}/`))
  })
}

function restorableValues(file: FileDivergence): Partial<Record<RestorableField, string>> {
  const values: Partial<Record<RestorableField, string>> = {}
  for (const comparison of file.fieldComparisons) {
    if (!isEmptyColumnWithFileValue(comparison, file.fileType)) continue
    values[comparison.field as RestorableField] = (comparison.databaseRepairValue ?? '').trim()
  }
  return values
}

export function buildMetadataRestorePlan(
  files: readonly FileDivergence[],
  options: MetadataRestorePlanOptions,
): MetadataRestorePlan {
  const excludePrefixes = options.excludePrefixes ?? []
  const plan: MetadataRestorePlan = {
    files: [],
    excluded: [],
    heldByOthers: [],
    pendingEditsKept: 0,
    valueCount: 0,
  }

  for (const file of files) {
    const values = restorableValues(file)
    if (Object.keys(values).length === 0) continue

    const entry: MetadataRestoreFile = {
      fileId: file.fileId,
      relativePath: file.relativePath,
      fileName: file.fileName,
      values,
    }

    if (isExcluded(file.relativePath, excludePrefixes)) {
      plan.excluded.push(entry)
      continue
    }

    const state = options.stateOf?.(file.fileId)
    if (state?.checkedOutBy && state.checkedOutBy !== options.userId) {
      plan.heldByOthers.push(entry)
      continue
    }

    if (state) {
      for (const field of state.pendingFields) {
        if (entry.values[field] !== undefined) {
          delete entry.values[field]
          plan.pendingEditsKept += 1
        }
      }
      if (Object.keys(entry.values).length === 0) continue
    }

    plan.files.push(entry)
    plan.valueCount += Object.keys(entry.values).length
  }

  return plan
}
