/**
 * What a row under an expanded file shows that depends on its parent: whether it is out of date
 * (the status slot at the left, `ChildNameCell`'s `status`) and which columns are the parent's.
 * Pure: the output and report rows and the tests call it.
 */
import type { InspectionReport } from '@/types/inspectionReports'

type ReportLike = Pick<InspectionReport, 'id' | 'fileVersionId' | 'reportType' | 'createdAt'>

/**
 * The reports the file list shows under a drawing: those no other listed report supersedes
 * (schema 508). A regeneration replaces its report there; a copy, or a report of before 508,
 * stands on its own. The Reports view still lists every report.
 */
export function reportHeads<T extends Pick<InspectionReport, 'id' | 'supersedesReportId'>>(reports: readonly T[]): T[] {
  const superseded = new Set<string>()
  for (const r of reports) if (r.supersedesReportId) superseded.add(r.supersedesReportId)
  return superseded.size === 0 ? [...reports] : reports.filter((r) => !superseded.has(r.id))
}

/**
 * The drawing's newer version number when `report` is out of date, else null. A report is out of
 * date when the drawing has a newer checked-in version and the report is the newest of its type
 * (an older one is superseded, not stale): regenerating it makes a report of that version. A
 * report whose version number is not known yet is never flagged.
 */
export function outdatedReportVersion(
  report: ReportLike,
  reports: readonly ReportLike[],
  versionOf: ReadonlyMap<string, number>,
  latestVersion: number | null | undefined,
): number | null {
  const own = versionOf.get(report.fileVersionId)
  if (own === undefined || !latestVersion || own >= latestVersion) return null
  const newerOfType = reports.some((r) => {
    if (r.id === report.id || r.reportType !== report.reportType) return false
    const v = versionOf.get(r.fileVersionId)
    if (v === undefined) return false
    return v > own || (v === own && r.createdAt > report.createdAt)
  })
  return newerOfType ? null : latestVersion
}

/** Columns an output or report row fills with its parent file's value (`ParentMetadataText`). */
export function isParentMetadataColumn(columnId: string): boolean {
  return columnId === 'itemNumber' || columnId === 'revision' || columnId === 'description'
}
