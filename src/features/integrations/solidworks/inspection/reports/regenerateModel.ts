/**
 * What regenerating a report may do (5.9.0, plan decisions 5 and 6). Pure: the report menu and
 * `overwriteReport` call it, and the tests pin it.
 *
 * - Regenerate (same version) overwrites the report in place: same row, number and version
 *   (`inspection_report_overwrite`). Not offered once the version is released (the report is
 *   frozen), once a filled-in workbook came back (that report is a record now), or for a report
 *   from before types (its row has no type fields for the new workbook).
 * - Regenerate for version N (the drawing has a newer version) makes a new report that supersedes
 *   this one (schema 508), so each version keeps its own report.
 * - Regenerate as copy makes a report of its own, listed beside it.
 * - Delete is refused for a released version's report.
 */
import type { ReportOverwriteRefusal } from '@/lib/supabase/releases'
import type { InspectionReport } from '@/types/inspectionReports'

type RegenerateLike = Pick<InspectionReport, 'fileVersionId' | 'returnedHash' | 'reportType'>

/** Whether the report's drawing version is released (`released`: released file_version ids). */
export function isReportReleased(
  report: Pick<InspectionReport, 'fileVersionId'>,
  released: ReadonlySet<string>,
): boolean {
  return released.has(report.fileVersionId)
}

export interface RegenerateMenu {
  /** "Regenerate": overwrite in place. */
  overwrite: boolean
  /** "Regenerate for version N": the newer version, or null. */
  forVersion: number | null
  /** "Regenerate as copy". */
  asCopy: boolean
  /** The report's version is released: its report is frozen and cannot be deleted. */
  frozen: boolean
}

export function regenerateMenu(input: {
  report: RegenerateLike
  released: ReadonlySet<string>
  reportVersion: number | null
  latestVersion: number | null
  canEdit: boolean
}): RegenerateMenu {
  const { report, canEdit } = input
  const frozen = isReportReleased(report, input.released)
  const forVersion =
    input.latestVersion !== null && input.reportVersion !== null && input.latestVersion > input.reportVersion
      ? input.latestVersion
      : null
  return {
    overwrite: canEdit && !frozen && !report.returnedHash && report.reportType !== null,
    forVersion: canEdit ? forVersion : null,
    asCopy: canEdit,
    frozen,
  }
}

/** Whether the report may be deleted: the creator or an admin, and never a released version's. */
export function mayDeleteReport(canDelete: boolean, frozen: boolean): boolean {
  return canDelete && !frozen
}

/**
 * What to do when the server refuses an overwrite: `frozen` (released; tell the user), `supersede`
 * (a return came back meanwhile; make a new superseding report instead), `fail` (an error toast).
 */
export function overwriteFallback(code: ReportOverwriteRefusal): 'frozen' | 'supersede' | 'fail' {
  if (code === 'RELEASED') return 'frozen'
  if (code === 'HAS_RETURN') return 'supersede'
  return 'fail'
}

/**
 * Whether the rebuilt workbook may replace the report's: a lot report records how many part
 * columns it was laid out with, and a returned workbook is matched against that count, so a
 * template whose result columns changed needs a new report instead.
 */
export function overwriteKeepsLayout(recorded: number | null, rebuilt: number | null): boolean {
  return recorded === null || recorded === rebuilt
}
