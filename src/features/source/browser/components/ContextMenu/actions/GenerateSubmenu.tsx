/**
 * Generate, above Reviews in the file context menu:
 *
 * - On server: outputs recorded against the latest checked-in version, shown under the file and
 *   in the Outputs column (Generate PDF for drawings, Generate STEP for drawings, parts and
 *   assemblies), and for one drawing Inspection report > one entry per template
 *   (`InspectionTemplateItems`). Desktop, explorer edit or admin.
 * - Local: the export options that write ordinary files (PDF, STEP, IGES, STL, DXF, STEP of a
 *   drawing's model, the metadata table of PDF and STEP files), and Inspection report > a
 *   template to build a workbook and save it, recording nothing.
 */
import { Cloud, FileSpreadsheet, HardDrive, Sparkles } from 'lucide-react'

import { generateMenuKinds } from '@/features/source/outputs/outputRowModel'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'

import { ContextMenuGroup } from '../components'
import { ExportActions } from './ExportActions'
import { ExportMetadataTableActions } from './ExportMetadataTableActions'
import { GenerateOutputActions } from './GenerateOutputActions'
import { InspectionTemplateItems } from './InspectionTemplateItems'
import type { ActionComponentProps } from './types'

const SW_EXTENSIONS = new Set(['.sldprt', '.sldasm', '.slddrw'])
const PDF_STEP_EXTENSIONS = new Set(['.pdf', '.step', '.stp', '.stpz', '.p21'])

export function GenerateSubmenu(props: ActionComponentProps) {
  const { contextFiles, multiSelect, firstFile, onClose } = props
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const desktop = hasDesktop()
  const canEdit = getEffectiveRole() === 'admin' || hasPermission('module:explorer', 'edit')

  const counts = generateMenuKinds(contextFiles)
  const oneDrawing =
    !multiSelect &&
    !firstFile?.isDirectory &&
    firstFile?.extension?.toLowerCase() === '.slddrw' &&
    !!firstFile.pdmData?.id &&
    !!firstFile.pdmData.version
  const hasServer = desktop && canEdit && (counts.pdf > 0 || counts.step > 0)
  const hasSwFiles = contextFiles.some((f) => !f.isDirectory && SW_EXTENSIONS.has(f.extension?.toLowerCase() ?? ''))
  const hasTableExport = contextFiles.some(
    (f) => !f.isDirectory && PDF_STEP_EXTENSIONS.has(f.extension?.toLowerCase() ?? ''),
  )
  const hasLocal = (desktop && hasSwFiles) || hasTableExport || oneDrawing

  return (
    <ContextMenuGroup label={t('contextMenu.generate.title')} icon={Sparkles} hasItems={hasServer || hasLocal}>
      <ContextMenuGroup label={t('contextMenu.generate.onServer')} icon={Cloud} hasItems={hasServer} minWidth={200}>
        <GenerateOutputActions {...props} />
        {oneDrawing && canEdit && (
          <ContextMenuGroup label={t('contextMenu.generate.inspectionReport')} icon={FileSpreadsheet} minWidth={240}>
            <InspectionTemplateItems file={firstFile} mode="server" onClose={onClose} />
          </ContextMenuGroup>
        )}
      </ContextMenuGroup>
      <ContextMenuGroup label={t('contextMenu.generate.local')} icon={HardDrive} hasItems={hasLocal} minWidth={200}>
        <ExportMetadataTableActions {...props} />
        {desktop && <ExportActions {...props} />}
        {oneDrawing && (
          <ContextMenuGroup label={t('contextMenu.generate.inspectionReport')} icon={FileSpreadsheet} minWidth={220}>
            <InspectionTemplateItems file={firstFile} mode="local" onClose={onClose} />
          </ContextMenuGroup>
        )}
      </ContextMenuGroup>
    </ContextMenuGroup>
  )
}
