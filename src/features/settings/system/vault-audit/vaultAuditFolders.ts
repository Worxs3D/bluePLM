/**
 * The vault's folders, as the Metadata Audit's folder picker offers them.
 *
 * The scan walks database rows, not the disk, so a folder is worth offering when BluePLM has rows
 * under it, and its count is of rows: parts and assemblies by their recorded `file_path`, each row
 * once. A row that is moved locally appears twice in the store (`moved` and its `moved_away` stub,
 * one `files.id`); keying on the id and placing it at its recorded path is what the scan does too.
 *
 * Two counts per folder, because the scan reads files from disk: `modelCount` is what the scope
 * will match, `onDiskCount` how many of those this machine can open. The rest come back as "not
 * on disk", which is worth knowing before a run rather than after it.
 *
 * Pure, so the picker's matching can be tested without a store.
 */

import { scopePrefixOf } from '@/lib/metadata/divergenceScan'

const MODEL_EXTENSIONS = new Set(['.sldprt', '.sldasm'])

/** The fields of a store entry this reads. `LocalFile` satisfies it. */
export interface VaultFolderSourceEntry {
  name: string
  relativePath: string
  isDirectory: boolean
  extension: string
  diffStatus?: string
  pdmData?: { id: string; file_path: string }
}

export interface VaultAuditFolder {
  /** Vault-relative, `/`-separated, in the casing the vault uses. */
  relativePath: string
  name: string
  /** Number of path segments above it; a top-level folder is 0. */
  depth: number
  /** Parts and assemblies BluePLM has a row for at or beneath this folder. */
  modelCount: number
  /** Of those, how many have content on this machine. */
  onDiskCount: number
}

export interface VaultAuditFolderIndex {
  /** Every folder, sorted by path. */
  folders: VaultAuditFolder[]
  /** Keyed by `folderKey`. */
  byKey: Map<string, VaultAuditFolder>
  /** Direct children by parent key; the vault root's are under `''`. */
  children: Map<string, VaultAuditFolder[]>
}

/** The comparison form of a vault-relative path: `/`-separated, trimmed, lower-cased. */
export function folderKey(relativePath: string): string {
  return relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

function parentKeyOf(key: string): string {
  const slash = key.lastIndexOf('/')
  return slash === -1 ? '' : key.slice(0, slash)
}

/** Statuses whose entry has no content on this machine. */
function hasLocalContent(diffStatus: string | undefined): boolean {
  return diffStatus !== 'cloud' && diffStatus !== 'moved_away' && diffStatus !== 'deleted'
}

export function buildFolderIndex(
  entries: readonly VaultFolderSourceEntry[],
): VaultAuditFolderIndex {
  // Display casing per key: a folder entry's own name wins over a casing read off a row's path.
  const display = new Map<string, string>()
  const modelCounts = new Map<string, number>()
  const onDiskCounts = new Map<string, number>()

  const addFolderPath = (path: string, authoritative: boolean) => {
    const segments = path
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment.trim() !== '')
    for (let i = 1; i <= segments.length; i++) {
      const displayPath = segments.slice(0, i).join('/')
      const key = displayPath.toLowerCase()
      if (!display.has(key) || (authoritative && i === segments.length)) {
        display.set(key, displayPath)
      }
    }
  }

  // Rows are counted once each, at their recorded path, with content if any entry for them has it.
  const rows = new Map<string, { path: string; onDisk: boolean }>()

  for (const entry of entries) {
    if (entry.isDirectory) {
      if (entry.diffStatus !== 'deleted') addFolderPath(entry.relativePath, true)
      continue
    }
    const row = entry.pdmData
    if (!row?.file_path) continue
    if (!MODEL_EXTENSIONS.has(entry.extension.toLowerCase())) continue
    const existing = rows.get(row.id)
    const onDisk = hasLocalContent(entry.diffStatus)
    if (existing) existing.onDisk ||= onDisk
    else rows.set(row.id, { path: row.file_path, onDisk })
  }

  for (const { path, onDisk } of rows.values()) {
    const parent = parentKeyOf(folderKey(path))
    if (!parent) continue
    // The row's own path supplies casing for folders the store has no entry for.
    addFolderPath(path.replace(/\\/g, '/').split('/').slice(0, -1).join('/'), false)
    for (let key = parent; key; key = parentKeyOf(key)) {
      modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1)
      if (onDisk) onDiskCounts.set(key, (onDiskCounts.get(key) ?? 0) + 1)
    }
  }

  const folders: VaultAuditFolder[] = []
  const byKey = new Map<string, VaultAuditFolder>()
  for (const [key, relativePath] of display) {
    const segments = relativePath.split('/')
    const folder: VaultAuditFolder = {
      relativePath,
      name: segments[segments.length - 1],
      depth: segments.length - 1,
      modelCount: modelCounts.get(key) ?? 0,
      onDiskCount: onDiskCounts.get(key) ?? 0,
    }
    folders.push(folder)
    byKey.set(key, folder)
  }
  folders.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base', numeric: true }),
  )

  const children = new Map<string, VaultAuditFolder[]>()
  for (const folder of folders) {
    const parent = parentKeyOf(folder.relativePath.toLowerCase())
    const list = children.get(parent)
    if (list) list.push(folder)
    else children.set(parent, [folder])
  }

  return { folders, byKey, children }
}

/**
 * The folder a typed or pasted scope names, or null when it names none.
 *
 * Reads the input exactly as the scan will (`scopePrefixOf`), so an absolute path inside the vault,
 * a quoted "Copy as path", either separator and any casing all land on the same folder, and the
 * picker never shows a match the scan would not make.
 */
export function findFolder(
  index: VaultAuditFolderIndex,
  input: string,
  vaultPath: string,
): VaultAuditFolder | null {
  const key = folderKey(scopePrefixOf(input, vaultPath))
  if (!key) return null
  return index.byKey.get(key) ?? null
}

/** What a folder scope's text names, as the form reports it before a run. */
export type FolderScopeStatus =
  | { kind: 'empty' }
  /** The vault's folders are not loaded, so nothing can be said either way. */
  | { kind: 'unknown' }
  /** An absolute path that is not inside this vault. */
  | { kind: 'outside-vault' }
  | { kind: 'not-found' }
  | { kind: 'found'; folder: VaultAuditFolder }

export function folderScopeStatus(
  index: VaultAuditFolderIndex,
  input: string,
  vaultPath: string,
): FolderScopeStatus {
  const prefix = scopePrefixOf(input, vaultPath)
  // Blank, or the vault root itself: neither is one folder, and a run would cover the whole vault.
  if (!folderKey(prefix)) return { kind: 'empty' }
  // `scopePrefixOf` cuts a path inside the root back to its relative part, so a drive letter that
  // survives it names somewhere else.
  if (/^[a-z]:/.test(prefix)) return { kind: 'outside-vault' }
  if (index.folders.length === 0) return { kind: 'unknown' }
  const folder = findFolder(index, input, vaultPath)
  return folder ? { kind: 'found', folder } : { kind: 'not-found' }
}

/** A folder scope that would scan nothing, or the whole vault, is not run. */
export function folderScopeBlocksRun(status: FolderScopeStatus): boolean {
  return status.kind === 'empty' || status.kind === 'outside-vault' || status.kind === 'not-found'
}

/**
 * Folders to suggest for what has been typed so far, best first.
 *
 * A query with a separator in it is a path, matched as a prefix; one without is a name, matched
 * anywhere in the folder's own name before anywhere in its path. Ties go to the shallower folder,
 * which is usually the one meant, then to path order.
 */
export function suggestFolders(
  index: VaultAuditFolderIndex,
  input: string,
  vaultPath: string,
  limit = 8,
): VaultAuditFolder[] {
  const query = folderKey(scopePrefixOf(input, vaultPath))
  if (!query) {
    return index.folders.filter((folder) => folder.depth === 0).slice(0, limit)
  }

  const isPath = query.includes('/')
  const ranked: Array<{ folder: VaultAuditFolder; rank: number }> = []
  for (const folder of index.folders) {
    const path = folder.relativePath.toLowerCase()
    const name = folder.name.toLowerCase()
    let rank: number
    if (isPath) {
      if (path === query) rank = 0
      else if (path.startsWith(query)) rank = 1
      else if (path.includes(query)) rank = 3
      else continue
    } else if (name === query) rank = 0
    else if (name.startsWith(query)) rank = 1
    else if (name.includes(query)) rank = 2
    else if (path.includes(query)) rank = 3
    else continue
    ranked.push({ folder, rank })
  }

  // `index.folders` is already in path order, and the sort is stable.
  ranked.sort((a, b) => a.rank - b.rank || a.folder.depth - b.folder.depth)
  return ranked.slice(0, limit).map((entry) => entry.folder)
}

/** The keys of a folder's ancestors, so a tree can open down to it. */
export function ancestorKeys(relativePath: string): string[] {
  const keys: string[] = []
  for (let key = parentKeyOf(folderKey(relativePath)); key; key = parentKeyOf(key)) {
    keys.push(key)
  }
  return keys
}
