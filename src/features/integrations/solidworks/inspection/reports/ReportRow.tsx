import {
  Check,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  MoreHorizontal,
  Send,
  Upload,
} from 'lucide-react'

import { Badge, Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/date'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import { nextReportStep, statusKey, statusTone } from './reportModel'
import { ReportResultsDetail } from './ReportResultsDetail'
import { reportTypeTone } from './reportTypeModel'
import { reportTypeChip, reportTypeDetail, reportTypeName } from './reportTypeText'

export interface ReportRowProps {
  report: InspectionReport
  createdByName: string
  canEdit: boolean
  busy: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onOpen: () => void
  onImport: () => void
  onSetStatus: (status: InspectionReportStatus) => void
  /** Open the report menu at a screen position (right-click or the more button). */
  onMenu: (x: number, y: number) => void
  /** Version number of a version id (an FAI's baseline), or null. */
  versionNumberOf: (fileVersionId: string) => number | null
}

/** The report type as a small fixed-width chip, so numbers line up under each other. */
export function ReportTypeChip({ report }: { report: InspectionReport }) {
  return (
    <Badge
      tone={reportTypeTone(report.reportType)}
      className="w-11 justify-center !px-1 text-[11px] tracking-wide"
      title={reportTypeName(report)}
    >
      {reportTypeChip(report)}
    </Badge>
  )
}

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Pass / fail / open as a thin stacked bar and coloured counts; a status line before results. */
function ResultsCell({ report }: { report: InspectionReport }) {
  const s = report.resultsSummary
  if (!s) {
    return (
      <span className="truncate text-[12px] text-ui-fg-tertiary">
        {report.status === 'issued'
          ? t('source.inspection.rptNotSent')
          : t('source.inspection.rptAwaitingResults')}
      </span>
    )
  }
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      title={t('source.inspection.rptSummary', { pass: s.pass, fail: s.fail, blank: s.blank })}
    >
      <div className="flex items-center gap-2 whitespace-nowrap text-[12px] tabular-nums">
        <span className="text-ui-success">
          {t('source.inspection.rptResultPass', { count: s.pass })}
        </span>
        <span className={s.fail > 0 ? 'font-medium text-ui-danger' : 'text-ui-fg-tertiary'}>
          {t('source.inspection.rptResultFail', { count: s.fail })}
        </span>
        {s.blank > 0 && (
          <span className="text-ui-fg-secondary">
            {t('source.inspection.rptResultOpen', { count: s.blank })}
          </span>
        )}
      </div>
      <ResultsBar pass={s.pass} fail={s.fail} blank={s.blank} />
    </div>
  )
}

/**
 * Pass / fail / open as one proportional bar. SVG geometry, not inline widths: the web build's CSP
 * forbids inline styles.
 */
function ResultsBar({ pass, fail, blank }: { pass: number; fail: number; blank: number }) {
  const total = pass + fail + blank
  if (total === 0) return null
  return (
    <svg
      className="h-1 w-28 overflow-hidden rounded-full"
      viewBox={`0 0 ${total} 1`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect x={0} y={0} width={total} height={1} className="fill-ui-field" />
      <rect x={0} y={0} width={pass} height={1} className="fill-ui-success" />
      <rect x={pass} y={0} width={fail} height={1} className="fill-ui-danger" />
      <rect x={pass + fail} y={0} width={blank} height={1} className="fill-ui-fg-tertiary/40" />
    </svg>
  )
}

const NEXT_ICON = {
  markSent: <Send size={13} />,
  importResults: <Upload size={13} />,
  accept: <Check size={13} />,
} as const
const NEXT_LABEL = {
  markSent: 'source.inspection.rptNextMarkSent',
  importResults: 'source.inspection.rptNextImport',
  accept: 'source.inspection.rptNextAccept',
} as const

/**
 * One report as a single aligned line: number and template, status, results, author and time, then
 * the same three action slots on every row (the status's next step, Open, the menu).
 */
export function ReportRow(props: ReportRowProps) {
  const { report, canEdit, busy } = props
  const hasResults = !!report.results
  const next = canEdit ? nextReportStep(report.status) : null

  const runNext = () => {
    if (next === 'markSent') props.onSetStatus('sent')
    else if (next === 'importResults') props.onImport()
    else if (next === 'accept') props.onSetStatus('accepted')
  }

  return (
    <div className="border-b border-plm-border/50">
      <div
        className="group grid min-h-[52px] grid-cols-[20px_minmax(0,1fr)_10.5rem_minmax(0,8.5rem)_auto] items-center gap-x-3 px-3 py-2 hover:bg-ui-hover/50"
        onContextMenu={(e) => {
          e.preventDefault()
          props.onMenu(e.clientX, e.clientY)
        }}
        onDoubleClick={props.onOpen}
      >
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded text-ui-fg-tertiary hover:bg-ui-hover hover:text-ui-fg disabled:invisible"
          onClick={props.onToggleExpanded}
          disabled={!hasResults}
          title={t('source.inspection.rptShowResults')}
          aria-label={t('source.inspection.rptShowResults')}
          aria-expanded={props.expanded}
        >
          <ChevronRight
            size={14}
            className={`transition-transform ${props.expanded ? 'rotate-90' : ''}`}
          />
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <FileSpreadsheet size={18} className="shrink-0 text-ui-success" aria-hidden />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <ReportTypeChip report={report} />
              <span
                className="min-w-0 truncate text-[13px] font-medium text-ui-fg"
                title={report.reportNumber || t('source.inspection.rptUntitled')}
              >
                {report.reportNumber || t('source.inspection.rptUntitled')}
              </span>
              <Badge tone={statusTone(report.status)}>{t(statusKey(report.status))}</Badge>
            </div>
            <div
              className="truncate text-[12px] text-ui-fg-secondary"
              title={[reportTypeName(report), report.templateName, report.notes].filter(Boolean).join('\n') || undefined}
            >
              {[
                reportTypeDetail(report, props.versionNumberOf),
                report.title,
                report.templateName,
                t('source.inspection.rptCharacteristicsShort', {
                  count: report.characteristicCount,
                }),
                report.drawingPdfHash ? null : t('source.inspection.rptWithoutDrawing'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>

        <ResultsCell report={report} />

        <div
          className="flex min-w-0 items-center gap-2"
          title={`${props.createdByName} · ${formatDateTime(report.createdAt)}`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ui-field text-[10px] font-semibold text-ui-fg-secondary">
            {initials(props.createdByName)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12px] text-ui-fg">{props.createdByName}</div>
            <div className="truncate text-[11px] text-ui-fg-tertiary">
              {formatRelativeTime(report.createdAt)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* A fixed slot, so Open and the menu sit in the same place on every row. */}
          <div className="flex w-[7.5rem] justify-end">
            {next && (
              <Button
                size="sm"
                variant="secondary"
                icon={NEXT_ICON[next]}
                onClick={runNext}
                disabled={busy}
              >
                {t(NEXT_LABEL[next])}
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={14} />}
            onClick={props.onOpen}
            loading={busy}
            title={t('source.inspection.rptOpen')}
            aria-label={t('source.inspection.rptOpen')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<MoreHorizontal size={14} />}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              props.onMenu(rect.right - 200, rect.bottom + 2)
            }}
            disabled={busy}
            title={t('source.inspection.rptMore')}
            aria-label={t('source.inspection.rptMore')}
          />
        </div>
      </div>
      {props.expanded && hasResults && (
        <div className="border-t border-plm-border/40 bg-ui-field/40 py-1 pl-10 pr-3">
          <ReportResultsDetail results={report.results} />
        </div>
      )}
    </div>
  )
}
