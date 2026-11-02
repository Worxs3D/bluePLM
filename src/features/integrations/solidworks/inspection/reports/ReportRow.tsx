import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileDown,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import { Badge, Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import { reportActions, statusKey, statusTone } from './reportModel'
import { ReportResultsDetail } from './ReportResultsDetail'

export interface ReportRowProps {
  report: InspectionReport
  createdByName: string
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onOpen: () => void
  onDownload: () => void
  onDownloadReturned: () => void
  onImport: () => void
  onSetStatus: (status: InspectionReportStatus) => void
  onDelete: () => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** One report: number, title, template, status, results tally, author; actions on the right. */
export function ReportRow(props: ReportRowProps) {
  const { report, canEdit, busy } = props
  const actions = reportActions(report.status)
  const summary = report.resultsSummary
  const hasResults = !!report.results

  return (
    <div className="border-b border-plm-border/60">
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          type="button"
          className="mt-0.5 text-plm-fg-muted hover:text-plm-fg disabled:opacity-30"
          onClick={props.onToggleExpanded}
          disabled={!hasResults}
          title={t('source.inspection.rptShowResults')}
          aria-label={t('source.inspection.rptShowResults')}
          aria-expanded={props.expanded}
        >
          {props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="truncate text-sm font-medium text-plm-fg hover:underline"
              onClick={props.onOpen}
              title={t('source.inspection.rptOpen')}
            >
              {report.reportNumber || t('source.inspection.rptUntitled')}
            </button>
            <Badge tone={statusTone(report.status)}>{t(statusKey(report.status))}</Badge>
            {summary && (
              <span className="text-xs text-plm-fg-muted">
                {t('source.inspection.rptSummary', {
                  pass: summary.pass,
                  fail: summary.fail,
                  blank: summary.blank,
                })}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-plm-fg-muted">
            {[
              report.title,
              report.templateName,
              t('source.inspection.rptCharacteristics', { count: report.characteristicCount }),
              report.drawingPdfHash ? null : t('source.inspection.rptWithoutDrawing'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <div className="truncate text-[11px] text-plm-fg-dim">
            {t('source.inspection.rptCreatedBy', { name: props.createdByName, date: formatDate(report.createdAt) })}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={14} />}
            onClick={props.onOpen}
            disabled={busy}
            title={t('source.inspection.rptOpen')}
            aria-label={t('source.inspection.rptOpen')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Download size={14} />}
            onClick={props.onDownload}
            disabled={busy}
            title={t('source.inspection.rptDownload')}
            aria-label={t('source.inspection.rptDownload')}
          />
          {report.returnedHash && (
            <Button
              variant="ghost"
              size="sm"
              icon={<FileDown size={14} />}
              onClick={props.onDownloadReturned}
              disabled={busy}
              title={t('source.inspection.rptDownloadReturned')}
              aria-label={t('source.inspection.rptDownloadReturned')}
            />
          )}
          {canEdit && actions.markSent && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Send size={14} />}
              onClick={() => props.onSetStatus('sent')}
              disabled={busy}
              title={t('source.inspection.rptMarkSent')}
              aria-label={t('source.inspection.rptMarkSent')}
            />
          )}
          {canEdit && actions.importResults && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Upload size={14} />}
              onClick={props.onImport}
              disabled={busy}
              title={t('source.inspection.rptImport')}
              aria-label={t('source.inspection.rptImport')}
            />
          )}
          {canEdit && actions.accept && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Check size={14} />}
              onClick={() => props.onSetStatus('accepted')}
              disabled={busy}
              title={t('source.inspection.rptAccept')}
              aria-label={t('source.inspection.rptAccept')}
            />
          )}
          {canEdit && actions.reject && (
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={14} />}
              onClick={() => props.onSetStatus('rejected')}
              disabled={busy}
              title={t('source.inspection.rptReject')}
              aria-label={t('source.inspection.rptReject')}
            />
          )}
          {props.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={props.onDelete}
              disabled={busy}
              className="hover:!text-ui-danger"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            />
          )}
        </div>
      </div>
      {props.expanded && hasResults && (
        <div className="bg-plm-bg/40 pb-1 pl-6">
          <ReportResultsDetail results={report.results} />
        </div>
      )}
    </div>
  )
}
