/**
 * Report commands shared by every surface that offers them: the drawing's file context menu
 * ("Generate inspection report"), the Inspection tab's Reports view, and the report rows under a
 * drawing in the file list. Generate runs without a dialog (default template, latest checked-in
 * version); "Generate with options..." opens the Reports view's dialog instead.
 *
 * Each command reads what it needs fresh from the server, reports through toasts, and writes the
 * drawing's report list to the store (`drawingInspectionReports`), which the Reports view and the
 * file list both follow. Nothing here is kept between calls except the in-flight set below, which
 * holds a drawing only while its report is being generated.
 */
import { t } from '@/lib/i18n'
import { builtInTemplateNames, drawingOmittedKey } from '@/lib/inspection/issueText'
import type { DeliverOutcome } from '@/lib/inspection/reportFiles'
import { log } from '@/lib/logger'
import {
  deleteInspectionReport,
  getFileVersions,
  listInspectionReports,
  listInspectionTemplates,
} from '@/lib/supabase'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport, InspectionTemplate } from '@/types/inspectionReports'

import {
  downloadReport,
  generateReport,
  openReport,
  ReportHasNoRowsError,
  saveReportNextToDrawing,
  type GeneratePhase,
} from './reportActions'
import {
  defaultTemplateChoice,
  hasChangesNotCheckedIn,
  regenerateTemplateChoice,
  reportNamingFromSettings,
  templateChoices,
  type TemplateChoice,
  type VersionInfo,
} from './reportModel'
import { liveInspectionRowCount, organizationLogo, reportIdentity } from './reportSources'

export interface ReportContext {
  reports: InspectionReport[]
  /** Checked-in versions, newest first. */
  versions: VersionInfo[]
  templates: InspectionTemplate[]
}

interface FileVersionRow {
  id: string
  version: number
  revision: string | null
  part_number: string | null
  description: string | null
  created_at: string | null
}

export function toVersionInfo(row: FileVersionRow): VersionInfo {
  return {
    id: row.id,
    version: row.version,
    revision: row.revision ?? null,
    partNumber: row.part_number ?? null,
    description: row.description ?? null,
    createdAt: row.created_at ?? null,
  }
}

const PHASES: readonly GeneratePhase[] = ['rows', 'template', 'drawing', 'workbook', 'upload', 'record']

/** Drawings whose report is being generated right now (one at a time per drawing). */
const generating = new Set<string>()

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The drawing's reports, versions and the organization's templates, read fresh. */
export async function loadReportContext(fileId: string, orgId: string): Promise<ReportContext> {
  const [reports, versionResult, templates] = await Promise.all([
    listInspectionReports(fileId),
    getFileVersions(fileId),
    listInspectionTemplates(orgId).catch((err: unknown) => {
      // Before schema 504, or no access: generation still offers the built-ins.
      log.warn('[InspectionReports]', 'Templates unavailable', { error: errorText(err) })
      return [] as InspectionTemplate[]
    }),
  ])
  if (versionResult.error) throw new Error(versionResult.error.message)
  const versions = ((versionResult.versions ?? []) as FileVersionRow[])
    .map(toVersionInfo)
    .sort((a, b) => b.version - a.version)
  return { reports, versions, templates }
}

/** Write a drawing's report list to the store (the Reports view and the file list follow it). */
export function publishReports(fileId: string, reports: InspectionReport[]): void {
  usePDMStore.getState().setDrawingInspectionReports([fileId], new Map([[fileId, reports]]))
}

function storedReports(fileId: string): InspectionReport[] | undefined {
  return usePDMStore.getState().drawingInspectionReports.get(fileId)
}

/** Replace one report in the store's list of its drawing (after an import or status change). */
export function publishReport(report: InspectionReport): void {
  const list = storedReports(report.fileId)
  if (!list) return
  publishReports(report.fileId, list.map((r) => (r.id === report.id ? report : r)))
}

export function deliveredToast(outcome: DeliverOutcome): void {
  const { addToast } = usePDMStore.getState()
  if (outcome === 'saved') addToast('success', t('source.inspection.rptSaved'))
  else if (outcome === 'downloaded') addToast('info', t('source.inspection.rptDownloaded'))
}

export async function openReportWithToast(report: InspectionReport): Promise<void> {
  try {
    deliveredToast(await openReport(report))
  } catch (err) {
    log.error('[InspectionReports]', 'Opening a report failed', { reportId: report.id, error: errorText(err) })
    usePDMStore.getState().addToast('error', t('source.inspection.rptOpenFailed', { error: errorText(err) }))
  }
}

export interface GenerateOptions {
  /** Already loaded context (the Reports view has it); read fresh when omitted. */
  context?: ReportContext
  /** Default: the organization's default template. */
  template?: TemplateChoice
  /** Default: the latest checked-in version. */
  version?: VersionInfo
  /** Progress, for a dialog; without it a progress toast shows the phases. */
  onPhase?: (phase: GeneratePhase) => void
}

/**
 * Generate an inspection report of a drawing. Refuses a version without inspection rows (toast:
 * extract and check in), and warns afterwards when the user's own checked-out copy has changes the
 * version does not hold. Returns the new report, or null when nothing was generated.
 */
export async function generateForDrawing(file: LocalFile, options: GenerateOptions = {}): Promise<InspectionReport | null> {
  const state = usePDMStore.getState()
  const { addToast } = state
  const fileId = file.pdmData?.id
  const orgId = file.pdmData?.org_id ?? state.organization?.id
  if (!fileId || !orgId) {
    addToast('warning', t('source.inspection.rptNoVersions'))
    return null
  }
  if (generating.has(fileId)) {
    addToast('info', t('source.inspection.rptAlreadyGenerating', { name: file.name }))
    return null
  }
  generating.add(fileId)
  const toastId = options.onPhase ? null : `inspection-report-${fileId}-${Date.now()}`
  if (toastId) state.addProgressToast(toastId, t('source.inspection.rptGeneratingFor', { name: file.name }), PHASES.length)
  const onPhase = (phase: GeneratePhase) => {
    options.onPhase?.(phase)
    if (toastId) {
      const index = PHASES.indexOf(phase)
      usePDMStore
        .getState()
        .updateProgressToast(toastId, index, Math.round((index / PHASES.length) * 100), undefined, t(`source.inspection.rptPhase_${phase}`))
    }
  }

  try {
    const context = options.context ?? (await loadReportContext(fileId, orgId))
    const version = options.version ?? context.versions.reduce<VersionInfo | null>(
      (best, v) => (!best || v.version > best.version ? v : best),
      null,
    )
    if (!version) {
      addToast('warning', t('source.inspection.rptNoVersions'))
      return null
    }
    const template =
      options.template ?? defaultTemplateChoice(templateChoices(context.templates, builtInTemplateNames()))
    if (!template) throw new Error('No template')

    const organization = usePDMStore.getState().organization
    const naming = reportNamingFromSettings(organization?.settings?.inspection_reports)
    const [identity, logo] = await Promise.all([
      reportIdentity(version, file.pdmData),
      naming.includeLogo ? organizationLogo(organization) : Promise.resolve(null),
    ])

    const outcome = await generateReport({
      orgId,
      orgName: organization?.name ?? '',
      fileId,
      drawingName: file.name,
      version,
      versions: context.versions,
      template,
      existingReports: context.reports,
      naming,
      identity,
      logo,
      onPhase,
    })

    const current = storedReports(fileId) ?? context.reports
    publishReports(fileId, [outcome.report, ...current.filter((r) => r.id !== outcome.report.id)])
    usePDMStore.getState().setReportVersionNumbers(new Map([[version.id, version.version]]))

    addToast('success', t('source.inspection.rptGenerated', { number: outcome.report.reportNumber ?? '' }), 8000, {
      label: t('source.inspection.rptOpen'),
      onClick: () => void openReportWithToast(outcome.report),
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
    await warnIfNotCheckedIn(file, version, outcome.report.characteristicCount)
    return outcome.report
  } catch (err) {
    if (err instanceof ReportHasNoRowsError) {
      const live = await liveInspectionRowCount(fileId)
      addToast(
        'warning',
        live
          ? t('source.inspection.rptNoRowsLive', { version: err.version, count: live })
          : t('source.inspection.rptNoRows', { version: err.version }),
        12000,
      )
      return null
    }
    log.error('[InspectionReports]', 'Generate failed', { fileId, error: errorText(err) })
    addToast('error', t('source.inspection.rptGenerateFailed', { error: errorText(err) }))
    return null
  } finally {
    generating.delete(fileId)
    if (toastId) usePDMStore.getState().removeToast(toastId)
  }
}

async function warnIfNotCheckedIn(file: LocalFile, version: VersionInfo, versionRows: number): Promise<void> {
  const state = usePDMStore.getState()
  const userId = state.user?.id
  const fileId = file.pdmData?.id
  const checkedOutByMe = !!userId && file.pdmData?.checked_out_by === userId
  if (!checkedOutByMe || !fileId) return
  const pendingMetadata = !!file.pendingMetadata && Object.keys(file.pendingMetadata).length > 0
  const changed = hasChangesNotCheckedIn({
    checkedOutByMe,
    modified: file.diffStatus === 'modified' || pendingMetadata,
    liveRows: await liveInspectionRowCount(fileId),
    versionRows,
  })
  if (changed) state.addToast('warning', t('source.inspection.rptNotCheckedIn', { version: version.version }), 12000)
}

/**
 * Generate a new report like an existing one: the same version (or `version`), the report's
 * template at its current revision when it is still live, else the default. The existing report
 * is kept (it may have been sent); the new one gets the next number.
 */
export async function regenerateReport(
  file: LocalFile,
  report: InspectionReport,
  target: 'same' | 'latest',
): Promise<InspectionReport | null> {
  const { addToast } = usePDMStore.getState()
  try {
    const context = await loadReportContext(report.fileId, report.orgId)
    const version =
      target === 'latest'
        ? context.versions[0]
        : context.versions.find((v) => v.id === report.fileVersionId)
    if (!version) {
      addToast('warning', t('source.inspection.rptVersionGone'))
      return null
    }
    const template = regenerateTemplateChoice(report, templateChoices(context.templates, builtInTemplateNames()))
    return await generateForDrawing(file, { context, version, template: template ?? undefined })
  } catch (err) {
    log.error('[InspectionReports]', 'Regenerate failed', { reportId: report.id, error: errorText(err) })
    addToast('error', t('source.inspection.rptGenerateFailed', { error: errorText(err) }))
    return null
  }
}

export async function saveReportCopy(report: InspectionReport): Promise<void> {
  try {
    deliveredToast(await downloadReport(report))
  } catch (err) {
    log.error('[InspectionReports]', 'Saving a report failed', { reportId: report.id, error: errorText(err) })
    usePDMStore.getState().addToast('error', t('source.inspection.rptOpenFailed', { error: errorText(err) }))
  }
}

export async function saveReportNextToFile(file: LocalFile, report: InspectionReport): Promise<void> {
  const { addToast } = usePDMStore.getState()
  try {
    const outcome = await saveReportNextToDrawing(report, file.path)
    if (outcome.kind === 'exists') addToast('warning', t('source.inspection.rptNextExists', { path: outcome.path }), 10000)
    else addToast('success', t('source.inspection.rptSavedNext', { path: outcome.path }), 8000)
  } catch (err) {
    log.error('[InspectionReports]', 'Saving next to the drawing failed', { reportId: report.id, error: errorText(err) })
    addToast('error', t('source.inspection.rptSaveNextFailed', { error: errorText(err) }))
  }
}

export async function deleteReportWithToast(report: InspectionReport): Promise<boolean> {
  const { addToast } = usePDMStore.getState()
  try {
    await deleteInspectionReport(report.id)
    const list = storedReports(report.fileId)
    if (list) publishReports(report.fileId, list.filter((r) => r.id !== report.id))
    addToast('success', t('source.inspection.rptDeleted', { number: report.reportNumber ?? '' }))
    return true
  } catch (err) {
    log.error('[InspectionReports]', 'Delete failed', { reportId: report.id, error: errorText(err) })
    addToast('error', t('source.inspection.rptDeleteFailed', { error: errorText(err) }))
    return false
  }
}

// ---------------------------------------------------------------------------
// "Generate with options..." from outside the Reports view
// ---------------------------------------------------------------------------

/** The one drawing whose Reports view should open the options dialog (latest request wins). */
let pendingOptionsFor: string | null = null
const optionsListeners = new Set<() => void>()

/** Ask the drawing's Reports view to open "Generate with options..." (it is shown by the caller). */
export function requestGenerateOptions(fileId: string): void {
  pendingOptionsFor = fileId
  for (const listener of optionsListeners) listener()
}

/** Take the request when it is for this drawing. */
export function takeGenerateOptionsRequest(fileId: string | undefined): boolean {
  if (!fileId || pendingOptionsFor !== fileId) return false
  pendingOptionsFor = null
  return true
}

/** Listen for requests; returns the unsubscribe (call it on unmount, so the set stays bounded). */
export function onGenerateOptionsRequest(listener: () => void): () => void {
  optionsListeners.add(listener)
  return () => {
    optionsListeners.delete(listener)
  }
}
