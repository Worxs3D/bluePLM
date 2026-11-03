import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ClipboardList, Copy, Download, ExternalLink, FileDown, FolderDown, RefreshCw, Send, Trash2, Upload, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import {
  openReportWithToast,
  regenerateReport,
  saveReportCopy,
  saveReportNextToFile,
} from './reportCommands'
import { canDeleteReport, reportActions } from './reportModel'

export interface ReportMenuProps {
  file: LocalFile
  report: InspectionReport
  position: { x: number; y: number }
  /** Version number of the report's drawing version, when known. */
  reportVersion: number | null
  /** Version number of the drawing's latest checked-in version, when known. */
  latestVersion: number | null
  onClose: () => void
  onImport: (report: InspectionReport) => void
  onDelete: (report: InspectionReport) => void
  /** Shown in the file list, where the Reports view is elsewhere. */
  onShowInTab?: () => void
  /** Status changes (Mark sent, Accept, Reject), offered where the caller can apply them. */
  onSetStatus?: (status: InspectionReportStatus) => void
  /** Save the workbook the supplier returned, offered when there is one. */
  onDownloadReturned?: () => void
}

function Item({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <div
      className={`context-menu-item${danger ? ' danger' : ''}`}
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icon}
      {label}
    </div>
  )
}

/**
 * The menu of one inspection report, the same in the file list (report rows under a drawing) and
 * in the Reports view: Open, Regenerate for version N (only when the drawing has a newer version;
 * the new report replaces this one in the file list), Regenerate as copy (a report of its own),
 * Save copy..., Save next to drawing (desktop), Import results, Delete.
 */
export function ReportMenu(props: ReportMenuProps) {
  const { file, report, onClose } = props
  const user = usePDMStore((s) => s.user)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const isAdmin = getEffectiveRole() === 'admin'
  const canEdit = isAdmin || hasPermission('module:explorer', 'edit')
  const canDelete = canDeleteReport(report, user?.id, isAdmin)
  const actions = reportActions(report.status)
  const newer =
    props.latestVersion !== null && props.reportVersion !== null && props.latestVersion > props.reportVersion
      ? props.latestVersion
      : null

  const run = (fn: () => void) => {
    onClose()
    fn()
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        className="context-menu z-[60]"
        role="menu"
        style={{ left: props.position.x, top: props.position.y }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <Item
          icon={<ExternalLink size={14} />}
          label={t('source.inspection.rptOpen')}
          onClick={() => run(() => void openReportWithToast(report))}
        />
        {/* An up-to-date report is not regenerated in place; "as copy" makes a report of its own. */}
        {canEdit && newer !== null && (
          <Item
            icon={<RefreshCw size={14} />}
            label={t('source.inspection.rptRegenerateFor', { version: newer })}
            onClick={() => run(() => void regenerateReport(file, report, 'latest'))}
          />
        )}
        {canEdit && (
          <Item
            icon={<Copy size={14} />}
            label={t('source.inspection.rptRegenerateAsCopy')}
            onClick={() => run(() => void regenerateReport(file, report, newer !== null ? 'latest' : 'same', { asCopy: true }))}
          />
        )}
        <div className="context-menu-separator" />
        <Item
          icon={<Download size={14} />}
          label={t('source.inspection.rptSaveCopy')}
          onClick={() => run(() => void saveReportCopy(report))}
        />
        {hasDesktop() && (
          <Item
            icon={<FolderDown size={14} />}
            label={t('source.inspection.rptSaveNext')}
            onClick={() => run(() => void saveReportNextToFile(file, report))}
          />
        )}
        {canEdit && actions.importResults && (
          <Item
            icon={<Upload size={14} />}
            label={t('source.inspection.rptImport')}
            onClick={() => run(() => props.onImport(report))}
          />
        )}
        {canEdit && props.onSetStatus && (actions.markSent || actions.accept || actions.reject) && (
          <>
            <div className="context-menu-separator" />
            {actions.markSent && (
              <Item
                icon={<Send size={14} />}
                label={t('source.inspection.rptMarkSent')}
                onClick={() => run(() => props.onSetStatus?.('sent'))}
              />
            )}
            {actions.accept && (
              <Item
                icon={<Check size={14} />}
                label={t('source.inspection.rptAccept')}
                onClick={() => run(() => props.onSetStatus?.('accepted'))}
              />
            )}
            {actions.reject && (
              <Item
                icon={<X size={14} />}
                label={t('source.inspection.rptReject')}
                onClick={() => run(() => props.onSetStatus?.('rejected'))}
              />
            )}
          </>
        )}
        {report.returnedHash && props.onDownloadReturned && (
          <Item
            icon={<FileDown size={14} />}
            label={t('source.inspection.rptDownloadReturned')}
            onClick={() => run(() => props.onDownloadReturned?.())}
          />
        )}
        {props.onShowInTab && (
          <Item
            icon={<ClipboardList size={14} />}
            label={t('source.inspection.rptShowInTab')}
            onClick={() => run(() => props.onShowInTab?.())}
          />
        )}
        {canDelete && (
          <>
            <div className="context-menu-separator" />
            <Item
              icon={<Trash2 size={14} />}
              label={t('common.delete')}
              onClick={() => run(() => props.onDelete(report))}
              danger
            />
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
