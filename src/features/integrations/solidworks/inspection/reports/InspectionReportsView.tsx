import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileSpreadsheet, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react'

import { getOrgUsers } from '@/lib/supabase'

import { Button, Callout } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import { GenerateReportDialog } from './GenerateReportDialog'
import { downloadReturned, setReportStatus, type GeneratePhase } from './reportActions'
import {
  deliveredToast,
  generateForDrawing,
  onGenerateOptionsRequest,
  openReportWithToast,
  takeGenerateOptionsRequest,
} from './reportCommands'
import { groupReportsByVersion, type TemplateChoice, type VersionInfo } from './reportModel'
import { ReportMenu } from './ReportMenu'
import { ReportRow } from './ReportRow'
import { useInspectionReports } from './useInspectionReports'
import { useReportDialogs } from './useReportDialogs'

interface InspectionReportsViewProps {
  file: LocalFile
  /** Report to expand and scroll to (from the file list's "Show in Inspection tab"). */
  focusReportId?: string | null
  /** Drawn first in the header line (the tab's Table / Reports switch), so the view has one toolbar. */
  leading?: ReactNode
}

function reportCount(count: number): string {
  return count === 1 ? t('source.inspection.rptCountOne') : t('source.inspection.rptCountMany', { count })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The Reports view of a drawing's Inspection tab: its inspection reports grouped by drawing
 * version. Generate makes a report at once (default template, latest checked-in version);
 * "Generate with options..." picks both. Each report has the shared report menu (right-click or
 * the more button) and quick Open, Download, Mark sent, Import, Accept / Reject and Delete.
 */
export function InspectionReportsView({ file, focusReportId, leading }: InspectionReportsViewProps) {
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

  const [optionsOpen, setOptionsOpen] = useState(false)
  const [phase, setPhase] = useState<GeneratePhase | null>(null)
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ report: InspectionReport; x: number; y: number } | null>(null)
  const dialogs = useReportDialogs((updated) => setExpanded((prev) => new Set(prev).add(updated.id)))

  const groups = useMemo(() => groupReportsByVersion(data.reports, data.versions), [data.reports, data.versions])
  const versionNumber = useMemo(() => new Map(data.versions.map((v) => [v.id, v.version])), [data.versions])
  const latestVersion = data.versions[0]?.version ?? file.pdmData?.version ?? null

  useEffect(() => {
    if (!focusReportId) return
    setExpanded((prev) => new Set(prev).add(focusReportId))
    const el = document.querySelector(`[data-report-id="${CSS.escape(focusReportId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusReportId, data.reports])

  // "Generate with options..." from the drawing's context menu opens the dialog here.
  useEffect(() => {
    const check = () => {
      if (canEdit && takeGenerateOptionsRequest(fileId)) setOptionsOpen(true)
    }
    check()
    return onGenerateOptionsRequest(check)
  }, [fileId, canEdit])

  // Authors the store's member list does not hold (it loads with the Members settings page): read
  // the organization's users once, so every row names a person.
  const [extraNames, setExtraNames] = useState<Map<string, string>>(() => new Map())
  const missingAuthor = useMemo(
    () =>
      data.reports.some(
        (r) =>
          !!r.createdBy &&
          r.createdBy !== user?.id &&
          !members.some((m) => m.id === r.createdBy) &&
          !extraNames.has(r.createdBy),
      ),
    [data.reports, members, user?.id, extraNames],
  )
  useEffect(() => {
    if (!missingAuthor || !orgId) return
    let cancelled = false
    void getOrgUsers(orgId).then(({ users }) => {
      if (cancelled) return
      const names = new Map<string, string>()
      for (const u of users as Array<{ id: string; full_name: string | null; email: string | null }>) {
        names.set(u.id, u.full_name || u.email || '')
      }
      setExtraNames(names)
    })
    return () => {
      cancelled = true
    }
  }, [missingAuthor, orgId])

  const nameOf = useCallback(
    (userId: string | null): string => {
      if (!userId) return t('source.inspection.rptUnknownAuthor')
      if (userId === user?.id) return user.full_name || user.email || t('source.inspection.rptUnknownAuthor')
      const member = members.find((m) => m.id === userId)
      return member?.full_name || member?.email || extraNames.get(userId) || t('source.inspection.rptUnknownAuthor')
    },
    [members, user, extraNames],
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

  /** Dialog-free: default template, latest checked-in version. */
  const handleQuickGenerate = useCallback(async () => {
    setGenerating(true)
    try {
      // The loaded list when there is one; otherwise the command reads it fresh.
      const loaded = !data.loading && data.versions.length > 0
      await generateForDrawing(file, { context: loaded ? data.context : undefined })
    } finally {
      setGenerating(false)
    }
  }, [file, data.context, data.loading, data.versions.length])

  const handleGenerateWithOptions = useCallback(
    async (template: TemplateChoice, version: VersionInfo) => {
      setPhase('rows')
      setGenerating(true)
      try {
        const report = await generateForDrawing(file, { context: data.context, template, version, onPhase: setPhase })
        if (report) setOptionsOpen(false)
      } finally {
        setPhase(null)
        setGenerating(false)
      }
    },
    [file, data.context],
  )

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

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const empty = !data.loading && groups.length === 0 && !data.error
  const generateButton = canEdit && (
    <Button
      variant="primary"
      size="sm"
      icon={<FileSpreadsheet size={13} />}
      onClick={() => void handleQuickGenerate()}
      loading={generating && !optionsOpen}
      disabled={!orgId || generating}
      title={t('source.inspection.rptGenerateHint')}
    >
      {t('source.inspection.rptGenerate')}
    </Button>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-plm-border px-3">
        {leading}
        <span className="truncate text-[12px] text-ui-fg-secondary">
          {data.reports.length > 0 && reportCount(data.reports.length)}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={13} className={data.loading ? 'animate-spin' : ''} />}
          onClick={() => void data.reload()}
          disabled={data.loading}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
        />
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            icon={<SlidersHorizontal size={13} />}
            onClick={() => setOptionsOpen(true)}
            disabled={!orgId || data.loading || generating}
            title={t('source.inspection.rptGenerateWithOptions')}
          >
            {t('source.inspection.rptOptions')}
          </Button>
        )}
        {!empty && generateButton}
      </div>

      <div className="flex-1 overflow-auto">
        {data.error && (
          <div className="p-3">
            <Callout tone="error">{t('source.inspection.rptLoadFailed', { error: data.error })}</Callout>
          </div>
        )}
        {data.loading && data.reports.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-ui-fg-secondary">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-ui-field text-ui-fg-secondary">
              <FileSpreadsheet size={18} />
            </div>
            <div className="text-[13px] font-medium text-ui-fg">{t('source.inspection.rptEmptyTitle')}</div>
            <div className="max-w-sm text-[12px] leading-5 text-ui-fg-secondary">
              {data.versions.length === 0
                ? t('source.inspection.rptNoVersions')
                : t('source.inspection.rptEmptyBody')}
            </div>
            {data.versions.length > 0 && <div className="mt-2">{generateButton}</div>}
          </div>
        ) : (
          groups.map((group, index) => (
            <section key={group.fileVersionId}>
              <h3 className="sticky top-0 z-[1] flex h-7 items-center gap-2 border-b border-plm-border bg-plm-bg px-3 text-[11px] font-semibold uppercase tracking-wide text-ui-fg-secondary">
                {group.version === null
                  ? t('source.inspection.rptUnknownVersion')
                  : group.revision
                    ? t('source.inspection.rptVersionOptionRev', { version: group.version, revision: group.revision })
                    : t('source.inspection.rptVersionOption', { version: group.version })}
                {index === 0 && group.version !== null && group.version === latestVersion && (
                  <span className="rounded bg-ui-accent/15 px-1.5 py-px text-[10px] font-semibold normal-case tracking-normal text-ui-accent">
                    {t('source.inspection.rptLatest')}
                  </span>
                )}
                <span className="font-normal normal-case tracking-normal text-ui-fg-tertiary">
                  {reportCount(group.reports.length)}
                </span>
              </h3>
              {group.reports.map((report) => (
                <div key={report.id} data-report-id={report.id}>
                  <ReportRow
                    report={report}
                    createdByName={nameOf(report.createdBy)}
                    canEdit={canEdit}
                    busy={busyId === report.id || dialogs.busyId === report.id}
                    expanded={expanded.has(report.id)}
                    onToggleExpanded={() => toggleExpanded(report.id)}
                    onOpen={() => void openReportWithToast(report)}
                    onImport={() => dialogs.startImport(report)}
                    onSetStatus={(status) => void handleStatus(report, status)}
                    onMenu={(x, y) => setMenu({ report, x, y })}
                  />
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      {optionsOpen && (
        <GenerateReportDialog
          templates={data.templates}
          versions={data.versions}
          busyPhase={phase}
          onGenerate={(template, version) => void handleGenerateWithOptions(template, version)}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      {menu && (
        <ReportMenu
          file={file}
          report={menu.report}
          position={{ x: menu.x, y: menu.y }}
          reportVersion={versionNumber.get(menu.report.fileVersionId) ?? null}
          latestVersion={latestVersion}
          onClose={() => setMenu(null)}
          onImport={dialogs.startImport}
          onDelete={dialogs.askDelete}
          onSetStatus={(status) => void handleStatus(menu.report, status)}
          onDownloadReturned={() => {
            const report = menu.report
            void run(report, async () => deliveredToast(await downloadReturned(report)), 'source.inspection.rptOpenFailed')
          }}
        />
      )}
      {dialogs.dialogs}
    </div>
  )
}
