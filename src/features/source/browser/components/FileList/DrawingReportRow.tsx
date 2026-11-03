import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, Download, ExternalLink, FileSpreadsheet } from 'lucide-react'

import { Badge } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { downloadInspectionContent } from '@/lib/supabase'
import { openWorkbook, saveWorkbook, type DeliverOutcome } from '@/lib/inspection/reportFiles'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport } from '@/types/inspectionReports'

import { showReportInInspectionTab } from './showReportInInspectionTab'
import { reportFileName, statusKey, statusTone } from '@/features/integrations/solidworks/inspection/reports/reportModel'

interface DrawingReportRowProps {
  file: LocalFile
  report: InspectionReport
  versionNumber: number | null
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
}

const INDENT_PX = 24 + 16

function dash() {
  return <span className="text-plm-fg-dim/50 text-[10px]">—</span>
}

async function deliver(report: InspectionReport, save: boolean): Promise<void> {
  const { addToast } = usePDMStore.getState()
  try {
    const bytes = await downloadInspectionContent(report.orgId, report.storageHash)
    const outcome: DeliverOutcome = save
      ? await saveWorkbook(reportFileName(report), bytes)
      : await openWorkbook(reportFileName(report), bytes)
    if (outcome === 'saved') addToast('success', t('source.inspection.rptSaved'))
    else if (outcome === 'downloaded') addToast('info', t('source.inspection.rptDownloaded'))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error('[FileList]', 'Opening an inspection report failed', { reportId: report.id, error })
    addToast('error', t('source.inspection.rptOpenFailed', { error }))
  }
}

/**
 * An inspection report under an expanded drawing, after its referenced files: number, version,
 * title and status. Click opens the workbook; the context menu offers Open, Download and
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

  return (
    <>
      <tr
        className="drawing-ref-row cursor-pointer hover:bg-plm-bg-light/50"
        style={{ height: rowHeight }}
        onClick={(e) => {
          e.stopPropagation()
          void deliver(report, false)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={t('source.inspection.rptOpen')}
      >
        {visibleColumns.map((column) => (
          <td key={column.id} style={{ width: column.width }}>
            {column.id === 'name' ? (
              <div
                className="flex items-center gap-1.5"
                style={{ minHeight: rowHeight - 8, paddingLeft: `${INDENT_PX}px` }}
              >
                <span className="text-plm-fg-dim text-[10px]">├</span>
                <FileSpreadsheet size={12} className="flex-shrink-0 text-emerald-400" />
                <span className="truncate text-xs text-plm-fg-dim">
                  {report.reportNumber || t('source.inspection.rptUntitled')}
                </span>
                {versionNumber !== null && (
                  <span className="flex-shrink-0 rounded bg-plm-bg-light px-1 py-0.5 text-[10px] text-plm-fg-muted">
                    v{versionNumber}
                  </span>
                )}
                <Badge tone={statusTone(report.status)} className="!text-[10px] !leading-3">
                  {t(statusKey(report.status))}
                </Badge>
              </div>
            ) : column.id === 'description' ? (
              report.title ? <span className="truncate text-[10px] text-plm-fg-dim">{report.title}</span> : dash()
            ) : column.id === 'version' ? (
              versionNumber !== null ? <span className="text-[10px] text-plm-fg-dim">{versionNumber}</span> : dash()
            ) : (
              dash()
            )}
          </td>
        ))}
      </tr>
      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={(e) => {
                e.stopPropagation()
                setMenu(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(null)
              }}
            />
            <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(null)
                  void deliver(report, false)
                }}
              >
                <ExternalLink size={14} />
                {t('source.inspection.rptOpen')}
              </div>
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(null)
                  void deliver(report, true)
                }}
              >
                <Download size={14} />
                {t('source.inspection.rptDownload')}
              </div>
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(null)
                  showReportInInspectionTab(file, report.id)
                }}
              >
                <ClipboardList size={14} />
                {t('source.inspection.rptShowInTab')}
              </div>
            </div>
          </>,
          document.body,
        )}
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
            <div
              className="flex items-center gap-1.5"
              style={{ minHeight: rowHeight - 8, paddingLeft: `${INDENT_PX}px` }}
            >
              <span className="text-plm-fg-dim text-[10px]">└</span>
              <span className="truncate text-xs text-plm-fg-muted">
                {t('source.inspection.rptMoreInTab', { count: hiddenCount })}
              </span>
            </div>
          ) : null}
        </td>
      ))}
    </tr>
  )
})
