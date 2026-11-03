/**
 * "Generate inspection report" on a checked-in drawing: at once, with the organization's default
 * template and the latest checked-in version; "Generate with options..." opens the drawing's
 * Reports view with the template and version picker.
 */
import { FileSpreadsheet, SlidersHorizontal } from 'lucide-react'

import { showReportInInspectionTab } from '@/features/source/browser/components/FileList/showReportInInspectionTab'
import {
  generateForDrawing,
  requestGenerateOptions,
} from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import type { ActionComponentProps } from './types'

export function InspectionReportActions({ multiSelect, firstFile, onClose }: ActionComponentProps) {
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const canEdit = getEffectiveRole() === 'admin' || hasPermission('module:explorer', 'edit')
  const fileId = firstFile?.pdmData?.id
  const isDrawing = !firstFile?.isDirectory && firstFile?.extension?.toLowerCase() === '.slddrw'
  if (multiSelect || !isDrawing || !fileId || !canEdit) return null

  return (
    <>
      <div
        className="context-menu-item"
        onClick={() => {
          onClose()
          void generateForDrawing(firstFile)
        }}
        title={t('source.inspection.rptGenerateHint')}
      >
        <FileSpreadsheet size={14} />
        {t('source.inspection.rptGenerateFromMenu')}
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onClose()
          requestGenerateOptions(fileId)
          showReportInInspectionTab(firstFile, null)
        }}
      >
        <SlidersHorizontal size={14} />
        {t('source.inspection.rptGenerateWithOptions')}
      </div>
    </>
  )
}
