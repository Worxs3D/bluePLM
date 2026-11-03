import { memo, useState } from 'react'
import { FileSpreadsheet, MoreHorizontal } from 'lucide-react'

import { Badge } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { formatDateTime } from '@/lib/utils/date'
import { formatFileSize } from '@/lib/utils/format'
import type { LocalFile } from '@/stores/pdmStore'
import type { InspectionReport } from '@/types/inspectionReports'

import { ChildNameCell, ChildText } from './ChildRowParts'
import { showReportInInspectionTab } from './showReportInInspectionTab'
import { statusKey, statusTone } from '@/features/integrations/solidworks/inspection/reports/reportModel'
import { openReportWithToast } from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import { ReportMenu } from '@/features/integrations/solidworks/inspection/reports/ReportMenu'
import { useReportDialogs } from '@/features/integrations/solidworks/inspection/reports/useReportDialogs'

interface DrawingReportRowProps {
  file: LocalFile
  report: InspectionReport
  versionNumber: number | null
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
}


/**
 * An inspection report under an expanded drawing, after its referenced files: number, version,
 * title and status. Click opens the workbook; the context menu is the report menu shared with the
 * Reports view (Open, Regenerate, Save copy, Save next to drawing, Import results, Delete) plus
 * "Show in Inspection tab".
 */
export const DrawingReportRow = memo(function DrawingReportRow({
  file,
  report,
  versionNumber,
  rowHeight,
  visibleColumns,
}: DrawingReportRowProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const dialogs = useReportDialogs()
  const number = report.reportNumber || t('source.inspection.rptUntitled')
  const showsState = visibleColumns.some((c) => c.id === 'state')
  const summary = report.resultsSummary
  const results = summary
    ? t('source.inspection.rptSummary', { pass: summary.pass, fail: summary.fail, blank: summary.blank })
    : null

  return (
    <>
      <tr
        className="drawing-ref-row cursor-pointer hover:bg-plm-bg-light/50"
        style={{ height: rowHeight }}
        onClick={(e) => {
          e.stopPropagation()
          void openReportWithToast(report)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={t('source.inspection.rptOpenRowTitle')}
      >
        {visibleColumns.map((column) => (
          <td key={column.id} style={{ width: column.width }}>
            {column.id === 'name' ? (
              <ChildNameCell
                rowHeight={rowHeight}
                icon={<FileSpreadsheet size={14} className="text-emerald-400" />}
                label={number}
                title={number}
                // The State column carries the status; without it, the name does.
                after={showsState ? null : <Badge tone={statusTone(report.status)}>{t(statusKey(report.status))}</Badge>}
              />
            ) : column.id === 'state' ? (
              <Badge tone={statusTone(report.status)}>{t(statusKey(report.status))}</Badge>
            ) : column.id === 'version' && versionNumber !== null ? (
              <ChildText>{String(versionNumber)}</ChildText>
            ) : column.id === 'description' ? (
              <ChildText title={[report.templateName, results].filter(Boolean).join('\n')}>
                {[report.title || report.templateName, results].filter(Boolean).join(' · ')}
              </ChildText>
            ) : column.id === 'extension' ? (
              <ChildText>xlsx</ChildText>
            ) : column.id === 'size' ? (
              <ChildText>{formatFileSize(report.fileSize)}</ChildText>
            ) : column.id === 'modifiedTime' ? (
              <ChildText>{formatDateTime(report.updatedAt)}</ChildText>
            ) : null}
          </td>
        ))}
      </tr>
      {menu && (
        <ReportMenu
          file={file}
          report={report}
          position={menu}
          reportVersion={versionNumber}
          latestVersion={file.pdmData?.version ?? null}
          onClose={() => setMenu(null)}
          onImport={dialogs.startImport}
          onDelete={dialogs.askDelete}
          onShowInTab={() => showReportInInspectionTab(file, report.id)}
        />
      )}
      {dialogs.dialogs}
    </>
  )
})

/** "n more reports" under an expanded drawing; click opens the Reports view of the drawing. */
export const DrawingReportMoreRow = memo(function DrawingReportMoreRow({
  file,
  hiddenCount,
  rowHeight,
  visibleColumns,
}: {
  file: LocalFile
  hiddenCount: number
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
}) {
  return (
    <tr
      className="drawing-ref-row cursor-pointer hover:bg-plm-bg-light/50"
      style={{ height: rowHeight }}
      onClick={(e) => {
        e.stopPropagation()
        showReportInInspectionTab(file, null)
      }}
    >
      {visibleColumns.map((column) => (
        <td key={column.id} style={{ width: column.width }}>
          {column.id === 'name' ? (
            <ChildNameCell
              rowHeight={rowHeight}
              icon={<MoreHorizontal size={14} className="text-plm-fg-muted" />}
              label={t('source.inspection.rptMoreInTab', { count: hiddenCount })}
              muted
            />
          ) : null}
        </td>
      ))}
    </tr>
  )
})
