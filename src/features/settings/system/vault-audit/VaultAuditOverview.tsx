import { AlertTriangle, CheckCircle2, CircleDashed, ShieldCheck } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditView } from '@/types/vaultAudit'

import { formatDuration } from './vaultAuditTiming'
import { hasEvidence } from './vaultAuditView'

interface VaultAuditOverviewProps {
  view: VaultAuditView
  /** Shown by `VaultAuditRunNotes` only. */
  artifactPath?: string | null
}

function unreadLines(view: VaultAuditView): string[] {
  const lines: string[] = []
  const { missingOnDisk, openInSolidWorks, readFailed } = view.unread

  if (openInSolidWorks > 0) {
    lines.push(t('vaultAudit.unread.openInSolidWorks', { count: openInSolidWorks }))
  }
  if (missingOnDisk > 0) {
    lines.push(t('vaultAudit.unread.missingOnDisk', { count: missingOnDisk }))
  }
  if (readFailed > 0) {
    lines.push(t('vaultAudit.unread.readFailed', { count: readFailed }))
  }
  return lines
}

/**
 * Why in-scope files were never opened, one clause per reason.
 *
 * Deliberately worded as "not compared" rather than as anything that sounds like damage: the 6,363
 * single-configuration models a `configuration-recorded` run skips are overwhelmingly fine, and an
 * alarming count over them would be a worse lie than the silence it replaces.
 */
function notComparedLines(view: VaultAuditView): string[] {
  const lines: string[] = []
  const { noConfigurationRecord, beyondLimit } = view.notCompared

  if (noConfigurationRecord > 0) {
    lines.push(t('vaultAudit.notCompared.noConfigurationRecord', { count: noConfigurationRecord }))
  }
  if (beyondLimit > 0) {
    lines.push(t('vaultAudit.notCompared.beyondLimit', { count: beyondLimit }))
  }
  return lines
}

/**
 * What the run is entitled to claim, which is not always what its findings suggest.
 *
 * Three of these four states report zero findings, and only one of them is good news. A run whose
 * scope named no rows, and a run that named rows and opened none of them, both arrive here with an
 * empty findings list and nothing marked uncompared - the shape of a perfect vault. Reading the
 * denominator first is what separates them.
 */
type HeadlineTone = 'empty' | 'clean' | 'partial' | 'findings'

function headlineToneOf(view: VaultAuditView): HeadlineTone {
  // Before anything else: no rows matched, or none of the matched rows were ever compared. Either
  // way the run has no evidence about anything and cannot speak to health.
  if (!hasEvidence(view)) return 'empty'
  if (view.findings.length > 0) return 'findings'
  // "No findings" and "nothing to act on" are different claims, and an empty findings list only
  // supports the first. A `configuration-recorded` run compares roughly one model in seven, so the
  // green tick used to appear over six thousand files nothing had looked at.
  return view.notCompared.total === 0 ? 'clean' : 'partial'
}

function headlineTextOf(view: VaultAuditView, tone: HeadlineTone): string {
  if (tone === 'empty') {
    return view.rowsInScope === 0
      ? t('vaultAudit.result.scopeMatchedNothing')
      : t('vaultAudit.result.comparedNothing', { rows: view.rowsInScope })
  }
  if (tone === 'clean') return t('vaultAudit.result.noFindings')
  if (tone === 'partial') return t('vaultAudit.result.noFindingsInCompared')
  return t('vaultAudit.result.filesWithFindings', {
    files: view.filesWithFindings,
    compared: view.filesCompared,
  })
}

function Stat({
  value,
  label,
  detail,
  tone = 'text-ui-fg',
  title,
}: {
  value: string
  label: string
  detail?: string
  tone?: string
  title?: string
}) {
  return (
    <div className="min-w-0 px-4 py-3" title={title}>
      <div className="text-[12px] text-ui-fg-secondary">{label}</div>
      <div className={`mt-0.5 text-[20px] font-semibold leading-7 tabular-nums ${tone}`}>{value}</div>
      {detail && <div className="truncate text-[12px] text-ui-fg-tertiary">{detail}</div>}
    </div>
  )
}

/**
 * The run in four numbers, then only the sentences that change what the numbers mean (a cancelled
 * run, files that were never compared, a file that changed while being read). Bookkeeping such as
 * the artifact path goes in `VaultAuditRunNotes`, under the details fold.
 */
export function VaultAuditOverview({ view }: VaultAuditOverviewProps) {
  const tone = headlineToneOf(view)
  const notRead = unreadLines(view)
  const notReadTotal = view.unread.missingOnDisk + view.unread.openInSolidWorks + view.unread.readFailed
  const notCompared = notComparedLines(view)
  // Only worth saying when a folder was actually asked for. On a whole-vault run that matched
  // nothing, the path is not the thing to go and check.
  const unmatchedFolderPath =
    tone === 'empty' && view.rowsInScope === 0 ? view.scopeDescription.pathPrefix : null

  return (
    <div className="space-y-3">
      {tone !== 'findings' && (
        <div className="flex items-start gap-2">
          {tone === 'clean' ? (
            <CheckCircle2 size={16} className="text-ui-success mt-0.5 flex-shrink-0" />
          ) : tone === 'empty' ? (
            <AlertTriangle size={16} className="text-ui-warning mt-0.5 flex-shrink-0" />
          ) : (
            <CircleDashed size={16} className="text-ui-fg-secondary mt-0.5 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[14px] text-ui-fg">{headlineTextOf(view, tone)}</p>
            {unmatchedFolderPath && (
              <p className="text-[13px] text-ui-fg-secondary mt-1">
                {t('vaultAudit.result.folderMatchedNothingAnywhere', {
                  path: unmatchedFolderPath,
                  vault: view.scopeDescription.vaultPath,
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {tone !== 'empty' && (
        <div className="grid grid-cols-3 divide-x divide-ui-divider rounded-xl border border-ui-divider bg-ui-nav">
          <Stat
            label={t('vaultAudit.summary.withFindings')}
            value={tone === 'findings' ? String(view.filesWithFindings) : t('vaultAudit.summary.clean')}
            tone={tone === 'findings' ? 'text-ui-warning' : 'text-ui-success'}
            detail={t('vaultAudit.summary.ofCompared', { count: view.filesCompared })}
            title={
              view.filesWithMultipleConfigurations > 0
                ? t('vaultAudit.result.multiConfiguration', {
                    count: view.filesWithMultipleConfigurations,
                  })
                : undefined
            }
          />
          <Stat
            label={t('vaultAudit.summary.notRead')}
            value={String(notReadTotal)}
            tone={notReadTotal > 0 ? 'text-ui-fg' : 'text-ui-fg-secondary'}
            detail={notRead.length > 0 ? notRead.join(' · ') : t('vaultAudit.summary.notReadNone')}
            title={notRead.join(' · ') || undefined}
          />
          <Stat label={t('vaultAudit.summary.duration')} value={formatDuration(view.durationMs)} />
        </div>
      )}

      {view.cancelled && (
        <p className="text-[13px] text-ui-warning flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {t('vaultAudit.result.cancelledNote')}
        </p>
      )}

      {notCompared.length > 0 && (
        <p className="text-[13px] text-ui-fg-secondary">
          {t('vaultAudit.notCompared.heading')}: {notCompared.join(' · ')}
        </p>
      )}

      {tone === 'empty' && notRead.length > 0 && (
        <p className="text-[13px] text-ui-fg-secondary">
          {t('vaultAudit.unread.heading')}: {notRead.join(' · ')}
        </p>
      )}

      {view.integrity.filesChanged > 0 && (
        <p className="text-[13px] text-ui-danger flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {t('vaultAudit.integrity.changed', { count: view.integrity.filesChanged })}
        </p>
      )}
    </div>
  )
}

/** What is worth knowing about the run but changes nothing on the page: under the details fold. */
export function VaultAuditRunNotes({ view, artifactPath }: VaultAuditOverviewProps) {
  return (
    <div className="space-y-2 text-[13px] text-ui-fg-secondary">
      {view.noEvidenceValues > 0 && (
        <p>{t('vaultAudit.result.noEvidence', { count: view.noEvidenceValues })}</p>
      )}
      {view.integrity.filesChanged === 0 && view.integrity.filesHashed > 0 && (
        <p className="flex items-start gap-1.5">
          <ShieldCheck size={13} className="mt-0.5 flex-shrink-0 text-ui-success" />
          {t('vaultAudit.integrity.verified', { count: view.integrity.filesHashed })}
        </p>
      )}
      {artifactPath && (
        <p className="font-mono break-all">{t('vaultAudit.result.artifact', { path: artifactPath })}</p>
      )}
      <p>{t('vaultAudit.result.notStored')}</p>
    </div>
  )
}
