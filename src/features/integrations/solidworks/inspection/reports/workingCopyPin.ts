/**
 * A report of a checked-out copy (`working_copy`, schema 510) becomes a report of the version its
 * check-in made. After the check-in its workbook is rebuilt for that version (the version's
 * snapshot rows, so a returned workbook matches; the drawing pages exported again from the local
 * drawing, which is now that version's content), uploaded, and the row pointed at the version
 * (`inspection_report_pin()`), keeping its id and number.
 *
 * Runs in the background after a check-in (`pinCheckedInWorkingCopyReports`) and again when a
 * drawing's reports are loaded and one of the user's working-copy reports is found on a drawing
 * they no longer have checked out (a pin that failed, or a check-in on another machine). Never
 * throws; failures are logged and toasted. At most one pin runs per drawing at a time, and a
 * report that failed is not retried by a load again in the same session.
 */
import { t } from '@/lib/i18n'
import { builtInTemplateNames } from '@/lib/inspection/issueText'
import { mapCharacteristicIds } from '@/lib/inspection/reportTypes'
import { log } from '@/lib/logger'
import { isDrawingFile } from '@/lib/outputs/kinds'
import { hasDesktop } from '@/lib/platform'
import {
  deleteInspectionReport,
  getInspectionRows,
  listInspectionReports,
  pinInspectionReport,
  toRowInput,
  uploadInspectionContent,
} from '@/lib/supabase'
import { getDrawingPdf } from '@/lib/supabase/reviews'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { InspectionReport } from '@/types/inspectionReports'

import { generateReport, rowsAtVersion } from './reportActions'
import { loadReportContext, publishReports, regenerateTypeRequest, type ReportContext } from './reportCommands'
import {
  defaultTemplateChoice,
  regenerateTemplateChoice,
  reportNamingFromSettings,
  templateChoices,
  type VersionInfo,
} from './reportModel'
import { organizationLogo, reportIdentity } from './reportSources'

/** Check-ins of more drawings than this pin nothing in the background (a load pins them later). */
export const PIN_MAX_BATCH = 25
/** Reports a load will not try again this session (bounded). */
const MAX_FAILED = 500

const pinning = new Set<string>()
const failed = new Set<string>()

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The user's own reports of a checked-out copy. Pure. */
export function myWorkingCopyReports(reports: readonly InspectionReport[], userId: string | null | undefined): InspectionReport[] {
  if (!userId) return []
  return reports.filter((r) => r.workingCopy && r.createdBy === userId)
}

/**
 * The version a checked-out copy's report belongs to (as `inspection_report_pin()` decides): the
 * first version its creator checked in after the base version, else the base version once the
 * creator no longer has the drawing checked out, else none yet. `versions` newest first. Pure.
 */
export function pinTargetVersion(
  report: Pick<InspectionReport, 'fileVersionId' | 'createdBy'>,
  versions: readonly VersionInfo[],
  stillCheckedOutByCreator: boolean,
): VersionInfo | null {
  const base = versions.find((v) => v.id === report.fileVersionId)
  if (!base) return null
  const after = versions
    .filter((v) => v.version > base.version && v.createdBy === report.createdBy)
    .sort((a, b) => a.version - b.version)[0]
  if (after) return after
  return stillCheckedOutByCreator ? null : base
}

async function pinOne(file: LocalFile, report: InspectionReport, context: ReportContext, target: VersionInfo): Promise<boolean> {
  const state = usePDMStore.getState()
  const organization = state.organization
  const fileId = report.fileId
  const naming = reportNamingFromSettings(organization?.settings?.inspection_reports)

  const type = regenerateTypeRequest(report, context, 'same')
  if (type?.chosenIds) {
    // The included rows were live rows; find them again among the version's snapshot rows.
    const live = await getInspectionRows(fileId)
    if (!live.success) throw new Error(live.error ?? 'The inspection table could not be read')
    const to = await rowsAtVersion(fileId, target.id)
    const mapped = mapCharacteristicIds((live.rows ?? []).map((r) => toRowInput(r)), type.chosenIds, to.rows)
    if (mapped.unmapped.length > 0) {
      state.addToast(
        'warning',
        t('source.inspection.rptWorkingCopyUnmapped', {
          number: report.reportNumber ?? '',
          version: target.version,
          balloons: mapped.unmapped.join(', '),
        }),
        12000,
      )
      return false
    }
    type.chosenIds = mapped.ids
  }
  const choices = templateChoices(context.templates, builtInTemplateNames())
  const template = regenerateTemplateChoice(report, choices) ?? defaultTemplateChoice(choices, report.reportType ?? 'production')
  if (!template) throw new Error('No template')
  // The version's stored PDF when it was rendered already (then the report names it), else the
  // local drawing, which the check-in just made that version's content.
  const [identity, logo, storedPdf] = await Promise.all([
    reportIdentity(target, file.pdmData),
    naming.includeLogo ? organizationLogo(organization) : Promise.resolve(null),
    getDrawingPdf(target.id).catch(() => null),
  ])
  const local = await generateReport({
    orgId: report.orgId,
    orgName: organization?.name ?? '',
    fileId,
    drawingName: file.name,
    version: target,
    versions: context.versions,
    template,
    existingReports: context.reports,
    naming,
    identity,
    logo,
    type: type ?? { reportType: 'production', lotScope: naming.lotScope },
    reuse: { reportId: report.id, reportNumber: report.reportNumber },
    localDrawingPath: !storedPdf && hasDesktop() && file.path ? file.path : undefined,
    localOnly: true,
  })
  const uploaded = await uploadInspectionContent(report.orgId, local.workbook)
  await pinInspectionReport({
    reportId: report.id,
    fileVersionId: target.id,
    characteristicIds: local.characteristicIds,
    storageHash: uploaded.hash,
    fileSize: uploaded.size,
    characteristicCount: local.characteristicCount,
    drawingPdfHash: local.drawingPdfHash,
    templateId: local.templateId,
    templateName: local.templateName,
    templateHash: local.templateHash,
  })
  log.info('[InspectionReports]', 'Working-copy report pinned', { reportId: report.id, fileId, version: target.version })
  return true
}

/**
 * Pin the user's working-copy reports of one drawing whose check-in made their version. Returns
 * the number pinned.
 */
export async function pinWorkingCopyReports(file: LocalFile, options: { fromLoad?: boolean } = {}): Promise<number> {
  const state = usePDMStore.getState()
  const userId = state.user?.id
  const fileId = file.pdmData?.id
  const orgId = file.pdmData?.org_id ?? state.organization?.id
  if (!userId || !fileId || !orgId || pinning.has(fileId)) return 0
  pinning.add(fileId)
  let pinned = 0
  try {
    let mine = myWorkingCopyReports(await listInspectionReports(fileId), userId)
    if (options.fromLoad) mine = mine.filter((r) => !failed.has(r.id))
    if (mine.length === 0) return 0
    const context = await loadReportContext(fileId, orgId)
    const stillCheckedOut = usePDMStore.getState().files.find((f) => f.pdmData?.id === fileId)?.pdmData?.checked_out_by === userId
    for (const report of mine) {
      const target = pinTargetVersion(report, context.versions, stillCheckedOut)
      if (!target) continue
      try {
        if (await pinOne(file, report, context, target)) {
          pinned++
          failed.delete(report.id)
          usePDMStore
            .getState()
            .addToast('info', t('source.inspection.rptWorkingCopyPinned', { number: report.reportNumber ?? '', version: target.version }), 6000)
        } else if (failed.size < MAX_FAILED) failed.add(report.id)
      } catch (err) {
        if (failed.size < MAX_FAILED) failed.add(report.id)
        log.warn('[InspectionReports]', 'Working-copy report not pinned', { reportId: report.id, error: errorText(err) })
        usePDMStore
          .getState()
          .addToast('warning', t('source.inspection.rptWorkingCopyPinFailed', { number: report.reportNumber ?? '', error: errorText(err) }), 12000)
      }
    }
    if (pinned > 0) {
      const fresh = await loadReportContext(fileId, orgId)
      publishReports(fileId, fresh.reports)
      usePDMStore.getState().setReportVersionNumbers(new Map(fresh.versions.map((v) => [v.id, v.version])))
    }
    return pinned
  } catch (err) {
    log.warn('[InspectionReports]', 'Working-copy reports not pinned', { fileId, error: errorText(err) })
    return pinned
  } finally {
    pinning.delete(fileId)
  }
}

/**
 * After a discard: the user's reports of the discarded copies describe a copy that is gone, so
 * they are deleted (the workbook bytes stay in the bucket). In the background; never throws.
 */
export function deleteDiscardedWorkingCopyReports(files: readonly LocalFile[]): void {
  const state = usePDMStore.getState()
  const userId = state.user?.id
  if (!userId) return
  const drawings = files.filter((f) => !!f.pdmData?.id && isDrawingFile(f.path || f.name)).slice(0, PIN_MAX_BATCH)
  if (drawings.length === 0) return
  void (async () => {
    let removed = 0
    for (const file of drawings) {
      const fileId = file.pdmData!.id
      try {
        const reports = await listInspectionReports(fileId)
        const mine = myWorkingCopyReports(reports, userId)
        if (mine.length === 0) continue
        for (const report of mine) {
          await deleteInspectionReport(report.id)
          removed++
        }
        const gone = new Set(mine.map((r) => r.id))
        publishReports(
          fileId,
          reports.filter((r) => !gone.has(r.id)),
        )
      } catch (err) {
        log.warn('[InspectionReports]', 'Working-copy reports of a discarded copy not deleted', { fileId, error: errorText(err) })
      }
    }
    if (removed > 0) usePDMStore.getState().addToast('info', t('source.inspection.rptWorkingCopyDiscarded', { count: removed }), 8000)
  })()
}

/**
 * After a drawing's reports were loaded: pin the user's working-copy reports when they no longer
 * have the drawing checked out (a pin that failed after the check-in, or a check-in made on another
 * machine). In the background; a report that failed this session is not tried again from a load.
 */
export function retryWorkingCopyPins(fileId: string, reports: readonly InspectionReport[]): void {
  const state = usePDMStore.getState()
  const userId = state.user?.id
  const mine = myWorkingCopyReports(reports, userId).filter((r) => !failed.has(r.id))
  if (mine.length === 0 || pinning.has(fileId)) return
  const file = state.files.find((f) => f.pdmData?.id === fileId)
  if (!file || file.pdmData?.checked_out_by === userId) return
  void pinWorkingCopyReports(file, { fromLoad: true })
}

/** The check-in / discard listener (registered by the app, `registerCheckoutEndListener`). */
export function onCheckoutEnd(end: 'checkin' | 'discard', files: readonly LocalFile[], after?: Promise<unknown>): void {
  if (end === 'checkin') pinCheckedInWorkingCopyReports(files, after)
  else deleteDiscardedWorkingCopyReports(files)
}

/**
 * After a successful check-in: pin the working-copy reports of the drawings in it, one drawing at a
 * time, in the background. Returns at once and never throws. `after` is the check-in's background
 * work (reference extraction); pinning starts once it settles. Only drawings this user has a
 * working-copy report of are read (the store's report lists say which).
 */
export function pinCheckedInWorkingCopyReports(files: readonly LocalFile[], after?: Promise<unknown>): void {
  const state = usePDMStore.getState()
  const userId = state.user?.id
  if (!userId) return
  const drawings = files.filter((f) => {
    if (!f.pdmData?.id || !isDrawingFile(f.path || f.name)) return false
    const reports = state.drawingInspectionReports.get(f.pdmData.id)
    // Not loaded: the drawing may still have one (generated on another surface); look.
    return !reports || myWorkingCopyReports(reports, userId).length > 0
  })
  if (drawings.length === 0 || drawings.length > PIN_MAX_BATCH) return
  const orgId = state.organization?.id ?? null
  void (async () => {
    await after?.catch(() => undefined)
    for (const file of drawings) {
      if ((usePDMStore.getState().organization?.id ?? null) !== orgId) return
      await pinWorkingCopyReports(file)
    }
  })()
}
