import { lazy, Suspense, useCallback, useMemo, type ReactNode } from 'react'
import { AlertTriangle, Box, Download, ExternalLink, FileSpreadsheet, FileText, Loader2, PenTool, RotateCw } from 'lucide-react'

import { Badge } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { outputKindLabel } from '@/lib/outputs/kinds'
import { hasDesktop } from '@/lib/platform'
import { formatDateTime } from '@/lib/utils/date'
import { formatFileSize } from '@/lib/utils/format'
import { usePDMStore } from '@/stores/pdmStore'
import { PdfAnnotationViewer } from '@/features/source/details/components/PdfAnnotationViewer'
import { openOutput } from '@/features/source/outputs/outputCommands'
import { outputCopyName } from '@/features/source/outputs/outputRowModel'
import { openReportWithToast } from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import { statusKey, statusTone } from '@/features/integrations/solidworks/inspection/reports/reportModel'
import { reportTypeTone } from '@/features/integrations/solidworks/inspection/reports/reportTypeModel'
import { reportTypeChip, reportTypeName } from '@/features/integrations/solidworks/inspection/reports/reportTypeText'

import {
  PREVIEW_MAX_BYTES,
  previewContentOf,
  previewKindOf,
  resolveLiveTarget,
  type ChildPreviewTarget,
  type PreviewKind,
} from './childPreviewModel'
import { usePreviewBytes } from './usePreviewBytes'
import { MAX_WORKBOOK_UNCOMPRESSED_BYTES, zipUncompressedSize } from './zipGuard'

// Viewers load on first use: exceljs, three.js and the tessellator are never in the main bundle.
const WorkbookPreview = lazy(() => import('./WorkbookPreview').then((m) => ({ default: m.WorkbookPreview })))
const ModelPreview = lazy(() => import('./ModelPreview').then((m) => ({ default: m.ModelPreview })))

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-plm-fg-muted">
      {children}
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <Centered>
      <Loader2 size={18} className="animate-spin" />
      {label}
    </Centered>
  )
}

function OpenButton({ onOpen, primary = false }: { onOpen: () => void; primary?: boolean }) {
  const desktop = hasDesktop()
  return (
    <button
      onClick={onOpen}
      className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm shrink-0 gap-1.5`}
      title={desktop ? t('source.outputs.previewOpenTitle') : t('source.outputs.previewDownloadTitle')}
    >
      {desktop ? <ExternalLink size={13} /> : <Download size={13} />}
      {desktop ? t('source.outputs.previewOpen') : t('source.outputs.previewDownload')}
    </button>
  )
}

function KindIcon({ target }: { target: ChildPreviewTarget }) {
  if (target.kind === 'report') return <FileSpreadsheet size={16} className="shrink-0 text-emerald-400" />
  const kind = target.output.kind
  if (kind === 'pdf') return <FileText size={16} className="shrink-0 text-red-400" />
  if (kind === 'dxf') return <PenTool size={16} className="shrink-0 text-amber-400" />
  return <Box size={16} className="shrink-0 text-sky-400" />
}

function Header({ target, onOpen }: { target: ChildPreviewTarget; onOpen: () => void }) {
  const organization = usePDMStore((s) => s.organization)
  const file = usePDMStore((s) => s.files.find((f) => f.path === target.filePath))
  const version = target.version

  let title: string
  const facts: ReactNode[] = []
  if (target.kind === 'output') {
    const { output } = target
    const kind = outputKindLabel(output.kind)
    title = file ? outputCopyName(output, file, organization) : (output.fileName ?? kind)
    facts.push(version !== null ? t('source.outputs.rowDescription', { kind, version }) : kind)
    if (output.configuration) facts.push(t('source.outputs.previewConfiguration', { name: output.configuration }))
    facts.push(formatFileSize(output.fileSize))
    facts.push(t('source.outputs.previewGenerated', { date: formatDateTime(output.generatedAt) }))
  } else {
    const { report } = target
    title = report.reportNumber || t('source.inspection.rptUntitled')
    facts.push(reportTypeName(report))
    if (version !== null) facts.push(t('source.outputs.previewReportVersion', { version }))
    facts.push(
      report.returnedHash && report.returnedAt
        ? t('source.outputs.previewWorkbookReturned', { date: formatDateTime(report.returnedAt) })
        : t('source.outputs.previewWorkbookGenerated', { date: formatDateTime(report.createdAt) }),
    )
  }

  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-plm-border px-3 py-2">
      <div className="mt-0.5">
        <KindIcon target={target} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-plm-fg" title={title}>
            {title}
          </span>
          {target.kind === 'report' && (
            <>
              <Badge tone={reportTypeTone(target.report.reportType)} className="!px-1 text-[11px]">
                {reportTypeChip(target.report)}
              </Badge>
              <Badge tone={statusTone(target.report.status)}>{t(statusKey(target.report.status))}</Badge>
            </>
          )}
          {target.kind === 'output' && target.output.closureExact === false && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400" title={t('source.outputs.rowApproximateTitle')}>
              <AlertTriangle size={12} />
              {t('source.outputs.previewApproximate')}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-plm-fg-muted">{facts.join(' · ')}</div>
        {target.kind === 'report' && <ResultSummary target={target} />}
      </div>
      <OpenButton onOpen={onOpen} />
    </div>
  )
}

function ResultSummary({ target }: { target: Extract<ChildPreviewTarget, { kind: 'report' }> }) {
  const summary = target.report.resultsSummary
  if (!summary) {
    return <div className="mt-1 text-xs text-plm-fg-dim">{t('source.outputs.previewNoResults', { count: target.report.characteristicCount })}</div>
  }
  const pct = (n: number) => (summary.total > 0 ? `${(n / summary.total) * 100}%` : '0%')
  return (
    <div className="mt-1.5 flex items-center gap-3">
      <div className="flex h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-plm-bg-light" aria-hidden="true">
        <div className="bg-emerald-500" style={{ width: pct(summary.pass) }} />
        <div className="bg-red-500" style={{ width: pct(summary.fail) }} />
      </div>
      <span className="text-xs text-emerald-400">{t('source.outputs.previewPass', { count: summary.pass })}</span>
      <span className={`text-xs ${summary.fail > 0 ? 'font-medium text-red-400' : 'text-plm-fg-muted'}`}>
        {t('source.outputs.previewFail', { count: summary.fail })}
      </span>
      <span className="text-xs text-plm-fg-muted">{t('source.outputs.previewOpenCount', { count: summary.blank })}</span>
      <span className="text-xs text-plm-fg-dim">{t('source.outputs.previewOfTotal', { total: summary.total })}</span>
    </div>
  )
}

function kindLabel(target: ChildPreviewTarget): string {
  return target.kind === 'report' ? 'XLSX' : outputKindLabel(target.output.kind)
}

function Body({ target, kind, onOpen }: { target: ChildPreviewTarget; kind: PreviewKind; onOpen: () => void }) {
  const content = previewContentOf(target)
  const { state, retry } = usePreviewBytes(content, kind.kind)
  const pdfFilePath = `blueplm-preview:${content.hash}.pdf`
  const readPdf = useCallback(
    async () => (state.status === 'ready' ? { success: true, bytes: state.bytes } : { success: false }),
    [state],
  )
  // A workbook is checked for what it expands to before anything parses it (zip bomb).
  const expanded = useMemo(
    () => (kind.kind === 'workbook' && state.status === 'ready' ? zipUncompressedSize(state.bytes) : null),
    [kind.kind, state],
  )

  if (kind.kind === 'none') {
    return (
      <Centered>
        <PenTool size={32} className="opacity-40" />
        <div>{t('source.outputs.previewNone', { kind: kindLabel(target) })}</div>
        <div className="text-xs opacity-70">{t('source.outputs.previewNoneHint')}</div>
        <div className="mt-2">
          <OpenButton onOpen={onOpen} primary />
        </div>
      </Centered>
    )
  }
  switch (state.status) {
    case 'loading':
      return <Spinner label={t('source.outputs.previewLoading')} />
    case 'unavailable':
      return <Centered>{t('source.outputs.previewUnavailable')}</Centered>
    case 'tooLarge':
      return (
        <Centered>
          <div>
            {t('source.outputs.previewTooLarge', {
              kind: kindLabel(target),
              size: formatFileSize(state.size),
              max: formatFileSize(PREVIEW_MAX_BYTES[kind.kind]),
            })}
          </div>
          <div className="mt-2">
            <OpenButton onOpen={onOpen} primary />
          </div>
        </Centered>
      )
    case 'error':
      return (
        <Centered>
          <span className="text-plm-error">{t('source.outputs.previewFailed', { error: state.message })}</span>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-secondary btn-sm gap-1.5" onClick={retry}>
              <RotateCw size={13} />
              {t('source.outputs.previewRetry')}
            </button>
            <OpenButton onOpen={onOpen} />
          </div>
        </Centered>
      )
    case 'ready':
      if (expanded && !expanded.ok) {
        return (
          <Centered>
            <div>
              {expanded.reason === 'notZip'
                ? t('source.outputs.previewNotWorkbook')
                : t('source.outputs.previewWorkbookTooLarge', { max: formatFileSize(MAX_WORKBOOK_UNCOMPRESSED_BYTES) })}
            </div>
            <div className="mt-2">
              <OpenButton onOpen={onOpen} primary />
            </div>
          </Centered>
        )
      }
      if (kind.kind === 'pdf') {
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <PdfAnnotationViewer
              key={content.hash}
              filePath={pdfFilePath}
              fileName={pdfFilePath}
              readData={readPdf}
              initialScale="page-fit"
              onOpenExternally={onOpen}
            />
          </div>
        )
      }
      return (
        <Suspense fallback={<Spinner label={t('source.outputs.previewLoading')} />}>
          {kind.kind === 'workbook' ? (
            <WorkbookPreview key={content.hash} bytes={state.bytes} />
          ) : (
            <ModelPreview key={content.hash} bytes={state.bytes} format={kind.format} />
          )}
        </Suspense>
      )
  }
}

/**
 * The Preview tab for a selected output or inspection report row: what it is (name, version,
 * status, results) above a viewer for its stored bytes: the PDF viewer the Preview tab uses for
 * PDFs, a read-only workbook render, or a 3D view. DXF has no viewer and offers Open.
 */
export function ChildPreview({ target: clicked }: { target: ChildPreviewTarget }) {
  const reportsByFile = usePDMStore((s) => s.drawingInspectionReports)
  const outputsByVersion = usePDMStore((s) => s.versionOutputs)
  const target = useMemo(
    () => resolveLiveTarget(clicked, { reportsByFile, outputsByVersion }),
    [clicked, reportsByFile, outputsByVersion],
  )
  const kind = useMemo(() => previewKindOf(target), [target])

  const onOpen = useCallback(() => {
    if (target.kind === 'report') {
      void openReportWithToast(target.report)
      return
    }
    const file = usePDMStore.getState().files.find((f) => f.path === target.filePath)
    if (file) void openOutput(file, target.output)
  }, [target])

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded border border-plm-border bg-plm-panel">
      <Header target={target} onOpen={onOpen} />
      <Body target={target} kind={kind} onOpen={onOpen} />
    </div>
  )
}
