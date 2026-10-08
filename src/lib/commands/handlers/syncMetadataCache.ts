/**
 * Cached "which drawings reference this configuration" rows, as Sync Metadata leaves them.
 *
 * `configDrawingData` is keyed `${file.path}::${configName}` and, once a key exists, the config
 * rows never ask again (`toggleConfigDrawingExpansion` returns early). So a sync that changes
 * what a part's rows would say - a drawing corrected from its parent, a part written - left the
 * old answer on screen until the app restarted, and "Run Sync Metadata" looked like it did nothing.
 */

import { usePDMStore } from '../../../stores/pdmStore'
import { normalizePath } from '@/lib/solidworks/pathMatching'

const CONFIG_KEY_SEPARATOR = '::'

/** The part/assembly paths whose cached rows a sync run may have made stale. */
export function collectStaleConfigPaths(
  processedPartPaths: readonly string[],
  parentModelPaths: readonly (string | null | undefined)[],
): Set<string> {
  const paths = new Set<string>()
  for (const path of processedPartPaths) paths.add(normalizePath(path))
  for (const path of parentModelPaths) {
    if (path) paths.add(normalizePath(path))
  }
  return paths
}

/** Drops the cached config drawing rows of every path in `stalePaths`. Returns how many went. */
export function evictConfigDrawingRows(stalePaths: ReadonlySet<string>): number {
  if (stalePaths.size === 0) return 0

  const { configDrawingData, clearConfigDrawingData } = usePDMStore.getState()
  let evicted = 0

  for (const configKey of Array.from(configDrawingData.keys())) {
    const separatorIndex = configKey.indexOf(CONFIG_KEY_SEPARATOR)
    if (separatorIndex === -1) continue

    if (stalePaths.has(normalizePath(configKey.substring(0, separatorIndex)))) {
      clearConfigDrawingData(configKey)
      evicted++
    }
  }

  return evicted
}
