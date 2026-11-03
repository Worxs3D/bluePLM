/**
 * Selecting a version output or an inspection report row under an expanded file, and what its
 * preview in the details panel shows. Pure: the rows, the details panel and the tests call it.
 *
 * Selection model. A child row is not a file, so it never enters `selectedFiles`. Clicking one
 * selects its parent file alone (`selectedFiles = [parent]`, so every file-scoped tab and action
 * keeps working) and records the child together with that exact array as its anchor. The child
 * stays selected only while `selectedFiles` is still that array: any other selection change
 * (a click on any row, the parent included, Ctrl/Shift-click, arrow keys, Select All, a refresh
 * that renames or drops the parent) writes a new array and so deselects the child by itself.
 * No selection code has to know child rows exist.
 */

import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

export type ChildPreviewTarget =
  | {
      kind: 'output'
      /** Local path of the parent file. */
      filePath: string
      fileId: string
      /** Version number the row shows, when known. */
      version: number | null
      output: VersionOutput
    }
  | {
      kind: 'report'
      filePath: string
      fileId: string
      version: number | null
      report: InspectionReport
    }

export interface ChildSelection {
  target: ChildPreviewTarget
  /** The `selectedFiles` array written when the child was selected. */
  anchor: readonly string[]
}

/** Stable identity of a child row: `output:<id>` or `report:<id>`. */
export function childKey(target: ChildPreviewTarget): string {
  return target.kind === 'output' ? `output:${target.output.id}` : `report:${target.report.id}`
}

/** The selected child, or null once the file selection has moved on. */
export function activeChildSelection(
  selection: ChildSelection | null,
  selectedFiles: readonly string[],
): ChildPreviewTarget | null {
  if (!selection || selection.anchor !== selectedFiles) return null
  if (selectedFiles.length !== 1 || selectedFiles[0] !== selection.target.filePath) return null
  return selection.target
}

/** Whether the row with this key is the selected child. */
export function isChildSelected(
  selection: ChildSelection | null,
  selectedFiles: readonly string[],
  key: string,
): boolean {
  const target = activeChildSelection(selection, selectedFiles)
  return target !== null && childKey(target) === key
}

/** Path of the file whose child is selected (that file's own row then shows as not selected). */
export function childSelectionParent(
  selection: ChildSelection | null,
  selectedFiles: readonly string[],
): string | null {
  return activeChildSelection(selection, selectedFiles)?.filePath ?? null
}

// ---------------------------------------------------------------------------
// What the preview shows
// ---------------------------------------------------------------------------

export type ModelFormat = 'step' | 'iges' | 'stl'

export type PreviewKind =
  | { kind: 'pdf' }
  | { kind: 'workbook' }
  | { kind: 'model'; format: ModelFormat }
  /** No viewer for this format (DXF): the preview offers Open. */
  | { kind: 'none' }

export function previewKindForOutput(kind: VersionOutputKind): PreviewKind {
  switch (kind) {
    case 'pdf':
      return { kind: 'pdf' }
    case 'step':
    case 'iges':
    case 'stl':
      return { kind: 'model', format: kind }
    case 'dxf':
      return { kind: 'none' }
  }
}

export function previewKindOf(target: ChildPreviewTarget): PreviewKind {
  return target.kind === 'report' ? { kind: 'workbook' } : previewKindForOutput(target.output.kind)
}

/**
 * Largest content each viewer downloads. A model is tessellated on the renderer thread (no worker
 * is possible under the web build's Trusted Types policy), so it has the lowest cap.
 */
export const PREVIEW_MAX_BYTES: Record<PreviewKind['kind'], number> = {
  pdf: 80 * 1024 * 1024,
  workbook: 40 * 1024 * 1024,
  model: 30 * 1024 * 1024,
  none: 0,
}

export interface PreviewContent {
  /** SHA-256 of the bytes in the vault bucket. */
  hash: string
  /** Recorded size; null when the row does not record it (a returned workbook). */
  size: number | null
  /** For a report: whether this is the workbook the supplier returned. */
  returned: boolean
}

/**
 * The bytes a preview shows: an output's stored file; a report's returned workbook when there is
 * one (it carries the results), else the workbook BluePLM generated.
 */
export function previewContentOf(target: ChildPreviewTarget): PreviewContent {
  if (target.kind === 'output') {
    return { hash: target.output.storageHash, size: target.output.fileSize, returned: false }
  }
  const { report } = target
  if (report.returnedHash) return { hash: report.returnedHash, size: null, returned: true }
  return { hash: report.storageHash, size: report.fileSize, returned: false }
}

/** True when the recorded size is over the viewer's cap (checked before any download). */
export function tooLargeToPreview(kind: PreviewKind['kind'], size: number | null): boolean {
  if (kind === 'none') return false
  return size !== null && size > PREVIEW_MAX_BYTES[kind]
}

/**
 * The live row behind a selection: the store may have re-read the output or report since the
 * click (a new status, a returned workbook). Falls back to the row as it was clicked.
 */
export function resolveLiveTarget(
  target: ChildPreviewTarget,
  live: {
    reportsByFile: ReadonlyMap<string, readonly InspectionReport[]>
    outputsByVersion: ReadonlyMap<string, readonly VersionOutput[]>
  },
): ChildPreviewTarget {
  if (target.kind === 'report') {
    const report = live.reportsByFile.get(target.fileId)?.find((r) => r.id === target.report.id)
    return report && report !== target.report ? { ...target, report } : target
  }
  const output = live.outputsByVersion
    .get(target.output.fileVersionId)
    ?.find((o) => o.id === target.output.id)
  return output && output !== target.output ? { ...target, output } : target
}
