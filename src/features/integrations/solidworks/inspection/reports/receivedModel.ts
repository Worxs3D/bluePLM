/**
 * Received inspections (5.9.0, plan decision 7): the reports a filled-in workbook came back for
 * (`returnedHash` set). They are listed apart from the generated reports, under the drawing and in
 * the Inspection tab's Received view, and they stay listed when a newer report supersedes theirs:
 * a return is a record of parts that were inspected, not a report to regenerate. Pure.
 */
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

type ReceivedLike = Pick<InspectionReport, 'id' | 'returnedHash' | 'returnedAt' | 'updatedAt' | 'createdAt'>

/** The reports with a returned workbook, newest return first, superseded ones included. */
export function receivedReports<T extends ReceivedLike>(reports: readonly T[]): T[] {
  return reports
    .filter((r) => !!r.returnedHash)
    .sort((a, b) => {
      const byReturn = (b.returnedAt ?? b.updatedAt).localeCompare(a.returnedAt ?? a.updatedAt)
      if (byReturn !== 0) return byReturn
      const byCreated = b.createdAt.localeCompare(a.createdAt)
      return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id)
    })
}

/** The status a received inspection shows: returned, accepted or rejected. */
export type ReceivedStatus = 'returned' | 'accepted' | 'rejected'

export function receivedStatus(status: InspectionReportStatus): ReceivedStatus {
  return status === 'accepted' || status === 'rejected' ? status : 'returned'
}

/**
 * The status a generated report shows in its own section: issued until it went out, sent after
 * (a report that came back was sent; its return is shown in the received section).
 */
export function generatedStatus(status: InspectionReportStatus): 'issued' | 'sent' {
  return status === 'issued' ? 'issued' : 'sent'
}

export interface ReceivedFilter {
  status: 'all' | ReceivedStatus
  supplier: string
  po: string
  lot: string
}

export const NO_RECEIVED_FILTER: ReceivedFilter = { status: 'all', supplier: '', po: '', lot: '' }

function matches(value: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (value ?? '').toLowerCase().includes(q)
}

/** Received inspections matching the filter (text fields: case-insensitive substring). */
export function filterReceived<
  T extends Pick<InspectionReport, 'status' | 'supplierName' | 'poNumber' | 'lotNumber'>,
>(reports: readonly T[], filter: ReceivedFilter): T[] {
  return reports.filter(
    (r) =>
      (filter.status === 'all' || receivedStatus(r.status) === filter.status) &&
      matches(r.supplierName, filter.supplier) &&
      matches(r.poNumber, filter.po) &&
      matches(r.lotNumber, filter.lot),
  )
}

/** Count per received status, for the filter's chips. */
export function receivedCounts(reports: ReadonlyArray<Pick<InspectionReport, 'status'>>): Record<ReceivedStatus, number> {
  const counts: Record<ReceivedStatus, number> = { returned: 0, accepted: 0, rejected: 0 }
  for (const r of reports) counts[receivedStatus(r.status)]++
  return counts
}

/** Distinct supplier names, sorted, for the supplier filter's suggestions. */
export function receivedSuppliers(reports: ReadonlyArray<Pick<InspectionReport, 'supplierName'>>): string[] {
  const names = new Set<string>()
  for (const r of reports) if (r.supplierName?.trim()) names.add(r.supplierName.trim())
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * The drawings the Received view reads: every checked-in drawing of the folder (`folder` is a
 * vault-relative folder path, '' for the root) or of the whole vault (`folder` null).
 */
export function drawingsInScope<
  T extends { relativePath: string; extension: string; isDirectory: boolean; pdmData?: { id: string } | null },
>(files: readonly T[], folder: string | null): T[] {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const dir = folder === null ? null : norm(folder).replace(/\/+$/, '')
  return files.filter((f) => {
    if (f.isDirectory || !f.pdmData?.id || f.extension.toLowerCase() !== '.slddrw') return false
    if (dir === null) return true
    const path = norm(f.relativePath)
    const cut = path.lastIndexOf('/')
    return (cut < 0 ? '' : path.slice(0, cut)) === dir
  })
}

/** The vault-relative folder of a file path ('' at the root). */
export function folderOf(relativePath: string): string {
  const path = relativePath.replace(/\\/g, '/')
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}
