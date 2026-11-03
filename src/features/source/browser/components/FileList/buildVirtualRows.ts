import { resolvePartNumber, resolvedText } from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'
import type { ConfigBomItem, DrawingRefItem } from '@/stores/types'
import type { FileOutputVersion, OutputJob } from '@/stores/slices/outputsSlice'
import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionOutput } from '@/types/versionOutputs'

import { fileOutputEntries } from '@/features/source/outputs/outputRowModel'

import { getFileStatus } from '../../hooks/useFileStatus'
import type { ConfigWithDepth } from '../../types'
import { findLocalFileByPath } from '../../utils/localFileLookup'
import type { ConfigSectionGroup, SelectableRow, VirtualRow } from './rowTypes'

const PART_EXTENSION = '.sldprt'
const ASSEMBLY_EXTENSION = '.sldasm'
const GROUP_ITEM_DEPTH = 1
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
  /** Version outputs (store `fileOutputVersions`, `versionOutputs`, `outputJobs`). */
  outputs?: {
    versions: ReadonlyMap<string, FileOutputVersion>
    byVersion: ReadonlyMap<string, VersionOutput[]>
    jobs: ReadonlyMap<string, OutputJob>
    /** Desktop and allowed to generate: show "Generate PDF/STEP" ghost rows. */
    canGenerate: boolean
  }
}

/** The outputs of an expanded file's latest version (and ghost / in-progress rows). */
export function appendFileOutputRows(
  rows: VirtualRow[],
  file: LocalFile,
  outputs: BuildVirtualRowsOptions['outputs'],
): void {
  const fileId = file.pdmData?.id
  if (!outputs || !fileId) return
  const latest = outputs.versions.get(fileId)
  const current = latest && latest.version === file.pdmData?.version ? latest : undefined
  const entries = fileOutputEntries(file, {
    latest: current,
    outputs: current ? outputs.byVersion.get(current.fileVersionId) : undefined,
    jobs: outputs.jobs,
    canGenerate: outputs.canGenerate,
  })
  for (const entry of entries) {
    rows.push({ type: 'file-output', file, entry, version: current?.version ?? null })
  }
}

/** A drawing's reports (newest first, at most `MAX_DRAWING_REPORT_ROWS`), then a "n more" row. */
export function appendDrawingReportRows(
  rows: VirtualRow[],
  file: LocalFile,
  reports: readonly InspectionReport[] | undefined,
): void {
  if (!reports || reports.length === 0) return
  for (const report of reports.slice(0, MAX_DRAWING_REPORT_ROWS)) {
    rows.push({ type: 'drawing-report', file, report })
  }
  if (reports.length > MAX_DRAWING_REPORT_ROWS) {
    rows.push({ type: 'drawing-report-more', file, hiddenCount: reports.length - MAX_DRAWING_REPORT_ROWS })
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

    if (expandedDrawingRefs.has(file.path)) {
      const refItems = drawingRefData.get(file.path) || []
      refItems.forEach((item) => {
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

      appendFileOutputRows(rows, file, outputs)
      const drawingId = file.pdmData?.id
      if (drawingId) appendDrawingReportRows(rows, file, drawingInspectionReports?.get(drawingId))
    }

    if (!expandedConfigFiles.has(file.path)) return

    const configs = fileConfigurations.get(file.path) || []
    const configRevisions = (file.pdmData?.configuration_revisions || {}) as Record<string, string>
    const extension = file.extension?.toLowerCase()
    const isAssemblyFile = extension === ASSEMBLY_EXTENSION
    const isPartFile = extension === PART_EXTENSION
    const isConfigExpandable = isAssemblyFile || isPartFile

    configs.forEach((config) => {
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

    // A part's or assembly's outputs come after its configurations, as a drawing's come after its
    // referenced files.
    appendFileOutputRows(rows, file, outputs)
  })

  return { rows, selectableRows }
}
