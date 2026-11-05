/**
 * The chevron sections under an expanded file (5.9.0). Pure: buildVirtualRows, the section header
 * row and the tests call it.
 *
 * - Part or assembly: Configurations, Drawings (drawings that show it), Used in (assemblies that
 *   reference it; read when the section is first opened), Exports (STEP/IGES/STL, then Generate…).
 * - Drawing: its models (Parent, or Parents for more than one), Exports (PDF, DXF, STEP, then Generate…), Inspection reports, Received inspections.
 *
 * Every section is open by default except Used in. A user's flip is kept per file path and section
 * in session state (`fileSectionToggles`). A section with nothing in it is not shown, except
 * Exports while it has a Generate… row, and a section whose content is not read yet.
 */
import type { DrawingRefItem } from '@/stores/types'

export type FileSectionId =
  | 'configurations'
  | 'drawings'
  | 'usedIn'
  | 'exports'
  | 'parents'
  | 'reports'
  | 'received'

/** Sections that start closed (their content is read when first opened). */
const CLOSED_BY_DEFAULT: ReadonlySet<FileSectionId> = new Set<FileSectionId>(['usedIn'])

export function fileSectionKey(filePath: string, section: FileSectionId): string {
  return `${filePath}::${section}`
}

/** Whether a section is open: its default, flipped when the user toggled it. */
export function fileSectionExpanded(
  toggles: ReadonlySet<string>,
  filePath: string,
  section: FileSectionId,
): boolean {
  const flipped = toggles.has(fileSectionKey(filePath, section))
  return CLOSED_BY_DEFAULT.has(section) ? flipped : !flipped
}

/** The `source.outputs.*` key of a section's name; `count` makes Parent singular for one model. */
export function fileSectionLabelKey(section: FileSectionId, count?: number | null): string {
  switch (section) {
    case 'configurations':
      return 'source.outputs.sectionConfigurations'
    case 'drawings':
      return 'source.outputs.sectionDrawings'
    case 'usedIn':
      return 'source.outputs.sectionUsedIn'
    case 'exports':
      return 'source.outputs.sectionExports'
    case 'reports':
      return 'source.outputs.sectionReports'
    case 'received':
      return 'source.outputs.sectionReceived'
    case 'parents':
      return count === 1 ? 'source.outputs.sectionParent' : 'source.outputs.sectionParents'
  }
}

/**
 * The drawings or assemblies that reference a model, one row per file (a reference row exists
 * per configuration), sorted by name. The configurations a drawing shows are merged.
 */
export function uniqueParents(items: readonly DrawingRefItem[]): DrawingRefItem[] {
  const byFile = new Map<string, DrawingRefItem>()
  for (const item of items) {
    const key = item.file_id || item.file_path
    const known = byFile.get(key)
    if (!known) {
      byFile.set(key, { ...item, configurations: item.configuration ? [item.configuration] : item.configurations })
      continue
    }
    if (item.configuration && !(known.configurations ?? []).includes(item.configuration)) {
      known.configurations = [...(known.configurations ?? []), item.configuration]
    }
  }
  return [...byFile.values()].sort((a, b) => a.file_name.localeCompare(b.file_name))
}
