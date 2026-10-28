import { relocateCurrentFolderIfRemoved } from '@/lib/commands/handlers/discardOrphaned'
import {
  getUnassertedEmptyDirectories,
  selectGhostDirectories,
  type DeletedFolderRecord,
} from '@/lib/ghostDirectories'
import { log } from '@/lib/logger'
import { getDeletedFoldersByPath } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

/**
 * Per vault, candidates already settled this session, keyed by lowercase path plus
 * mtime: no deleted row, recreated after the deletion, or refused by the main process
 * (a hidden `desktop.ini` makes a directory non-empty on disk). Without this every
 * silent refresh would query the server again for a user's own empty local folders.
 * A changed mtime is a new key, so a directory touched since is looked at again.
 * Pruned to the current candidates on every run, so it never outgrows them.
 */
const settledCandidates = new Map<string, Set<string>>()

/** Clear the per-vault memo. Exported for tests, which share module state. */
export function resetGhostDirectoryMemo(): void {
  settledCandidates.clear()
}

function memoKey(directory: LocalFile): string {
  return `${directory.relativePath.replace(/\\/g, '/').toLowerCase()}\u0000${directory.modifiedTime}`
}

export interface GhostDirectoryCleanupInput {
  vaultId: string
  files: readonly LocalFile[]
  serverFolderPaths: ReadonlySet<string>
  fetchDeletedFolders: (
    folderPaths: string[],
  ) => Promise<{ folders: DeletedFolderRecord[]; error?: string }>
  trashEmptyDirs: (
    paths: string[],
  ) => Promise<{ results: Array<{ path: string; success: boolean }> }>
}

export interface GhostDirectoryCleanupResult {
  /** Absolute paths recycled (or already gone), for the caller to drop from the store. */
  removed: string[]
  /** Ghosts the main process left on disk. */
  kept: number
  error?: string
}

/**
 * Recycle empty local directories whose server folder was deleted - see
 * `src/lib/ghostDirectories.ts` for the rule and why the file-driven cleanup never
 * reached them. Queries the server only when there are unsettled candidates, which on
 * a vault with no stray empty folders is never.
 */
export async function removeGhostDirectories({
  vaultId,
  files,
  serverFolderPaths,
  fetchDeletedFolders,
  trashEmptyDirs,
}: GhostDirectoryCleanupInput): Promise<GhostDirectoryCleanupResult> {
  const candidates = getUnassertedEmptyDirectories(files, serverFolderPaths)
  const previous = settledCandidates.get(vaultId) ?? new Set<string>()
  const settled = new Set(candidates.map(memoKey).filter((key) => previous.has(key)))
  settledCandidates.set(vaultId, settled)

  const unsettled = candidates.filter((directory) => !settled.has(memoKey(directory)))
  if (unsettled.length === 0) return { removed: [], kept: 0 }

  const { folders, error } = await fetchDeletedFolders(unsettled.map((d) => d.relativePath))
  if (error) return { removed: [], kept: 0, error }

  const ghosts = selectGhostDirectories(unsettled, folders)
  const ghostKeys = new Set(ghosts.map(memoKey))
  for (const directory of unsettled) {
    if (!ghostKeys.has(memoKey(directory))) settled.add(memoKey(directory))
  }
  if (ghosts.length === 0) return { removed: [], kept: 0 }

  const { results } = await trashEmptyDirs(ghosts.map((d) => d.path))
  const removedSet = new Set(results.filter((r) => r.success).map((r) => r.path))
  for (const ghost of ghosts) {
    if (!removedSet.has(ghost.path)) settled.add(memoKey(ghost))
  }

  return { removed: [...removedSet], kept: ghosts.length - removedSet.size }
}

/**
 * `removeGhostDirectories` against the live store, the server and the main process,
 * called once per committed merge from `useLoadFiles`. Never throws: a failed cleanup
 * leaves an empty folder, which must not fail the load.
 */
export async function runGhostDirectoryCleanup(vaultId: string, vaultPath: string): Promise<void> {
  const trash = window.electronAPI?.trashEmptyDirs
  if (!trash) return

  try {
    const { files, serverFolderPaths } = usePDMStore.getState()
    const result = await removeGhostDirectories({
      vaultId,
      files,
      serverFolderPaths,
      fetchDeletedFolders: (paths) => getDeletedFoldersByPath(vaultId, paths),
      trashEmptyDirs: trash,
    })

    if (result.error) {
      log.warn('[GhostDirs]', 'Could not look up deleted folders', { error: result.error })
      return
    }
    if (result.removed.length > 0) {
      usePDMStore.getState().removeFilesFromStore(result.removed)
      relocateCurrentFolderIfRemoved(result.removed, vaultPath)
    }
    if (result.removed.length > 0 || result.kept > 0) {
      log.info('[GhostDirs]', 'Removed empty folders deleted on the server', {
        removed: result.removed.length,
        kept: result.kept,
        paths: result.removed.slice(0, 10),
      })
    }
  } catch (error) {
    log.warn('[GhostDirs]', 'Ghost directory cleanup failed', { error: String(error) })
  }
}
