import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import { pickWorkbookFile, readFileBytes } from '@/lib/inspection/reportFiles'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { InspectionReport } from '@/types/inspectionReports'

import { ImportResultsDialog } from './ImportResultsDialog'
import { applyReturned, readReturned, type ReadReturnedOutcome } from './reportActions'
import { deleteReportWithToast, publishReport } from './reportCommands'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface ReportDialogs {
  /** Pick a returned workbook, read it and show what it holds before recording. */
  startImport: (report: InspectionReport) => void
  /** Ask, then delete. */
  askDelete: (report: InspectionReport) => void
  /** Report being read or deleted (for a busy indicator). */
  busyId: string | null
  /** Render once next to the rows. */
  dialogs: ReactNode
}

/**
 * Import results and Delete, with their dialogs, for any list of report rows (the Reports view
 * and the file list's report rows). Results go to the store's list of the drawing.
 */
export function useReportDialogs(onImported?: (report: InspectionReport) => void): ReportDialogs {
  const addToast = usePDMStore((s) => s.addToast)
  const [importing, setImporting] = useState<{
    report: InspectionReport
    read: ReadReturnedOutcome
  } | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [deleting, setDeleting] = useState<InspectionReport | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const startImport = useCallback(
    (report: InspectionReport) => {
      void (async () => {
        setBusyId(report.id)
        try {
          const picked = await pickWorkbookFile()
          if (!picked) return
          setImporting({ report, read: await readReturned(report, await readFileBytes(picked)) })
        } catch (err) {
          log.error('[InspectionReports]', 'Reading a returned workbook failed', {
            reportId: report.id,
            error: errorText(err),
          })
          addToast('error', t('source.inspection.rptImportFailed', { error: errorText(err) }))
        } finally {
          setBusyId(null)
        }
      })()
    },
    [addToast],
  )

  const confirmImport = useCallback(async () => {
    if (!importing) return
    setImportBusy(true)
    try {
      const updated = await applyReturned(importing.report, importing.read)
      publishReport(updated)
      setImporting(null)
      onImported?.(updated)
      addToast(
        'success',
        t('source.inspection.rptImported', { number: updated.reportNumber ?? '' }),
      )
    } catch (err) {
      log.error('[InspectionReports]', 'Import failed', {
        reportId: importing.report.id,
        error: errorText(err),
      })
      addToast('error', t('source.inspection.rptImportFailed', { error: errorText(err) }))
    } finally {
      setImportBusy(false)
    }
  }, [importing, addToast, onImported])

  const confirmDelete = useCallback(async () => {
    const report = deleting
    if (!report) return
    setBusyId(report.id)
    try {
      await deleteReportWithToast(report)
    } finally {
      setBusyId(null)
    }
  }, [deleting])

  // In a portal, and with events stopped, so the dialogs work inside a table row (the file list)
  // without its click and context-menu handlers seeing them.
  const open = !!importing || !!deleting
  const dialogs = !open
    ? null
    : createPortal(
        <div onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
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
            message={t('source.inspection.rptDeleteMessage', {
              number: deleting?.reportNumber ?? '',
            })}
            confirmText={t('common.delete')}
            cancelText={t('common.cancel')}
            variant="danger"
            onConfirm={() => void confirmDelete()}
          />
        </div>,
        document.body,
      )

  return { startImport, askDelete: setDeleting, busyId, dialogs }
}
