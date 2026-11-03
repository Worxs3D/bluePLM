import { resolvePartNumber, resolvedText } from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'
import type { ConfigBomItem, DrawingRefItem } from '@/stores/types'
import type { FileOutputVersion, OutputJob } from '@/stores/slices/outputsSlice'
import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionRelease } from '@/types/releases'
import type { VersionedOutput, VersionOutput } from '@/types/versionOutputs'

import { receivedReports } from '@/features/integrations/solidworks/inspection/reports/receivedModel'
import { fileOutputEntries } from '@/features/source/outputs/outputRowModel'
import { outputKindsForPath } from '@/lib/outputs/kinds'
import { reportHeads } from './childRowStatus'
import { fileSectionExpanded, type FileSectionId } from './fileSections'

import { getFileStatus } from '../../hooks/useFileStatus'
import type { ConfigWithDepth } from '../../types'
import { findLocalFileByPath } from '../../utils/localFileLookup'
import type { ConfigSectionGroup, SelectableRow, VirtualRow } from './rowTypes'

const PART_EXTENSION = '.sldprt'
const ASSEMBLY_EXTENSION = '.sldasm'
const GROUP_ITEM_DEPTH = 1
/** The `configName` of a file-level Drawings / Used in row (no configuration has this name). */
export const SECTION_DRAWINGS = '::drawings'
export const SECTION_USED_IN = '::used-in'
/** Reports listed under an expanded drawing before a "n more" row; the rest are in the Inspection tab. */
export const MAX_DRAWING_REPORT_ROWS = 10

interface ClipboardState {
  files: LocalFile[]
  operation: 'copy' | 'cut'
}

export interface BuildVirtualRowsOptions {
  displayFiles: LocalFile[]
  files: LocalFile[]
  isCreatingFolder: boolean
  selectedFiles: string[]
  clipboard: ClipboardState | null
  dragOverFolder: string | null
  userId: string | undefined
  isBeingProcessed: (path: string) => boolean
  expandedConfigFiles: ReadonlySet<string>
  fileConfigurations: ReadonlyMap<string, ConfigWithDepth[]>
  selectedConfigs: ReadonlySet<string>
  expandedConfigSections: ReadonlySet<string>
  expandedConfigDrawings: ReadonlySet<string>
  configDrawingData: ReadonlyMap<string, DrawingRefItem[]>
  loadingConfigDrawings: ReadonlySet<string>
  expandedConfigBoms: ReadonlySet<string>
  configBomData: ReadonlyMap<string, ConfigBomItem[]>
  loadingConfigBoms: ReadonlySet<string>
  expandedDrawingRefs: ReadonlySet<string>
  drawingRefData: ReadonlyMap<string, DrawingRefItem[]>
  expandedDrawingRefFiles: ReadonlySet<string>
  /** Inspection reports per drawing file id (store `drawingInspectionReports`). */
  drawingInspectionReports?: ReadonlyMap<string, InspectionReport[]>
  /** Version outputs (store `fileOutputVersions`, `fileOutputHeads`, `outputJobs`). */
  outputs?: {
    versions: ReadonlyMap<string, FileOutputVersion>
    heads: ReadonlyMap<string, readonly VersionedOutput[]>
    jobs: ReadonlyMap<string, OutputJob>
    /** Desktop and allowed to generate: show the Generate… row (and failed ghost rows). */
    canGenerate: boolean
    /** Released versions per file id (store `fileReleases`): a released export is listed first. */
    releases?: ReadonlyMap<string, readonly VersionRelease[]>
    /** Outputs per file_version id (store `versionOutputs`): the released versions' exports. */
    versionOutputs?: ReadonlyMap<string, readonly VersionOutput[]>
  }
  /** Chevron sections (`fileSections.ts`; store `fileSectionToggles`, `modelDrawings`, `modelUsedIn`). */
  sections?: {
    toggles: ReadonlySet<string>
    /** part/assembly file id -> drawings that show it; absent until read. */
    modelDrawings: ReadonlyMap<string, readonly DrawingRefItem[]>
    /** part/assembly file id -> assemblies that reference it; absent until read. */
    usedIn: ReadonlyMap<string, readonly DrawingRefItem[]>
  }
}

const NO_SECTIONS: NonNullable<BuildVirtualRowsOptions['sections']> = {
  toggles: new Set(),
  modelDrawings: new Map(),
  usedIn: new Map(),
}

/**
 * A section header, unless the section has nothing (`count` 0) and is not forced visible.
 * Returns whether its rows are to follow (the section is open).
 */
function pushSection(
  rows: VirtualRow[],
  file: LocalFile,
  section: FileSectionId,
  count: number | null,
  toggles: ReadonlySet<string>,
  opts: { show?: boolean; isLoading?: boolean } = {},
): boolean {
  const isExpanded = fileSectionExpanded(toggles, file.path, section)
  if (count === 0 && !opts.show) return false
  rows.push({
    type: 'file-section',
    file,
    section,
    count,
    isExpanded,
    isLoading: opts.isLoading === true,
  })
  return isExpanded
}

/**
 * The Exports section of an expanded file: per kind the released version's export first, then a
 * newer work-in-progress one (`fileOutputEntries`), in-progress and failed rows, then
 * "Generate…" for a user who can generate. A missing kind has no row of its own: Generate… offers it.
 */
export function appendFileOutputRows(
  rows: VirtualRow[],
  file: LocalFile,
  outputs: BuildVirtualRowsOptions['outputs'],
  toggles: ReadonlySet<string> = NO_SECTIONS.toggles,
): void {
  const fileId = file.pdmData?.id
  if (!outputs || !fileId) return
  const latest = outputs.versions.get(fileId)
  const current = latest && latest.version === file.pdmData?.version ? latest : undefined
  const entries = fileOutputEntries(file, {
    latest: current,
    heads: outputs.heads.get(fileId),
    jobs: outputs.jobs,
    canGenerate: outputs.canGenerate,
    releases: outputs.releases?.get(fileId),
    versionOutputs: outputs.versionOutputs,
  }).filter((entry) => entry.state !== 'missing')
  const kinds = outputKindsForPath(file.path)
  const generate = outputs.canGenerate && !!file.pdmData?.version && kinds.length > 0
  const recorded = entries.filter((entry) => entry.output !== null).length
  const loading = outputs.heads.get(fileId) === undefined
  if (entries.length === 0 && !generate) return
  if (!pushSection(rows, file, 'exports', loading ? null : recorded, toggles, { show: true, isLoading: loading })) return
  for (const entry of entries) {
    rows.push({ type: 'file-output', file, entry, version: entry.output?.version ?? file.pdmData?.version ?? null })
  }
  if (generate) rows.push({ type: 'file-generate', file, kinds })
}

/**
 * A drawing's Inspection reports section: the reports that no other supersedes (`reportHeads`;
 * newest first, at most `MAX_DRAWING_REPORT_ROWS`), then a "n more" row. Then its Received
 * inspections section: every report a filled-in workbook came back for (`receivedReports`),
 * superseded ones included. Neither is shown until the reports are read, nor when empty.
 */
export function appendDrawingReportRows(
  rows: VirtualRow[],
  file: LocalFile,
  reports: readonly InspectionReport[] | undefined,
  toggles: ReadonlySet<string> = NO_SECTIONS.toggles,
): void {
  if (!reports || reports.length === 0) return
  const heads = reportHeads(reports)
  if (pushSection(rows, file, 'reports', heads.length, toggles)) {
    for (const report of heads.slice(0, MAX_DRAWING_REPORT_ROWS)) {
      rows.push({ type: 'drawing-report', file, report })
    }
    if (heads.length > MAX_DRAWING_REPORT_ROWS) {
      rows.push({ type: 'drawing-report-more', file, hiddenCount: heads.length - MAX_DRAWING_REPORT_ROWS })
    }
  }
  const received = receivedReports(reports)
  if (pushSection(rows, file, 'received', received.length, toggles)) {
    for (const report of received.slice(0, MAX_DRAWING_REPORT_ROWS)) {
      rows.push({ type: 'drawing-report', file, report, received: true })
    }
  }
}

function appendConfigDrawingRows(
  rows: VirtualRow[],
  selectableRows: SelectableRow[],
  files: LocalFile[],
  selectedFiles: string[],
  file: LocalFile,
  configName: string,
  configDepth: number,
  depth: number,
  items: DrawingRefItem[],
) {
  items.forEach((item) => {
    const drawingFile = findLocalFileByPath(item.file_path, files)
    const selectableIndex = drawingFile ? selectableRows.length : undefined

    rows.push({
      type: 'config-drawing',
      file,
      configName,
      configDepth,
      depth,
      item,
      drawingFile,
      selectableIndex,
      isSelected: drawingFile ? selectedFiles.includes(drawingFile.path) : false,
    })

    if (drawingFile) {
      selectableRows.push({
        path: drawingFile.path,
        file: drawingFile,
      })
    }
  })
}

function appendConfigBomRows(
  rows: VirtualRow[],
  file: LocalFile,
  configName: string,
  configDepth: number,
  items: ConfigBomItem[],
) {
  items.forEach((item) => {
    rows.push({
      type: 'config-bom',
      file,
      configName,
      configDepth,
      depth: GROUP_ITEM_DEPTH,
      item,
    })
  })
}

function appendConfigGroupRows(
  rows: VirtualRow[],
  file: LocalFile,
  configName: string,
  configDepth: number,
  group: ConfigSectionGroup,
  isExpanded: boolean,
  isLoading: boolean,
  items: ConfigBomItem[] | DrawingRefItem[],
) {
  rows.push({
    type: 'config-group',
    file,
    configName,
    configDepth,
    group,
    isExpanded,
    isLoading,
    count: items.length,
  })
}

/**
 * A part's or assembly's Drawings section (drawings that show it, read when the file is expanded)
 * and Used in section (assemblies that reference it, read when the section is first opened). Rows
 * of files in the vault are selectable, like a configuration's drawings.
 */
function appendModelParentRows(
  rows: VirtualRow[],
  selectableRows: SelectableRow[],
  files: LocalFile[],
  selectedFiles: string[],
  file: LocalFile,
  sections: NonNullable<BuildVirtualRowsOptions['sections']>,
): void {
  const fileId = file.pdmData?.id
  if (!fileId) return
  const drawings = sections.modelDrawings.get(fileId)
  if (pushSection(rows, file, 'drawings', drawings ? drawings.length : null, sections.toggles, { isLoading: !drawings })) {
    appendConfigDrawingRows(rows, selectableRows, files, selectedFiles, file, SECTION_DRAWINGS, 0, 0, [...(drawings ?? [])])
  }
  const usedIn = sections.usedIn.get(fileId)
  const usedInOpen = fileSectionExpanded(sections.toggles, file.path, 'usedIn')
  if (
    pushSection(rows, file, 'usedIn', usedIn ? usedIn.length : null, sections.toggles, {
      show: usedInOpen,
      isLoading: usedInOpen && !usedIn,
    })
  ) {
    appendConfigDrawingRows(rows, selectableRows, files, selectedFiles, file, SECTION_USED_IN, 0, 0, [...(usedIn ?? [])])
  }
}

export function buildVirtualRows({
  displayFiles,
  files,
  isCreatingFolder,
  selectedFiles,
  clipboard,
  dragOverFolder,
  userId,
  isBeingProcessed,
  expandedConfigFiles,
  fileConfigurations,
  selectedConfigs,
  expandedConfigSections,
  expandedConfigDrawings,
  configDrawingData,
  loadingConfigDrawings,
  expandedConfigBoms,
  configBomData,
  loadingConfigBoms,
  expandedDrawingRefs,
  drawingRefData,
  expandedDrawingRefFiles,
  drawingInspectionReports,
  outputs,
  sections = NO_SECTIONS,
}: BuildVirtualRowsOptions): { rows: VirtualRow[]; selectableRows: SelectableRow[] } {
  const rows: VirtualRow[] = []
  const selectableRows: SelectableRow[] = []

  if (isCreatingFolder) {
    rows.push({ type: 'new-folder' })
  }

  displayFiles.forEach((file, index) => {
    const diffClass =
      file.diffStatus === 'added'
        ? 'diff-added'
        : file.diffStatus === 'modified'
          ? 'diff-modified'
          : file.diffStatus === 'moved'
            ? 'diff-moved'
            : file.diffStatus === 'moved_away'
              ? 'diff-moved-away'
              : file.diffStatus === 'deleted'
                ? 'diff-deleted'
                : file.diffStatus === 'deleted_remote'
                  ? 'diff-deleted-remote'
                  : file.diffStatus === 'outdated'
                    ? 'diff-outdated'
                    : file.diffStatus === 'cloud'
                      ? 'diff-cloud'
                      : ''

    const isProcessing = isBeingProcessed(file.relativePath)
    const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath
    const isCut =
      clipboard?.operation === 'cut' &&
      clipboard.files.some((clipboardFile) => clipboardFile.path === file.path)
    // Canonical rule (see useFileStatus.ts `canEdit`): checked out by me, or never synced at all.
    // A server row alone is not enough - that excluded local-only files that have never been
    // checked in, even though every other editing surface (DetailsPanel, FileCardMetadata,
    // useFileEditHandlers) already allows them.
    const isEditable = getFileStatus(file, userId).canEdit
    const basePartNumber = resolvedText(resolvePartNumber(file))

    rows.push({
      type: 'file',
      file,
      index,
      isSelected: selectedFiles.includes(file.path),
      isProcessing,
      diffClass,
      isDragTarget,
      isCut,
      isEditable,
      basePartNumber,
    })
    selectableRows.push({
      path: file.path,
      file,
    })

    const { toggles } = sections

    if (expandedDrawingRefs.has(file.path)) {
      const refItems = drawingRefData.get(file.path) || []
      const refsRead = drawingRefData.has(file.path)
      const showRefs = pushSection(rows, file, 'parents', refsRead ? refItems.length : null, toggles, {
        isLoading: !refsRead,
      })
      if (showRefs) refItems.forEach((item) => {
        rows.push({
          type: 'drawing-ref',
          file,
          item,
        })

        const refFileKey = `${file.path}::${item.file_path}`
        if (
          item.configurations &&
          item.configurations.length > 0 &&
          expandedDrawingRefFiles.has(refFileKey)
        ) {
          item.configurations.forEach((configName) => {
            rows.push({
              type: 'drawing-ref-config',
              file,
              configName,
              parentItem: item,
            })
          })
        }
      })

      appendFileOutputRows(rows, file, outputs, toggles)
      const drawingId = file.pdmData?.id
      if (drawingId) appendDrawingReportRows(rows, file, drawingInspectionReports?.get(drawingId), toggles)
    }

    if (!expandedConfigFiles.has(file.path)) return

    const configs = fileConfigurations.get(file.path) || []
    const configRevisions = (file.pdmData?.configuration_revisions || {}) as Record<string, string>
    const extension = file.extension?.toLowerCase()
    const isAssemblyFile = extension === ASSEMBLY_EXTENSION
    const isPartFile = extension === PART_EXTENSION
    const isConfigExpandable = isAssemblyFile || isPartFile
    const configsRead = fileConfigurations.has(file.path)
    const showConfigs = pushSection(rows, file, 'configurations', configsRead ? configs.length : null, toggles, {
      isLoading: !configsRead,
    })

    if (showConfigs) configs.forEach((config) => {
      const configKey = `${file.path}::${config.name}`
      const isExpanded = expandedConfigSections.has(configKey)
      const isDrawingsExpanded = expandedConfigDrawings.has(configKey)
      const isDrawingsLoading = loadingConfigDrawings.has(configKey)
      const isBomExpanded = expandedConfigBoms.has(configKey)
      const isBomLoading = loadingConfigBoms.has(configKey)

      rows.push({
        type: 'config',
        file,
        config,
        isSelected: selectedConfigs.has(configKey),
        isEditable,
        basePartNumber,
        configRevision: configRevisions[config.name],
        isExpandable: isConfigExpandable,
        isExpanded,
        isLoading: isPartFile && isDrawingsLoading,
      })

      if (!isExpanded) return

      const drawingItems = configDrawingData.get(configKey) || []
      const bomItems = configBomData.get(configKey) || []
      const hasDrawingData = configDrawingData.has(configKey)
      const hasBomData = configBomData.has(configKey)

      if (isPartFile) {
        if (isDrawingsLoading) return
        if (!hasDrawingData) return

        if (drawingItems.length > 0) {
          appendConfigDrawingRows(
            rows,
            selectableRows,
            files,
            selectedFiles,
            file,
            config.name,
            config.depth,
            0,
            drawingItems,
          )
        } else {
          rows.push({
            type: 'config-empty',
            file,
            configName: config.name,
            configDepth: config.depth,
            kind: 'drawings',
          })
        }
        return
      }

      if (!isAssemblyFile) return

      appendConfigGroupRows(
        rows,
        file,
        config.name,
        config.depth,
        'drawings',
        isDrawingsExpanded,
        isDrawingsLoading,
        drawingItems,
      )
      appendConfigGroupRows(
        rows,
        file,
        config.name,
        config.depth,
        'ebom',
        isBomExpanded,
        isBomLoading,
        bomItems,
      )

      if (isDrawingsExpanded && !isDrawingsLoading && hasDrawingData) {
        if (drawingItems.length > 0) {
          appendConfigDrawingRows(
            rows,
            selectableRows,
            files,
            selectedFiles,
            file,
            config.name,
            config.depth,
            GROUP_ITEM_DEPTH,
            drawingItems,
          )
        } else {
          rows.push({
            type: 'config-empty',
            file,
            configName: config.name,
            configDepth: config.depth,
            kind: 'drawings',
          })
        }
      }

      if (isBomExpanded && !isBomLoading && hasBomData) {
        if (bomItems.length > 0) {
          appendConfigBomRows(rows, file, config.name, config.depth, bomItems)
        } else {
          rows.push({
            type: 'config-empty',
            file,
            configName: config.name,
            configDepth: config.depth,
            kind: 'ebom',
          })
        }
      }
    })

    appendModelParentRows(rows, selectableRows, files, selectedFiles, file, sections)
    // A part's or assembly's outputs come after its configurations and where it is used, as a
    // drawing's come after its referenced files.
    appendFileOutputRows(rows, file, outputs, toggles)
  })

  return { rows, selectableRows }
}
