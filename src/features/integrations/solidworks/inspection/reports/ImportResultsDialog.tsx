import { Upload } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { Button, Callout } from '@/components/core/ui'
import { t } from '@/lib/i18n'

import { returnedIssueText } from '@/lib/inspection/issueText'
import { returnedVerdict, type ReadReturnedOutcome } from './reportActions'
import { summarizeStored } from './reportModel'
import type { InspectionReport } from '@/types/inspectionReports'

interface ImportResultsDialogProps {
  report: InspectionReport
  read: ReadReturnedOutcome
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Most warnings listed before "and n more". */
const MAX_LISTED = 12

/**
 * What a returned workbook holds before it is recorded: the tally and every warning (wrong report,
 * tampered requirements, verdict conflicts, missing rows). A workbook that is not a BluePLM report
 * cannot be recorded, nor one generated for another drawing or drawing version (its measurements
 * would be graded against other requirements). Another report of the same version may be
 * recorded, with a warning, when it holds the same characteristics as this report.
 */
export function ImportResultsDialog({ report, read, busy, onConfirm, onClose }: ImportResultsDialogProps) {
  const summary = summarizeStored(read.stored)
  const warnings = read.parsed.warnings
  const verdict = returnedVerdict(report, read)
  const blocking = verdict.blocked
  const wrongReport = !blocking && verdict.reportIdMismatch
  const tampered = read.stored.rows.filter((r) => r.tampered).length

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={t('source.inspection.rptImportTitle', { number: report.reportNumber ?? '' })}>
      <div className="flex flex-col gap-3 text-sm">
        {!blocking && (
          <div className="grid grid-cols-4 gap-2 text-center">
            {(['total', 'pass', 'fail', 'blank'] as const).map((k) => (
              <div key={k} className="rounded border border-plm-border px-2 py-1.5">
                <div className="text-base font-medium text-plm-fg">{summary[k]}</div>
                <div className="text-[11px] text-plm-fg-muted">{t(`source.inspection.rptCount_${k}`)}</div>
              </div>
            ))}
          </div>
        )}

        {verdict.reason === 'not_a_report' && (
          <Callout tone="error">{t('source.inspection.rptImportBlocked')}</Callout>
        )}
        {verdict.reason === 'other_version' && (
          <Callout tone="error">{t('source.inspection.rptImportOtherVersion')}</Callout>
        )}
        {verdict.reason === 'other_selection' && (
          <Callout tone="error">{t('source.inspection.rptImportOtherSelection')}</Callout>
        )}
        {wrongReport && <Callout tone="warning">{t('source.inspection.rptImportWrongReport')}</Callout>}
        {tampered > 0 && (
          <Callout tone="warning">{t('source.inspection.rptImportTampered', { count: tampered })}</Callout>
        )}
        {!read.rowsExact && <Callout tone="info">{t('source.inspection.rptRowsNotExact')}</Callout>}

        {warnings.length > 0 && (
          <div className="max-h-48 overflow-auto rounded border border-plm-border px-2 py-1.5">
            <ul className="flex flex-col gap-1 text-xs text-plm-fg-muted">
              {warnings.slice(0, MAX_LISTED).map((w, i) => (
                <li key={`${w.code}-${i}`}>{returnedIssueText(w)}</li>
              ))}
              {warnings.length > MAX_LISTED && (
                <li>{t('source.inspection.rptMoreWarnings', { count: warnings.length - MAX_LISTED })}</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={<Upload size={14} />} loading={busy} disabled={blocking} onClick={onConfirm}>
            {wrongReport || tampered > 0
              ? t('source.inspection.rptImportAnyway')
              : t('source.inspection.rptImportConfirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
