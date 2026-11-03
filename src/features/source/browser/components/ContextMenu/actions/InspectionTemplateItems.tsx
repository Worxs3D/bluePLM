/**
 * The items of Generate > On server / Local > Inspection report for one checked-in drawing: one
 * per available template, read when the submenu opens. On the server side an entry names the
 * report already made from that template and its version: an out-of-date one regenerates for the
 * latest version on click (the new report replaces it), an up-to-date one opens; an entry
 * without a report generates one. "With options..." opens the Reports view's dialog. Locally an
 * entry builds the workbook and saves it where the user chooses, recording nothing.
 */
import { useEffect, useState } from 'react'
import { Check, FileSpreadsheet, History, Loader2, SlidersHorizontal } from 'lucide-react'

import { showReportInInspectionTab } from '@/features/source/browser/components/FileList/showReportInInspectionTab'
import {
  generateFromTemplate,
  loadReportContext,
  openReportWithToast,
  regenerateReport,
  reportTemplateChoices,
  requestGenerateOptions,
  type ReportContext,
} from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import {
  templateMenuEntries,
  type TemplateMenuEntry,
} from '@/features/integrations/solidworks/inspection/reports/templateMenuModel'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

interface Props {
  file: LocalFile
  mode: 'server' | 'local'
  onClose: () => void
}

export function InspectionTemplateItems({ file, mode, onClose }: Props) {
  const [context, setContext] = useState<ReportContext | null>(null)
  const [failed, setFailed] = useState(false)
  const fileId = file.pdmData?.id
  const orgId = file.pdmData?.org_id ?? usePDMStore.getState().organization?.id

  useEffect(() => {
    if (!fileId || !orgId) return
    let live = true
    loadReportContext(fileId, orgId)
      .then((c) => live && setContext(c))
      .catch((err: unknown) => {
        log.warn('[InspectionReports]', 'Templates for the Generate menu unavailable', {
          error: err instanceof Error ? err.message : String(err),
        })
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [fileId, orgId])

  if (!fileId) return null
  if (failed) {
    return <div className="context-menu-item disabled">{t('contextMenu.generate.templatesUnavailable')}</div>
  }
  if (!context) {
    return (
      <div className="context-menu-item disabled">
        <Loader2 size={14} className="animate-spin" />
        {t('contextMenu.generate.loadingTemplates')}
      </div>
    )
  }

  const versionOf = new Map(context.versions.map((v) => [v.id, v.version]))
  const latest = context.versions[0]?.version ?? null
  const entries = templateMenuEntries(reportTemplateChoices(context), context.reports, versionOf, latest)

  const openOptions = () => {
    requestGenerateOptions(fileId)
    showReportInInspectionTab(file, null)
  }
  const pick = (entry: TemplateMenuEntry) => {
    onClose()
    if (mode === 'server' && entry.report) {
      if (entry.stale) void regenerateReport(file, entry.report, 'latest')
      else void openReportWithToast(entry.report)
      return
    }
    void generateFromTemplate(file, entry.choice, { context, toFile: mode === 'local' }).then((r) => {
      if (r === 'needs_options') openOptions()
    })
  }

  return (
    <>
      {entries.map((entry) => {
        const existing = mode === 'server' ? entry.report : null
        const title = existing
          ? entry.stale
            ? t('contextMenu.generate.reportStale', { version: entry.reportVersion ?? '', latest: latest ?? '' })
            : t('contextMenu.generate.reportCurrent', { version: entry.reportVersion ?? '' })
          : mode === 'local'
            ? t('contextMenu.generate.reportToFile')
            : t('contextMenu.generate.reportNew')
        return (
          <div
            key={entry.choice.kind === 'org' ? entry.choice.template.id : `builtin:${entry.choice.key}`}
            className="context-menu-item"
            title={title}
            onClick={() => pick(entry)}
          >
            <FileSpreadsheet size={14} />
            <span className="truncate">{entry.name}</span>
            {existing && (
              <span
                className={`ml-auto flex items-center gap-1 pl-3 text-xs ${entry.stale ? 'text-amber-400' : 'text-plm-fg-muted'}`}
              >
                {entry.stale ? <History size={12} /> : <Check size={12} />}
                {existing.reportNumber || t('contextMenu.generate.reportVersion', { version: entry.reportVersion ?? '' })}
              </span>
            )}
          </div>
        )
      })}
      {mode === 'server' && (
        <>
          <div className="context-menu-separator" />
          <div
            className="context-menu-item"
            onClick={() => {
              onClose()
              openOptions()
            }}
          >
            <SlidersHorizontal size={14} />
            {t('source.inspection.rptGenerateWithOptions')}
          </div>
        </>
      )}
    </>
  )
}
