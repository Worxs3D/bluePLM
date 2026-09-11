import { buildFullPath } from '@/lib/utils/path'
import type { LocalFile } from '@/stores/types'

/**
 * Resolve the path to open for a `'moved_away'` stub double-clicked in the tree.
 *
 * The stub sits at the vault's recorded path, but there is nothing on disk there anymore -
 * the content lives at `movedToRelativePath`. Opening `file.path` directly would fail
 * silently (or open whatever unrelated file now occupies that path), so redirect to the
 * real location instead. Returns `null` when the destination cannot be resolved (no
 * `movedToRelativePath`, or no connected vault to resolve it against), in which case the
 * caller must not attempt to open anything.
 */
export function resolveMovedAwayOpenPath(
  file: Pick<LocalFile, 'movedToRelativePath'>,
  vaultPath: string | null,
): string | null {
  if (!file.movedToRelativePath || !vaultPath) return null
  return buildFullPath(vaultPath, file.movedToRelativePath)
}
