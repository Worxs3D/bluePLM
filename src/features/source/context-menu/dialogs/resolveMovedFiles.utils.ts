/**
 * Pure helpers for `ResolveMovedFilesDialog`.
 *
 * Kept apart from the component so the two things that are actually worth testing — which pairs
 * get listed, and which of them a given scope selection covers — can be tested without React.
 *
 * The scope and the ticked rows decide what a run touches: the dialog passes their `files.id`s to
 * `reconcile-moved-paths` / `adopt-server-paths` as `fileIds`, and runs the same preflights with the
 * same ids, so every count and every row status agrees with what clicking a button does. A run never
 * reaches a pending move outside the list the user is looking at.
 */

import { getCheckoutProfileForOwner } from '@/lib/checkout/checkoutDisplay'
import { isPathWithinDirectory } from '@/lib/utils'
import type { LocalFile } from '@/stores/pdmStore'

/** One pending move, named by the paths every target/pair in this flow already uses. */
export interface MovedPair {
  /** `files.id` — shared by a `'moved'` row and its `'moved_away'` stub. */
  fileId: string
  name: string
  /** The path the vault still records for the file. */
  serverPath: string
  /** The path the file's content actually occupies right now. */
  localPath: string
  /** Disk modified time of the moved file, when this machine has it (not for a lone stub). */
  localModifiedAt: string | null
  /** When the vault row was created (first check-in). */
  vaultCreatedAt: string | null
  /** The vault row's last update and who made it (`files.updated_by`, a user id). */
  vaultUpdatedAt: string | null
  vaultUpdatedBy: string | null
  version: number | null
  /** Who holds the file checked out, if anyone (a user id), and their name when hydrated. */
  checkedOutBy: string | null
  checkedOutByName: string | null
}

/** Anything with the two paths a scope can be tested against. */
export interface ScopeMatchable {
  fileId: string
  serverPath: string
  localPath: string
}

export type ResolveScopeType = 'file' | 'folder' | 'vault'

export type ResolveScope =
  | { type: 'vault' }
  | { type: 'file'; fileId: string | null }
  | { type: 'folder'; folderPath: string }

function toForwardSlash(path: string): string {
  return path.replace(/\\/g, '/')
}

function vaultFacts(
  file: LocalFile,
): Pick<
  MovedPair,
  | 'vaultCreatedAt'
  | 'vaultUpdatedAt'
  | 'vaultUpdatedBy'
  | 'version'
  | 'checkedOutBy'
  | 'checkedOutByName'
> {
  const pdm = file.pdmData
  const holder = getCheckoutProfileForOwner(file)
  return {
    vaultCreatedAt: pdm?.created_at ?? null,
    vaultUpdatedAt: pdm?.updated_at ?? null,
    vaultUpdatedBy: pdm?.updated_by ?? null,
    version: typeof pdm?.version === 'number' ? pdm.version : null,
    checkedOutBy: pdm?.checked_out_by ?? null,
    checkedOutByName: holder?.full_name?.trim() || holder?.email?.trim() || null,
  }
}

/**
 * Every pending move in `files`, one row per logical file.
 *
 * A `'moved'` row already carries both paths (`pdmData.file_path` is the server path,
 * `relativePath` is where it sits now) and is preferred. A `'moved_away'` stub is read only when
 * its `'moved'` partner is not in the array — e.g. a folder-scoped fetch that happens to include
 * only the stub's side — using `movedToRelativePath` for the destination it already carries.
 */
export function buildMovedPairs(files: LocalFile[]): MovedPair[] {
  const byId = new Map<string, MovedPair>()

  for (const file of files) {
    if (file.diffStatus !== 'moved') continue
    const fileId = file.pdmData?.id
    const serverPath = file.pdmData?.file_path
    if (!fileId || !serverPath) continue

    byId.set(fileId, {
      fileId,
      name: file.name,
      serverPath: toForwardSlash(serverPath),
      localPath: toForwardSlash(file.relativePath),
      localModifiedAt: file.modifiedTime || null,
      ...vaultFacts(file),
    })
  }

  for (const file of files) {
    if (file.diffStatus !== 'moved_away') continue
    const fileId = file.pdmData?.id
    if (!fileId || byId.has(fileId)) continue
    if (!file.movedToRelativePath) continue

    byId.set(fileId, {
      fileId,
      name: file.pdmData?.file_name?.trim() || file.name,
      serverPath: toForwardSlash(file.relativePath),
      localPath: toForwardSlash(file.movedToRelativePath),
      localModifiedAt: null,
      ...vaultFacts(file),
    })
  }

  return Array.from(byId.values()).sort((a, b) => a.serverPath.localeCompare(b.serverPath))
}

/**
 * Whether `item` falls under `scope`.
 *
 * A folder scope matches on either path, not just one: the folder tree shows a pending-move
 * count on both the source and destination folders (Agent 1/2's design), so opening the dialog
 * from either side should show the same move. An empty folder path (the vault root, opened with
 * no sub-path) matches everything, same as an explicit vault scope — `isPathWithinDirectory`
 * itself refuses to treat an empty directory as "everything", so that case is handled here first.
 */
export function isInScope(item: ScopeMatchable, scope: ResolveScope): boolean {
  switch (scope.type) {
    case 'vault':
      return true
    case 'file':
      return scope.fileId !== null && item.fileId === scope.fileId
    case 'folder':
      if (!scope.folderPath) return true
      return (
        isPathWithinDirectory(item.localPath, scope.folderPath) ||
        isPathWithinDirectory(item.serverPath, scope.folderPath)
      )
  }
}

export function filterByScope<T extends ScopeMatchable>(items: T[], scope: ResolveScope): T[] {
  return items.filter((item) => isInScope(item, scope))
}

/** The parent folder of a relative path, `''` for a root-level file. */
function parentFolderOf(relativePath: string): string {
  const normalized = toForwardSlash(relativePath)
  const separatorIndex = normalized.lastIndexOf('/')
  return separatorIndex === -1 ? '' : normalized.slice(0, separatorIndex)
}

/**
 * The scope type the dialog should open with, given the file or folder it was opened from.
 * A folder badge opens scoped to that folder; a file's context-menu item opens scoped to that
 * file; no context (should not normally happen) falls back to the vault.
 */
export function inferDefaultScopeType(contextFile: LocalFile | null): ResolveScopeType {
  if (!contextFile) return 'vault'
  return contextFile.isDirectory ? 'folder' : 'file'
}

/** Build the concrete scope for the currently selected scope type and opening context. */
export function buildScope(scopeType: ResolveScopeType, contextFile: LocalFile | null): ResolveScope {
  if (scopeType === 'file') {
    return { type: 'file', fileId: contextFile?.pdmData?.id ?? null }
  }

  if (scopeType === 'folder') {
    const folderPath = contextFile
      ? contextFile.isDirectory
        ? contextFile.relativePath
        : parentFolderOf(contextFile.relativePath)
      : ''
    return { type: 'folder', folderPath }
  }

  return { type: 'vault' }
}

/**
 * The segments both paths share at the start and at the end, split off so a row can dim them and
 * show only the part that differs (a folder inserted in the middle, a rename). Splits on whole
 * segments, so `Fixed Lens/a` vs `Fixed Lens Models/a` share nothing at the start. Compared
 * case-insensitively (Windows), returned in each path's own spelling. The shared end never
 * overlaps the shared start; one side's differing part may be empty (a folder only added or only
 * removed), never both.
 */
export function splitPathDifference(
  serverPath: string,
  localPath: string,
): { prefix: string; serverMiddle: string; localMiddle: string; suffix: string } {
  const server = serverPath.split('/')
  const local = localPath.split('/')
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const shorter = Math.min(server.length, local.length)

  let head = 0
  while (head < shorter - 1 && same(server[head], local[head])) head++
  let tail = 0
  while (
    tail < shorter - head &&
    same(server[server.length - 1 - tail], local[local.length - 1 - tail])
  ) {
    tail++
  }
  // Both differing parts empty would mean identical paths; show them whole rather than nothing.
  if (server.length - head - tail === 0 && local.length - head - tail === 0) tail = Math.max(0, tail - 1)

  const join = (parts: string[]) => parts.join('/')
  const prefix = head > 0 ? join(server.slice(0, head)) + '/' : ''
  const suffixParts = tail > 0 ? server.slice(server.length - tail) : []
  const serverMid = join(server.slice(head, server.length - tail))
  const localMid = join(local.slice(head, local.length - tail))
  const suffix = suffixParts.length > 0 ? join(suffixParts) : ''
  const withSlash = (mid: string) => (mid && suffix ? mid + '/' : mid)
  return {
    prefix,
    serverMiddle: withSlash(serverMid),
    localMiddle: withSlash(localMid),
    suffix,
  }
}

/** What one direction would do with one row, read from that direction's preflight. */
export type RowDirectionStatus =
  | { kind: 'ready' }
  | { kind: 'held'; holderName: string | null }
  | { kind: 'conflict' }
  | { kind: 'unverified' }
  /** The preflight did not consider it (already resolved, or not a candidate in this direction). */
  | { kind: 'none' }

interface PreflightLike {
  eligible: Array<{ fileId: string }>
  blocked: Array<{ fileId: string; holderName: string | null }>
  skipped: Array<{ fileId: string; reason: 'conflict' | 'unverified' }>
}

/** Index a preflight by `files.id`, so each row can show what its own button would do. */
export function statusByFileId(preflight: PreflightLike): Map<string, RowDirectionStatus> {
  const map = new Map<string, RowDirectionStatus>()
  for (const target of preflight.eligible) map.set(target.fileId, { kind: 'ready' })
  for (const target of preflight.blocked) {
    map.set(target.fileId, { kind: 'held', holderName: target.holderName })
  }
  for (const target of preflight.skipped) map.set(target.fileId, { kind: target.reason })
  return map
}

/** What one direction's run would do with the ticked rows, for its card. */
export interface SelectionCounts {
  eligible: number
  blocked: number
  conflicts: number
  unverified: number
  holders: Array<{ holderName: string | null; count: number }>
}

/** Count a preflight's buckets over the selected ids only, holders biggest first. */
export function countSelected(preflight: PreflightLike, selected: ReadonlySet<string>): SelectionCounts {
  const holders = new Map<string, { holderName: string | null; count: number }>()
  let blocked = 0
  for (const target of preflight.blocked) {
    if (!selected.has(target.fileId)) continue
    blocked++
    const key = target.holderName ?? ''
    const entry = holders.get(key)
    if (entry) entry.count++
    else holders.set(key, { holderName: target.holderName, count: 1 })
  }
  const skipped = preflight.skipped.filter((target) => selected.has(target.fileId))
  return {
    eligible: preflight.eligible.filter((target) => selected.has(target.fileId)).length,
    blocked,
    conflicts: skipped.filter((target) => target.reason === 'conflict').length,
    unverified: skipped.filter((target) => target.reason === 'unverified').length,
    holders: Array.from(holders.values()).sort((a, b) => b.count - a.count),
  }
}
