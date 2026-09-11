/**
 * Orphaned directory candidate derivation.
 *
 * 4.3.1 made a remote file deletion recycle the local copy automatically. It never
 * touched directories, so a folder deleted on the server leaves an empty tree of
 * directories behind on every other machine. Directories cannot be classified
 * `deleted_remote` the way files are - the merge returns a directory row early,
 * before diff-status classification even runs (`src/hooks/useLoadFiles.ts:1164-1180`),
 * and `localSyncIndex` has no directory entries and no `isDirectory` field
 * (`src/lib/cache/localSyncIndex.ts`), so there is no durable "this directory was
 * previously synced" evidence to classify against. Inventing one is a much larger
 * change than this release wants.
 *
 * Instead, this module derives the candidate directories from the discard batch that
 * just ran: a directory becomes a candidate only as a consequence of files having
 * actually been recycled out of it. That needs no new persistence, and it is
 * strictly safer than a durable classification would be, because it can never nominate
 * a directory nothing was ever discarded from.
 *
 * This module is pure - it has no `fs`, no IPC, and no store access. The caller
 * (`src/lib/commands/handlers/discardOrphaned.ts`) supplies everything, including the
 * store's `serverFolderPaths`, and is responsible for actually sending the result to
 * `window.electronAPI.trashEmptyDirs`, which independently re-verifies emptiness and
 * containment before touching disk. The filtering here is an optimisation and a
 * reporting aid - it is never the safety mechanism.
 */

import { buildFullPath, isPathWithinDirectory } from './utils'

export interface OrphanedDirectoryCandidatesInput {
  /** Vault-relative paths of files a discard batch actually recycled. */
  succeededRelativePaths: string[]
  /**
   * Vault-relative paths of files the same batch left on disk - skipped (could not be
   * recycled) or genuinely failed (e.g. locked open in SolidWorks). Either way the
   * file, and therefore its whole ancestor chain, is not empty.
   */
  keptRelativePaths: string[]
  /**
   * The store's `serverFolderPaths` (`src/stores/slices/filesSlice.ts`) - every folder
   * path the server still asserts exists, built from explicit `folders` rows plus
   * folders implied by remaining file paths.
   */
  serverFolderPaths: ReadonlySet<string>
  /** Absolute vault root. Candidates are built relative to this and never include it. */
  vaultPath: string
}

/** Normalise separators and strip leading/trailing slashes, without touching case. */
function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * Every ancestor directory of a relative path, root and the path's own final segment
 * excluded - i.e. every directory that has to exist for this path to exist, shallowest
 * first.
 */
function getAncestorDirectories(relativePath: string): string[] {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) return []
  const segments = normalized.split('/')
  const ancestors: string[] = []
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('/'))
  }
  return ancestors
}

/** The immediate parent directory of a relative path, or '' for a vault-root file. */
function getImmediateDirectory(relativePath: string): string {
  const ancestors = getAncestorDirectories(relativePath)
  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : ''
}

/** Deepest-first, then longest-string-first - shared sort for every view onto candidates. */
function sortDeepestFirst(relativePaths: string[]): string[] {
  return [...relativePaths].sort((a, b) => {
    const segmentDelta = b.split('/').length - a.split('/').length
    if (segmentDelta !== 0) return segmentDelta
    return b.length - a.length
  })
}

/**
 * Every ancestor directory that became empty as a result of a discard batch, before
 * the `serverFolderPaths` guard is applied. Shared by `getOrphanedDirectoryCandidates`
 * (what is actually safe to recycle) and `getServerTrackedEmptyAncestors` (what would
 * be safe if the server did not still assert it exists) so the two can never disagree
 * about which directories the batch emptied.
 */
function computeEmptiedAncestors(
  succeededRelativePaths: string[],
  keptRelativePaths: string[],
): Map<string, string> {
  // Every ancestor of every successfully-deleted file is a candidate, up to but
  // excluding the vault root (getAncestorDirectories never returns the root itself).
  // Keyed by lowercase so a later case-insensitive removal below can address the same
  // entry no matter which spelling first inserted it.
  const candidates = new Map<string, string>()
  for (const relativePath of succeededRelativePaths) {
    for (const ancestor of getAncestorDirectories(relativePath)) {
      const key = ancestor.toLowerCase()
      if (!candidates.has(key)) candidates.set(key, ancestor)
    }
  }

  if (candidates.size === 0) return candidates

  // A kept file (skipped or genuinely failed) is still on disk, so its own directory,
  // and every ancestor of that directory, is not empty. The main-process handler would
  // refuse these anyway on its own re-stat; dropping them here up front is what makes
  // the reported `directoriesKept` count mean "the handler found something we didn't
  // know about" rather than counting refusals that were never going to succeed.
  for (const keptPath of keptRelativePaths) {
    const keptDirectory = getImmediateDirectory(keptPath)
    if (!keptDirectory) continue
    for (const key of Array.from(candidates.keys())) {
      const candidate = candidates.get(key)
      if (candidate !== undefined && isPathWithinDirectory(keptDirectory, candidate)) {
        candidates.delete(key)
      }
    }
  }

  return candidates
}

/**
 * Derive the directories that became empty as a result of a discard batch, deepest
 * path first (more path segments first, then longer strings first as a tie-break).
 * The caller re-stats each one at the moment of its own removal - see
 * `.cursor/plans/release-4.3.2-empty-folders.plan.md`'s "Ordering" section - so this
 * order is what lets a nested empty directory disappear before the parent it leaves
 * behind is itself checked.
 */
export function getOrphanedDirectoryCandidates({
  succeededRelativePaths,
  keptRelativePaths,
  serverFolderPaths,
  vaultPath,
}: OrphanedDirectoryCandidatesInput): string[] {
  if (!vaultPath) return []

  const candidates = computeEmptiedAncestors(succeededRelativePaths, keptRelativePaths)
  if (candidates.size === 0) return []

  // Load-bearing, not just tidy: the merge auto-creates every server folder locally on
  // every load (`src/hooks/useLoadFiles.ts`'s server-folder pass), so removing a
  // directory the server still asserts exists would just have it recreated on the very
  // next refresh - a remove/recreate ping-pong. `serverFolderPaths` is exactly the set
  // of folders the server still knows about, so anything still in it is not orphaned
  // from the server's point of view even though every file we deleted happened to live
  // under it.
  const lowerServerFolders = new Set(
    Array.from(serverFolderPaths, (path) => path.toLowerCase()),
  )
  for (const key of Array.from(candidates.keys())) {
    if (lowerServerFolders.has(key)) candidates.delete(key)
  }

  const relativeCandidates = sortDeepestFirst(Array.from(candidates.values()))

  return relativeCandidates.map((relativePath) => buildFullPath(vaultPath, relativePath))
}

/**
 * The directories a discard batch emptied on disk but which are left alone forever,
 * not just this once, because the server still asserts they exist (`serverFolderPaths`
 * - an explicit `folders` row, or a file the vault still has under that path, however
 * stale). `getOrphanedDirectoryCandidates` drops these silently, by design - they are
 * not a failure of this batch, they never reach `trashEmptyDirs`, and retrying changes
 * nothing. That silence is exactly right for the removal decision and exactly wrong
 * for the person looking at an empty-looking folder that never goes away: this export
 * exists only so a caller can tell them why, in a message, without touching disk or
 * re-deriving the candidate list itself.
 *
 * Vault-relative, not absolute - unlike `getOrphanedDirectoryCandidates`, nothing here
 * is ever handed to `trashEmptyDirs`, so there is no need for a `vaultPath` and no risk
 * of this list being mistaken for one more removal target.
 */
export function getServerTrackedEmptyAncestors({
  succeededRelativePaths,
  keptRelativePaths,
  serverFolderPaths,
}: Omit<OrphanedDirectoryCandidatesInput, 'vaultPath'>): string[] {
  const candidates = computeEmptiedAncestors(succeededRelativePaths, keptRelativePaths)
  if (candidates.size === 0) return []

  const lowerServerFolders = new Set(
    Array.from(serverFolderPaths, (path) => path.toLowerCase()),
  )
  const trackedByServer = Array.from(candidates.entries())
    .filter(([key]) => lowerServerFolders.has(key))
    .map(([, relativePath]) => relativePath)

  return sortDeepestFirst(trackedByServer)
}
