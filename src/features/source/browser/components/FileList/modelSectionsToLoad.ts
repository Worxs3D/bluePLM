/**
 * Which parts and assemblies the chevron's Drawings and Used in sections read now. Pure.
 *
 * Drawings are read when the file is expanded (again on each new expansion), so the section can
 * be hidden when there are none. Used in is read when its section is open and not read yet, or
 * when the file is expanded again with the section open. A file id in `inFlight` is skipped.
 */
import { isModelFile } from '@/lib/outputs/kinds'
import type { LocalFile } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'

import { fileSectionExpanded, uniqueParents } from './fileSections'

export interface ModelSectionsToLoad {
  drawings: string[]
  usedIn: string[]
}

export function modelSectionsToLoad(
  files: readonly LocalFile[],
  expanded: ReadonlySet<string>,
  previouslyExpanded: ReadonlySet<string>,
  toggles: ReadonlySet<string>,
  drawingsRead: ReadonlyMap<string, unknown>,
  usedInRead: ReadonlyMap<string, unknown>,
  inFlight: { drawings: ReadonlySet<string>; usedIn: ReadonlySet<string> },
): ModelSectionsToLoad {
  const drawings: string[] = []
  const usedIn: string[] = []
  for (const file of files) {
    if (file.isDirectory || !expanded.has(file.path) || !isModelFile(file.path)) continue
    const id = file.pdmData?.id
    if (!id) continue
    const justExpanded = !previouslyExpanded.has(file.path)
    if (!inFlight.drawings.has(id) && (justExpanded || !drawingsRead.has(id))) drawings.push(id)
    if (
      !inFlight.usedIn.has(id) &&
      fileSectionExpanded(toggles, file.path, 'usedIn') &&
      (justExpanded || !usedInRead.has(id))
    ) {
      usedIn.push(id)
    }
  }
  return { drawings, usedIn }
}

/** A where-used reference row (`getWhereUsed`), as the file list's parent row shape. */
export interface WhereUsedRow {
  id: string
  configuration?: string | null
  parent: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    revision: string | null
    state: string | null
  } | null
}

/** The assemblies among a model's where-used rows, one per assembly, sorted by name. */
export function assembliesUsingModel(refs: readonly WhereUsedRow[]): DrawingRefItem[] {
  const items: DrawingRefItem[] = []
  for (const ref of refs) {
    const parent = ref.parent
    if (!parent || !/\.sldasm$/i.test(parent.file_name || parent.file_path)) continue
    items.push({
      id: ref.id,
      file_id: parent.id,
      file_name: parent.file_name,
      file_path: parent.file_path,
      file_type: 'assembly',
      part_number: parent.part_number,
      description: null,
      revision: parent.revision,
      state: parent.state,
      configuration: ref.configuration ?? null,
      in_database: true,
    })
  }
  return uniqueParents(items)
}
