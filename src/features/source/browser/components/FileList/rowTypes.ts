import type { LocalFile } from '@/stores/pdmStore'
import type { ConfigBomItem, DrawingRefItem } from '@/stores/types'
import type { InspectionReport } from '@/types/inspectionReports'

import type { OutputRowEntry } from '@/features/source/outputs/outputRowModel'

import type { ConfigWithDepth } from '../../types'
import type { FileSectionId } from './fileSections'
import type { VersionOutputKind } from '@/types/versionOutputs'

export interface FileVirtualRow {
  type: 'file'
  file: LocalFile
  index: number
  isSelected: boolean
  isProcessing: boolean
  diffClass: string
  isDragTarget: boolean
  isCut: boolean
  isEditable: boolean
  basePartNumber: string
}

export interface ConfigVirtualRow {
  type: 'config'
  file: LocalFile
  config: ConfigWithDepth
  isSelected: boolean
  isEditable: boolean
  basePartNumber: string
  configRevision?: string
  isExpandable: boolean
  isExpanded: boolean
  isLoading: boolean
}

export interface ConfigBomVirtualRow {
  type: 'config-bom'
  file: LocalFile
  configName: string
  configDepth: number
  depth: number
  item: ConfigBomItem
}

export interface DrawingRefVirtualRow {
  type: 'drawing-ref'
  file: LocalFile
  item: DrawingRefItem
}

/** An inspection report of an expanded drawing, listed after its referenced files. */
export interface DrawingReportVirtualRow {
  type: 'drawing-report'
  file: LocalFile
  report: InspectionReport
  /** Listed in Received inspections (a filled-in workbook came back). */
  received?: boolean
}

/** A section header under an expanded file (`fileSections.ts`): a chevron, a name and a count. */
export interface FileSectionVirtualRow {
  type: 'file-section'
  file: LocalFile
  section: FileSectionId
  /** Null while the content is not read yet. */
  count: number | null
  isExpanded: boolean
  isLoading: boolean
  /** Exports: the kinds a right-click on the header offers to generate (absent: none). */
  generateKinds?: VersionOutputKind[]
}

/** "n more reports" after the first few of an expanded drawing. */
export interface DrawingReportMoreVirtualRow {
  type: 'drawing-report-more'
  file: LocalFile
  hiddenCount: number
}

/** A version output (or a "Generate" ghost) under an expanded file. */
export interface FileOutputVirtualRow {
  type: 'file-output'
  file: LocalFile
  entry: OutputRowEntry
  /** The version number the outputs belong to, when resolved. */
  version: number | null
}

export interface ConfigDrawingVirtualRow {
  type: 'config-drawing'
  file: LocalFile
  configName: string
  configDepth: number
  depth: number
  item: DrawingRefItem
  drawingFile?: LocalFile
  /** Visual selectable-row position; the same drawing path may appear more than once. */
  selectableIndex?: number
  isSelected: boolean
}

export interface SelectableRow {
  path: string
  file: LocalFile
}

export type ConfigSectionGroup = 'drawings' | 'ebom'

export interface ConfigGroupVirtualRow {
  type: 'config-group'
  file: LocalFile
  configName: string
  configDepth: number
  group: ConfigSectionGroup
  isExpanded: boolean
  isLoading: boolean
  count: number
}

export interface ConfigEmptyVirtualRow {
  type: 'config-empty'
  file: LocalFile
  configName: string
  configDepth: number
  kind: ConfigSectionGroup
}

export interface DrawingRefConfigVirtualRow {
  type: 'drawing-ref-config'
  file: LocalFile
  configName: string
  parentItem: DrawingRefItem
}

export interface NewFolderVirtualRow {
  type: 'new-folder'
}

export type VirtualRow =
  | FileVirtualRow
  | ConfigVirtualRow
  | ConfigBomVirtualRow
  | DrawingRefVirtualRow
  | DrawingReportVirtualRow
  | DrawingReportMoreVirtualRow
  | FileOutputVirtualRow
  | FileSectionVirtualRow
  | ConfigDrawingVirtualRow
  | ConfigGroupVirtualRow
  | ConfigEmptyVirtualRow
  | DrawingRefConfigVirtualRow
  | NewFolderVirtualRow
