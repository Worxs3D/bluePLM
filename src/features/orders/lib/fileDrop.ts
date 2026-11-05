/**
 * Files dragged from the file list or the explorer tree onto an order (5.13.0). Both sources put
 * `PDM_FILES_DATA_TYPE` on the drag: a JSON array of paths (the file list and the tree send
 * vault-relative paths, the shared `useDragDrop` absolute ones). Pure.
 */

import type { LocalFile } from '@/stores/types'

import { orderableFiles } from './menuTargets'

/** The paths in a drag's `PDM_FILES_DATA_TYPE` data; empty for anything else. */
export function parseDraggedPaths(data: string): string[] {
  if (!data) return []
  try {
    const parsed: unknown = JSON.parse(data)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string' && p !== '') : []
  } catch {
    return []
  }
}

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/**
 * The store's files for dragged paths (relative or absolute, any case or slash), in drag order,
 * and those that can become order lines. A folder is not expanded: the context menu's Add does
 * not expand one either.
 */
export function filesForDraggedPaths(
  paths: readonly string[],
  files: readonly LocalFile[],
): { found: LocalFile[]; orderable: LocalFile[] } {
  const byPath = new Map<string, LocalFile>()
  for (const f of files) {
    byPath.set(norm(f.relativePath), f)
    byPath.set(norm(f.path), f)
  }
  const found: LocalFile[] = []
  const seen = new Set<LocalFile>()
  for (const p of paths) {
    const f = byPath.get(norm(p))
    if (f && !seen.has(f)) {
      seen.add(f)
      found.push(f)
    }
  }
  return { found, orderable: orderableFiles(found) }
}
