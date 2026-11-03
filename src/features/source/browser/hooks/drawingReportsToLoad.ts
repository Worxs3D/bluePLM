import type { LocalFile } from '@/stores/pdmStore'

const DRAWING_EXTENSION = '.slddrw'

/** File ids of expanded drawings to load now: newly expanded, or never loaded. */
export function drawingIdsToLoad(
  files: readonly LocalFile[],
  expanded: ReadonlySet<string>,
  previouslyExpanded: ReadonlySet<string>,
  loaded: ReadonlyMap<string, unknown>,
  inFlight: ReadonlySet<string>,
): string[] {
  const ids: string[] = []
  for (const file of files) {
    if (!expanded.has(file.path)) continue
    if (file.extension?.toLowerCase() !== DRAWING_EXTENSION) continue
    const id = file.pdmData?.id
    if (!id || inFlight.has(id)) continue
    if (!loaded.has(id) || !previouslyExpanded.has(file.path)) ids.push(id)
  }
  return ids
}
