import { memo, useState } from 'react'
import { FileSpreadsheet, Loader2, MoreHorizontal } from 'lucide-react'

import { Badge } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { formatDateTime } from '@/lib/utils/date'
import { formatFileSize } from '@/lib/utils/format'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import { isChildSelected } from '@/features/source/outputs/preview/childPreviewModel'
import { selectChildRow } from '@/features/source/outputs/preview/selectChildRow'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import {
  ChildChip,
  ChildNameCell,
  ChildStaleButton,
  ChildText,
  ParentMetadataText,
} from './ChildRowParts'
import { isParentMetadataColumn, outdatedReportVersion, reportHeads } from './childRowStatus'
import { showReportInInspectionTab } from './showReportInInspectionTab'
import { statusKey, statusTone } from '@/features/integrations/solidworks/inspection/reports/reportModel'
import {
  deliveredToast,
  openReportWithToast,
  publishReport,
  regenerateReport,
} from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import {
  downloadReturned,
  openReturned,
  setReportStatus,
} from '@/features/integrations/solidworks/inspection/reports/reportActions'
import {
  generatedStatus,
  receivedStatus,
} from '@/features/integrations/solidworks/inspection/reports/receivedModel'
import { ReportMenu } from '@/features/integrations/solidworks/inspection/reports/ReportMenu'
import { useReportDialogs } from '@/features/integrations/solidworks/inspection/reports/useReportDialogs'
import { reportTypeTone } from '@/features/integrations/solidworks/inspection/reports/reportTypeModel'
import {
  reportTypeChip,
  reportTypeDetail,
  reportTypeName,
} from '@/features/integrations/solidworks/inspection/reports/reportTypeText'

interface DrawingReportRowProps {
  file: LocalFile
  report: InspectionReport
  versionNumber: number | null
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  /**
   * `generated` (default): a report of the drawing, with its issued / sent status and the stale
   * mark. `received`: a report a filled-in workbook came back for (`receivedReports`), with the
   * return date, returned / accepted / rejected and its results; double-click opens the returned
   * workbook, and the menu has Accept / Reject and Save returned workbook.
   */
  variant?: 'generated' | 'received'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function setStatusWithToast(report: InspectionReport, status: InspectionReportStatus): Promise<void> {
  try {
    publishReport(await setReportStatus(report, status))
  } catch (err) {
    log.error('[InspectionReports]', 'Status change failed', { reportId: report.id, error: errorText(err) })
    usePDMStore.getState().addToast('error', t('source.inspection.rptUpdateFailed', { error: errorText(err) }))
  }
}

async function deliverReturned(report: InspectionReport, open: boolean): Promise<void> {
  try {
    deliveredToast(await (open ? openReturned(report) : downloadReturned(report)))
  } catch (err) {
    log.error('[InspectionReports]', 'Returned workbook failed', { reportId: report.id, error: errorText(err) })
    usePDMStore.getState().addToast('error', t('source.inspection.rptOpenFailed', { error: errorText(err) }))
  }
}


/**
 * An inspection report under an expanded drawing, after its referenced files: number, version,
 * type chip and status; item number, revision and description are the drawing's, as its row shows
 * them, and the report's own details (type detail, title, results) are in the tooltip, with the
 * results as a chip. Click selects it and shows the workbook in the Preview tab
 * (`selectChildRow`); double-click opens it; right-click selects it and has the report menu shared
 * with the Reports view (Open, Regenerate, Save copy, Save next to drawing, Import results,
 * Delete) plus "Show in Inspection tab". The newest report of a type made of an older version has
 * a stale mark at the left that regenerates it for the latest version (`outdatedReportVersion`; a
 * spinner while that runs), and the new report then takes this row's place (`reportHeads`).
 * The `received` variant is the same row for a returned workbook (see the prop).
 */
export const DrawingReportRow = memo(function DrawingReportRow({
  file,
  report,
  versionNumber,
  rowHeight,
  visibleColumns,
  variant = 'generated',
}: DrawingReportRowProps) {
  const received = variant === 'received'
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const dialogs = useReportDialogs()
  const selected = usePDMStore((s) => isChildSelected(s.childSelection, s.selectedFiles, `report:${report.id}`))
  const siblings = usePDMStore((s) => (file.pdmData?.id ? s.drawingInspectionReports.get(file.pdmData.id) : undefined))
  const versionOf = usePDMStore((s) => s.reportVersionNumbers)
  const canEdit = usePDMStore((s) => s.getEffectiveRole() === 'admin' || s.hasPermission('module:explorer', 'edit'))
  const latestVersion = file.pdmData?.version ?? null
  // A received inspection is a record of inspected parts, never out of date.
  const outdatedFor = received
    ? null
    : outdatedReportVersion(report, reportHeads(siblings ?? [report]), versionOf, latestVersion)
  const shownStatus: InspectionReportStatus = received ? receivedStatus(report.status) : generatedStatus(report.status)
  const statusBadge = <Badge tone={statusTone(shownStatus)}>{t(statusKey(shownStatus))}</Badge>
  const regenerating = usePDMStore((s) => s.regeneratingReportIds.has(report.id))
  const target = file.pdmData?.id
    ? ({ kind: 'report', filePath: file.path, fileId: file.pdmData.id, version: versionNumber, report } as const)
    : null
  const number = report.reportNumber || t('source.inspection.rptUntitled')
  const showsState = visibleColumns.some((c) => c.id === 'state')
  // The type chip goes in the Type column, so the name keeps its width for the report number.
  const showsType = visibleColumns.some((c) => c.id === 'extension')
  const typeChip = (
    <Badge tone={reportTypeTone(report.reportType)} title={reportTypeName(report)} className="!px-1 text-[11px]">
      {reportTypeChip(report)}
    </Badge>
  )
  const summary = report.resultsSummary
  const results = summary
    ? t('source.inspection.rptSummary', { pass: summary.pass, fail: summary.fail, blank: summary.blank })
    : null
  // The chip names the type; the tooltip says what distinguishes this report (lot, NCR, scope).
  const details = [
    ...new Set(
      [
        received && report.returnedAt
          ? t('source.inspection.rptReturnedOn', { date: formatDateTime(report.returnedAt) })
          : null,
        reportTypeName(report),
        reportTypeDetail(report, () => null),
        report.title || report.templateName,
        results,
      ].filter((x): x is string => !!x),
    ),
  ]
  const rowTitle = [number, ...details, t('source.outputs.previewReportRowTitle')].join('\n')

  return (
    <>
      <tr
        className={`drawing-ref-row cursor-pointer hover:bg-plm-bg-light/50 ${selected || menu ? 'selected' : ''}`}
        aria-selected={selected}
        style={{ height: rowHeight }}
        onClick={(e) => {
          e.stopPropagation()
          if (target && e.detail < 2) selectChildRow(target)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (received) void deliverReturned(report, true)
          else void openReportWithToast(report)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (target) selectChildRow(target, { reveal: false })
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={rowTitle}
      >
        {visibleColumns.map((column) => (
          <td key={column.id} style={{ width: column.width }}>
            {column.id === 'name' ? (
              <ChildNameCell
                rowHeight={rowHeight}
                icon={
                  regenerating && outdatedFor === null ? (
                    <Loader2 size={14} className="animate-spin text-plm-fg-muted" />
                  ) : (
                    <FileSpreadsheet size={14} className="text-emerald-400" />
                  )
                }
                label={number}
                title={rowTitle}
                status={
                  outdatedFor !== null ? (
                    <ChildStaleButton
                      busy={regenerating}
                      busyTitle={t('source.inspection.rptRegenerating')}
                      title={t(canEdit ? 'source.inspection.rptOutdated' : 'source.inspection.rptOutdatedReadOnly', {
                        version: versionNumber ?? '',
                        latest: outdatedFor,
                      })}
                      onRegenerate={canEdit ? () => void regenerateReport(file, report, 'latest') : undefined}
                    />
                  ) : null
                }
                // Type and status go after the name only when their columns are hidden.
                after={
                  <>
                    {results && <ChildChip title={results}>{results}</ChildChip>}
                    {!showsType && typeChip}
                    {!showsState && statusBadge}
                  </>
                }
              />
            ) : column.id === 'state' ? (
              statusBadge
            ) : column.id === 'version' && versionNumber !== null ? (
              <ChildText>{String(versionNumber)}</ChildText>
            ) : isParentMetadataColumn(column.id) ? (
              <ParentMetadataText file={file} columnId={column.id} />
            ) : column.id === 'extension' ? (
              typeChip
            ) : column.id === 'size' ? (
              <ChildText>{formatFileSize(report.fileSize)}</ChildText>
            ) : column.id === 'modifiedTime' ? (
              <ChildText>{formatDateTime(received ? (report.returnedAt ?? report.updatedAt) : report.updatedAt)}</ChildText>
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
          onSetStatus={received ? (status) => void setStatusWithToast(report, status) : undefined}
          onDownloadReturned={received ? () => void deliverReturned(report, false) : undefined}
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
