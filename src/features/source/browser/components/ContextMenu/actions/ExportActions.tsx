/**
 * Export entries for SolidWorks files in the context menu: one flyout per format
 * (`generate.local.step` / `iges` / `stl` / `pdf` / `dxf` / `stepFromDrawing`) and
 * `generate.local.exportOptions`. The format rows of one menu level share the flyout provider, so
 * at most one destination flyout is open, as when they were one component.
 * The exports themselves run in `exports/solidworksExport.ts`, through the queue the export
 * shortcuts share (`exports/quickExport.ts`).
 */
import type { ReactNode } from 'react'
import { Package, FileOutput, Download, Settings, FolderOpen, FolderDown, Zap } from 'lucide-react'
import type { ActionComponentProps } from './types'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'
import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { isSolidWorksAlive } from '@/types/solidworks'
import { ContextSubmenu } from '../components'
import { useFlyout } from '../customizable/flyout'
import type { EntryHookResult } from '../customizable/types'
import { enqueueExport } from '../../../exports/quickExport'
import type { ExportJobKind } from '../../../exports/exportQueue'
import { filesForFormat } from '../../../exports/solidworksExport'
import { SubmenuArrow } from '../components/SubmenuArrow'

type SubmenuKey = ExportJobKind

type ExportEntryId =
  | 'generate.local.step'
  | 'generate.local.iges'
  | 'generate.local.stl'
  | 'generate.local.pdf'
  | 'generate.local.dxf'
  | 'generate.local.stepFromDrawing'
  | 'generate.local.exportOptions'

interface FormatConfig {
  kind: SubmenuKey
  entryId: Exclude<ExportEntryId, 'generate.local.exportOptions'>
  label: string
  colorClass: string
  Icon: typeof Package
  drawings: boolean
}

// Format configurations for each export type
const FORMATS: readonly FormatConfig[] = [
  {
    kind: 'step',
    entryId: 'generate.local.step',
    label: 'Export STEP',
    colorClass: 'text-emerald-400',
    Icon: Package,
    drawings: false,
  },
  {
    kind: 'iges',
    entryId: 'generate.local.iges',
    label: 'Export IGES',
    colorClass: 'text-amber-400',
    Icon: Package,
    drawings: false,
  },
  {
    kind: 'stl',
    entryId: 'generate.local.stl',
    label: 'Export STL',
    colorClass: 'text-violet-400',
    Icon: Package,
    drawings: false,
  },
  {
    kind: 'pdf',
    entryId: 'generate.local.pdf',
    label: 'Export PDF',
    colorClass: 'text-red-400',
    Icon: FileOutput,
    drawings: true,
  },
  {
    kind: 'dxf',
    entryId: 'generate.local.dxf',
    label: 'Export DXF',
    colorClass: 'text-cyan-400',
    Icon: Download,
    drawings: true,
  },
  // Export STEP of the 3D model(s) referenced by selected drawings
  {
    kind: 'step-from-drawing',
    entryId: 'generate.local.stepFromDrawing',
    label: 'Export STEP (Model)',
    colorClass: 'text-emerald-400',
    Icon: Package,
    drawings: true,
  },
]

export function useExportEntries({
  contextFiles,
  onClose,
}: ActionComponentProps): EntryHookResult<ExportEntryId> {
  const { status, hasChecked: swStatusChecked } = useSolidWorksStatus()
  // Treat an unconfirmed status as available so the submenu doesn't disappear
  // before the first poll lands, or while the service is busy with other work.
  const swServiceRunning = !swStatusChecked || isSolidWorksAlive(status)

  // Group by type for display
  const drawingFiles = filesForFormat('pdf', contextFiles)
  const partAsmFiles = filesForFormat('step', contextFiles)

  // Only show on the desktop, when the service is running and we have exportable files
  const show =
    hasDesktop() && (drawingFiles.length > 0 || partAsmFiles.length > 0) && swServiceRunning

  const entries = {} as Record<ExportEntryId, ReactNode | null>
  for (const format of FORMATS) {
    const files = format.drawings ? drawingFiles : partAsmFiles
    entries[format.entryId] =
      show && files.length > 0 ? (
        <ExportFormatEntry format={format} files={files} onClose={onClose} />
      ) : null
  }

  // Export Options link
  entries['generate.local.exportOptions'] = show ? (
    <div
      className="context-menu-item text-plm-fg-muted"
      onClick={() => {
        onClose()
        window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }))
      }}
    >
      <Settings size={14} />
      Export Options...
    </div>
  ) : null

  return { entries }
}

function ExportFormatEntry({
  format,
  files,
  onClose,
}: {
  format: FormatConfig
  files: LocalFile[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const flyout = useFlyout(format.entryId)
  const quickExportFolder = usePDMStore((s) => s.quickExportFolder)
  const { kind, label, colorClass, Icon } = format
  const countLabel = files.length > 1 ? ` (${files.length})` : ''

  const handleExport = (outputFolder?: string) => {
    onClose()
    enqueueExport({ kind, files, outputFolder })
  }

  const handleExportTo = async () => {
    // Open folder picker dialog
    const result = await window.electronAPI?.selectFolder()
    if (result?.success && result.folderPath) {
      handleExport(result.folderPath)
    }
  }

  return (
    <div
      className="context-menu-item relative"
      onMouseEnter={flyout.onMouseEnter}
      onMouseLeave={flyout.onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        flyout.toggle()
      }}
    >
      <Icon size={14} className={colorClass} />
      {label}
      {countLabel}
      <SubmenuArrow />
      {/* Export destination submenu */}
      {flyout.isOpen && (
        <ContextSubmenu
          minWidth={140}
          onMouseEnter={flyout.onMouseEnter}
          onMouseLeave={flyout.onMouseLeave}
        >
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              handleExport()
            }}
          >
            <FolderDown size={14} className={colorClass} />
            Export Here
          </div>
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              handleExportTo()
            }}
          >
            <FolderOpen size={14} className="text-plm-fg-muted" />
            Export To...
          </div>
          {quickExportFolder && (
            <div
              className="context-menu-item"
              title={quickExportFolder}
              onClick={(e) => {
                e.stopPropagation()
                handleExport(quickExportFolder)
              }}
            >
              <Zap size={14} className="text-plm-fg-muted" />
              {t('contextMenu.quickExport.toFolder')}
            </div>
          )}
        </ContextSubmenu>
      )}
    </div>
  )
}
