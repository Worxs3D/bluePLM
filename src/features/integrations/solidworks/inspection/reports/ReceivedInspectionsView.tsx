import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ExternalLink, Inbox, Loader2, RefreshCw, X } from 'lucide-react'

import { Badge, Button, Callout, SegmentedControl } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { getFileVersionNumbers, listInspectionReportsForFiles } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils/date'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import { openReturned, setReportStatus } from './reportActions'
import { deliveredToast, publishReport } from './reportCommands'
import { reportActions, statusKey, statusTone } from './reportModel'
import { reportTypeChip, reportTypeName } from './reportTypeText'
import { reportTypeTone } from './reportTypeModel'
import {
  drawingsInScope,
  filterReceived,
  folderOf,
  NO_RECEIVED_FILTER,
  receivedCounts,
  receivedReports,
  receivedStatus,
  receivedSuppliers,
  type ReceivedFilter,
  type ReceivedStatus,
} from './receivedModel'

type Scope = 'folder' | 'vault'

interface ReceivedInspectionsViewProps {
  /** The selected drawing: its folder is the default scope. */
  file: LocalFile
  /** Drawn first in the header line (the tab's view switch). */
  leading?: ReactNode
}

interface Loaded {
  key: string
  reports: InspectionReport[]
  versionOf: Map<string, number>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const STATUSES: readonly ReceivedStatus[] = ['returned', 'accepted', 'rejected']

/**
 * The Inspection tab's Received view: the reports a filled-in workbook came back for, across the
 * drawings of the selected drawing's folder or of the whole vault (the vault's file list, read in
 * batches through `listInspectionReportsForFiles`, no per-file query), newest return first and
 * listed even when a newer report supersedes theirs (`receivedReports`). Filter by status,
 * supplier, PO and lot; Open returned workbook, Accept and Reject on each row. The list is read
 * when the view opens, the scope changes or Refresh is pressed, and lives only in this view.
 */
export function ReceivedInspectionsView({ file, leading }: ReceivedInspectionsViewProps) {
  const files = usePDMStore((s) => s.files)
  const addToast = usePDMStore((s) => s.addToast)
  const canEdit = usePDMStore((s) => s.getEffectiveRole() === 'admin' || s.hasPermission('module:explorer', 'edit'))

  const [scope, setScope] = useState<Scope>('folder')
  const [filter, setFilter] = useState<ReceivedFilter>(NO_RECEIVED_FILTER)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const folder = folderOf(file.relativePath)
  const drawings = useMemo(() => drawingsInScope(files, scope === 'folder' ? folder : null), [files, scope, folder])
  const drawingIds = useMemo(
    () => [...new Set(drawings.map((d) => d.pdmData?.id).filter((id): id is string => !!id))].sort(),
    [drawings],
  )
  const idsKey = drawingIds.join(',')
  const nameOf = useMemo(() => new Map(drawings.map((d) => [d.pdmData?.id ?? '', d.name])), [drawings])

  useEffect(() => {
    let cancelled = false
    const ids = idsKey ? idsKey.split(',') : []
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const byFile = await listInspectionReportsForFiles(ids)
        const reports = receivedReports([...byFile.values()].flat())
        const versionOf = await getFileVersionNumbers(reports.map((r) => r.fileVersionId))
        if (!cancelled) setLoaded({ key: idsKey, reports, versionOf })
      } catch (err) {
        log.warn('[InspectionReports]', 'Received inspections failed to load', { error: errorText(err) })
        if (!cancelled) setError(errorText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [idsKey, reloadTick])

  const all = useMemo(() => (loaded && loaded.key === idsKey ? loaded.reports : []), [loaded, idsKey])
  const shown = useMemo(() => filterReceived(all, filter), [all, filter])
  const counts = useMemo(() => receivedCounts(all), [all])
  const suppliers = useMemo(() => receivedSuppliers(all), [all])

  const replace = useCallback((updated: InspectionReport) => {
    setLoaded((prev) =>
      prev ? { ...prev, reports: prev.reports.map((r) => (r.id === updated.id ? updated : r)) } : prev,
    )
    publishReport(updated)
  }, [])

  const run = useCallback(
    async (report: InspectionReport, action: () => Promise<void>, failKey: string) => {
      setBusyId(report.id)
      try {
        await action()
      } catch (err) {
        log.error('[InspectionReports]', 'Received inspection action failed', { reportId: report.id, error: errorText(err) })
        addToast('error', t(failKey, { error: errorText(err) }))
      } finally {
        setBusyId(null)
      }
    },
    [addToast],
  )

  const setStatus = (report: InspectionReport, status: InspectionReportStatus) =>
    void run(report, async () => replace(await setReportStatus(report, status)), 'source.inspection.rptUpdateFailed')
  const openWorkbook = (report: InspectionReport) =>
    void run(report, async () => deliveredToast(await openReturned(report)), 'source.inspection.rptOpenFailed')

  const textFilter = (key: 'supplier' | 'po' | 'lot', label: string, listId?: string) => (
    <input
      type="search"
      value={filter[key]}
      onChange={(e) => setFilter((prev) => ({ ...prev, [key]: e.target.value }))}
      placeholder={label}
      aria-label={label}
      list={listId}
      className="h-7 w-28 min-w-0 rounded-md border border-ui-field-border bg-ui-field px-2 text-[12px] text-ui-fg"
    />
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-plm-border px-3">
        {leading}
        <SegmentedControl<Scope>
          size="sm"
          value={scope}
          onChange={setScope}
          aria-label={t('source.inspection.rptRecvScopeLabel')}
          options={[
            { value: 'folder', label: t('source.inspection.rptRecvScopeFolder') },
            { value: 'vault', label: t('source.inspection.rptRecvScopeVault') },
          ]}
        />
        <span className="truncate text-[12px] text-ui-fg-secondary">
          {all.length > 0 &&
            (all.length === 1
              ? t('source.inspection.rptRecvCountOne')
              : t('source.inspection.rptRecvCountMany', { count: all.length }))}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
          onClick={() => setReloadTick((n) => n + 1)}
          disabled={loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
        />
      </div>

      {all.length > 0 && (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-plm-border px-3 py-1">
          <div role="radiogroup" aria-label={t('source.inspection.rptRecvStatusLabel')} className="flex items-center gap-1">
            {(['all', ...STATUSES] as const).map((value) => {
              const selected = filter.status === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setFilter((prev) => ({ ...prev, status: value }))}
                  className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${
                    selected ? 'bg-ui-accent/15 font-medium text-ui-fg' : 'text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg'
                  }`}
                >
                  {value === 'all' ? t('source.inspection.rptRecvStatusAll') : t(statusKey(value))}
                  <span className="tabular-nums text-ui-fg-tertiary">{value === 'all' ? all.length : counts[value]}</span>
                </button>
              )
            })}
          </div>
          <div className="flex-1" />
          {textFilter('supplier', t('source.inspection.rptRecvSupplier'), 'received-suppliers')}
          <datalist id="received-suppliers">
            {suppliers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {textFilter('po', t('source.inspection.rptRecvPo'))}
          {textFilter('lot', t('source.inspection.rptRecvLot'))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {error && (
          <div className="p-3">
            <Callout tone="error">{t('source.inspection.rptLoadFailed', { error })}</Callout>
          </div>
        )}
        {loading && all.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-ui-fg-secondary">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : all.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-ui-field text-ui-fg-secondary">
              <Inbox size={18} />
            </div>
            <div className="text-[13px] font-medium text-ui-fg">{t('source.inspection.rptRecvEmptyTitle')}</div>
            <div className="max-w-sm text-[12px] leading-5 text-ui-fg-secondary">
              {t('source.inspection.rptRecvEmptyBody')}
            </div>
          </div>
        ) : shown.length === 0 && all.length > 0 ? (
          <div className="px-6 py-8 text-center text-[12px] text-ui-fg-secondary">
            {t('source.inspection.rptRecvEmptyFiltered')}
          </div>
        ) : (
          shown.map((report) => {
            const status = receivedStatus(report.status)
            const actions = reportActions(report.status)
            const version = loaded?.versionOf.get(report.fileVersionId)
            const summary = report.resultsSummary
            const meta = [
              report.supplierName,
              report.poNumber && t('source.inspection.rptRecvPoValue', { po: report.poNumber }),
              report.lotNumber && t('source.inspection.rptRecvLotValue', { lot: report.lotNumber }),
            ]
              .filter((x): x is string => !!x)
              .join(' · ')
            const busy = busyId === report.id
            return (
              <div
                key={report.id}
                className="flex min-h-12 items-center gap-3 border-b border-plm-border px-3 py-1.5 hover:bg-ui-hover/50"
                onDoubleClick={() => openWorkbook(report)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2 text-[12px]">
                    <span className="truncate font-medium text-ui-fg">
                      {report.reportNumber || t('source.inspection.rptUntitled')}
                    </span>
                    <Badge tone={reportTypeTone(report.reportType)} title={reportTypeName(report)} className="!px-1 text-[11px]">
                      {reportTypeChip(report)}
                    </Badge>
                    <Badge tone={statusTone(status)}>{t(statusKey(status))}</Badge>
                    {summary && (
                      <span className="shrink-0 rounded bg-ui-field px-1.5 text-[11px] tabular-nums text-ui-fg-secondary">
                        {t('source.inspection.rptSummary', { pass: summary.pass, fail: summary.fail, blank: summary.blank })}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-[11px] text-ui-fg-secondary">
                    <span className="truncate">{nameOf.get(report.fileId) ?? ''}</span>
                    {version !== undefined && (
                      <span className="shrink-0">{t('source.inspection.rptRecvVersion', { version })}</span>
                    )}
                    {report.returnedAt && (
                      <span className="shrink-0">
                        {t('source.inspection.rptReturnedOn', { date: formatDateTime(report.returnedAt) })}
                      </span>
                    )}
                    {meta && <span className="truncate">{meta}</span>}
                  </div>
                </div>
                {busy && <Loader2 size={14} className="shrink-0 animate-spin text-ui-fg-secondary" />}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ExternalLink size={13} />}
                  onClick={() => openWorkbook(report)}
                  disabled={busy}
                  title={t('source.inspection.rptRecvOpenReturned')}
                  aria-label={t('source.inspection.rptRecvOpenReturned')}
                />
                {canEdit && actions.accept && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Check size={13} />}
                    onClick={() => setStatus(report, 'accepted')}
                    disabled={busy}
                    title={t('source.inspection.rptAccept')}
                    aria-label={t('source.inspection.rptAccept')}
                  />
                )}
                {canEdit && actions.reject && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<X size={13} />}
                    onClick={() => setStatus(report, 'rejected')}
                    disabled={busy}
                    title={t('source.inspection.rptRecvReject')}
                    aria-label={t('source.inspection.rptRecvReject')}
                  />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
