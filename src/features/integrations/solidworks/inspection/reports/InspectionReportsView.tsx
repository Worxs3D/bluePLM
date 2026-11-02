import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { Button, Callout } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { deleteInspectionReport } from '@/lib/supabase'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import { GenerateReportDialog } from './GenerateReportDialog'
import { ImportResultsDialog } from './ImportResultsDialog'
import { drawingOmittedKey } from '@/lib/inspection/issueText'
import {
  applyReturned,
  downloadReport,
  downloadReturned,
  generateReport,
  openReport,
  readReturned,
  setReportStatus,
  type GeneratePhase,
  type ReadReturnedOutcome,
} from './reportActions'
import { pickWorkbookFile, readFileBytes, type DeliverOutcome } from '@/lib/inspection/reportFiles'
import { canDeleteReport, groupReportsByVersion, type TemplateChoice, type VersionInfo } from './reportModel'
import { ReportRow } from './ReportRow'
import { useInspectionReports } from './useInspectionReports'

interface InspectionReportsViewProps {
  file: LocalFile
  /** Report to expand and scroll to (from the file list's "Show in Inspection tab"). */
  focusReportId?: string | null
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The Reports view of a drawing's Inspection tab: its inspection reports grouped by drawing
 * version, with Generate, Open, Download, Import results, Accept / Reject, Mark sent and Delete.
 */
export function InspectionReportsView({ file, focusReportId }: InspectionReportsViewProps) {
  const user = usePDMStore((s) => s.user)
  const organization = usePDMStore((s) => s.organization)
  const members = usePDMStore((s) => s.members)
  const addToast = usePDMStore((s) => s.addToast)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)

  const fileId = file.pdmData?.id
  const orgId = file.pdmData?.org_id ?? organization?.id
  const isAdmin = getEffectiveRole() === 'admin'
  const canEdit = isAdmin || hasPermission('module:explorer', 'edit')
  const data = useInspectionReports(fileId, orgId)

  const [generateOpen, setGenerateOpen] = useState(false)
  const [phase, setPhase] = useState<GeneratePhase | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [importing, setImporting] = useState<{ report: InspectionReport; read: ReadReturnedOutcome } | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [deleting, setDeleting] = useState<InspectionReport | null>(null)

  const groups = useMemo(() => groupReportsByVersion(data.reports, data.versions), [data.reports, data.versions])

  useEffect(() => {
    if (!focusReportId) return
    setExpanded((prev) => new Set(prev).add(focusReportId))
    const el = document.querySelector(`[data-report-id="${CSS.escape(focusReportId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusReportId, data.reports])

  const nameOf = useCallback(
    (userId: string | null): string => {
      if (!userId) return '—'
      if (userId === user?.id) return user.full_name || user.email || '—'
      const member = members.find((m) => m.id === userId)
      return member?.full_name || member?.email || '—'
    },
    [members, user],
  )

  const deliveredToast = useCallback(
    (outcome: DeliverOutcome) => {
      if (outcome === 'saved') addToast('success', t('source.inspection.rptSaved'))
      else if (outcome === 'downloaded') addToast('info', t('source.inspection.rptDownloaded'))
    },
    [addToast],
  )

  const run = useCallback(
    async (report: InspectionReport, action: () => Promise<void>, failKey: string) => {
      setBusyId(report.id)
      try {
        await action()
      } catch (err) {
        log.error('[InspectionReports]', 'Report action failed', { reportId: report.id, error: errorText(err) })
        addToast('error', t(failKey, { error: errorText(err) }))
      } finally {
        setBusyId(null)
      }
    },
    [addToast],
  )

  const handleOpen = useCallback(
    (report: InspectionReport) =>
      run(report, async () => deliveredToast(await openReport(report)), 'source.inspection.rptOpenFailed'),
    [run, deliveredToast],
  )

  const handleGenerate = useCallback(
    async (template: TemplateChoice, version: VersionInfo) => {
      if (!fileId || !orgId) return
      setPhase('rows')
      try {
        const outcome = await generateReport({
          orgId,
          orgName: organization?.name ?? '',
          fileId,
          drawingName: file.name,
          version,
          template,
          existingReports: data.reports,
          onPhase: setPhase,
        })
        data.addReport(outcome.report)
        setGenerateOpen(false)
        addToast('success', t('source.inspection.rptGenerated', { number: outcome.report.reportNumber ?? '' }), 8000, {
          label: t('source.inspection.rptOpen'),
          onClick: () => void handleOpen(outcome.report),
        })
        if (!outcome.rowsExact) {
          addToast(
            'warning',
            outcome.rowsSourceVersion !== null
              ? t('source.inspection.rptRowsFromVersion', { version: outcome.rowsSourceVersion })
              : t('source.inspection.rptRowsNotExact'),
            10000,
          )
        }
        if (outcome.drawingOmitted) addToast('info', t(drawingOmittedKey(outcome.drawingOmitted)), 10000)
      } catch (err) {
        log.error('[InspectionReports]', 'Generate failed', { fileId, error: errorText(err) })
        addToast('error', t('source.inspection.rptGenerateFailed', { error: errorText(err) }))
      } finally {
        setPhase(null)
      }
    },
    [fileId, orgId, organization?.name, file.name, data, addToast, handleOpen],
  )

  const handleImport = useCallback(
    (report: InspectionReport) =>
      run(
        report,
        async () => {
          const picked = await pickWorkbookFile()
          if (!picked) return
          const read = await readReturned(report, await readFileBytes(picked))
          setImporting({ report, read })
        },
        'source.inspection.rptImportFailed',
      ),
    [run],
  )

  const confirmImport = useCallback(async () => {
    if (!importing) return
    setImportBusy(true)
    try {
      const updated = await applyReturned(importing.report, importing.read)
      data.replaceReport(updated)
      setExpanded((prev) => new Set(prev).add(updated.id))
      setImporting(null)
      addToast('success', t('source.inspection.rptImported', { number: updated.reportNumber ?? '' }))
    } catch (err) {
      log.error('[InspectionReports]', 'Import failed', { reportId: importing.report.id, error: errorText(err) })
      addToast('error', t('source.inspection.rptImportFailed', { error: errorText(err) }))
    } finally {
      setImportBusy(false)
    }
  }, [importing, data, addToast])

  const handleStatus = useCallback(
    (report: InspectionReport, status: InspectionReportStatus) =>
      run(
        report,
        async () => {
          data.replaceReport(await setReportStatus(report, status))
        },
        'source.inspection.rptUpdateFailed',
      ),
    [run, data],
  )

  const confirmDelete = useCallback(async () => {
    const report = deleting
    if (!report) return
    await run(
      report,
      async () => {
        await deleteInspectionReport(report.id)
        data.removeReport(report.id)
        addToast('success', t('source.inspection.rptDeleted', { number: report.reportNumber ?? '' }))
      },
      'source.inspection.rptDeleteFailed',
    )
  }, [deleting, run, data, addToast])

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-plm-border px-3 py-1.5">
        <span className="text-xs text-plm-fg-muted">
          {t('source.inspection.rptCount', { count: data.reports.length })}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={13} />}
          onClick={() => void data.reload()}
          disabled={data.loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
        />
        {canEdit && (
          <Button
            variant="primary"
            size="sm"
            icon={<FileSpreadsheet size={13} />}
            onClick={() => setGenerateOpen(true)}
            disabled={!orgId || data.loading}
          >
            {t('source.inspection.rptGenerate')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {data.error && (
          <div className="p-3">
            <Callout tone="error">{t('source.inspection.rptLoadFailed', { error: data.error })}</Callout>
          </div>
        )}
        {data.loading && data.reports.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-plm-fg/60">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : groups.length === 0 && !data.error ? (
          <div className="flex h-32 flex-col items-center justify-center px-6 text-center text-sm text-plm-fg/60">
            {t('source.inspection.rptEmpty')}
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.fileVersionId}>
              <h3 className="sticky top-0 z-[1] border-b border-plm-border bg-plm-bg-secondary px-3 py-1 text-xs font-medium text-plm-fg-muted">
                {group.version === null
                  ? t('source.inspection.rptUnknownVersion')
                  : group.revision
                    ? t('source.inspection.rptVersionOptionRev', { version: group.version, revision: group.revision })
                    : t('source.inspection.rptVersionOption', { version: group.version })}
              </h3>
              {group.reports.map((report) => (
                <div key={report.id} data-report-id={report.id}>
                  <ReportRow
                    report={report}
                    createdByName={nameOf(report.createdBy)}
                    canEdit={canEdit}
                    canDelete={canDeleteReport(report, user?.id, isAdmin)}
                    busy={busyId === report.id}
                    expanded={expanded.has(report.id)}
                    onToggleExpanded={() => toggleExpanded(report.id)}
                    onOpen={() => void handleOpen(report)}
                    onDownload={() =>
                      void run(report, async () => deliveredToast(await downloadReport(report)), 'source.inspection.rptOpenFailed')
                    }
                    onDownloadReturned={() =>
                      void run(report, async () => deliveredToast(await downloadReturned(report)), 'source.inspection.rptOpenFailed')
                    }
                    onImport={() => void handleImport(report)}
                    onSetStatus={(status) => void handleStatus(report, status)}
                    onDelete={() => setDeleting(report)}
                  />
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      {generateOpen && (
        <GenerateReportDialog
          templates={data.templates}
          versions={data.versions}
          busyPhase={phase}
          onGenerate={(template, version) => void handleGenerate(template, version)}
          onClose={() => setGenerateOpen(false)}
        />
      )}
      {importing && (
        <ImportResultsDialog
          report={importing.report}
          read={importing.read}
          busy={importBusy}
          onConfirm={() => void confirmImport()}
          onClose={() => setImporting(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('source.inspection.rptDeleteTitle')}
        message={t('source.inspection.rptDeleteMessage', { number: deleting?.reportNumber ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}
