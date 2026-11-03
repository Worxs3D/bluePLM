/**
 * Inspection Reports Slice
 *
 * The inspection reports of drawings the file list has expanded, keyed by drawing file id. The
 * file list lists them under a drawing's chevron after its referenced files; the Inspection tab's
 * Reports view writes the full list back after a generate, import or status change, so both show
 * the same reports. Session state only. Bounded: the least recently written drawings are dropped
 * past `MAX_DRAWINGS`, so a session that runs for weeks keeps a fixed footprint.
 */

import { StateCreator } from 'zustand'

import type { InspectionReport } from '../../types/inspectionReports'
import type { PDMStoreState } from '../types'

export const MAX_DRAWINGS_WITH_REPORTS = 300
export const MAX_REPORT_VERSION_NUMBERS = 5000

export interface InspectionReportsSlice {
  /** Reports per drawing file id, newest first. An empty list means "loaded, none". */
  drawingInspectionReports: Map<string, InspectionReport[]>
  /** Store the reports of these drawings (ids loaded but absent from `byFile` get an empty list). */
  setDrawingInspectionReports: (
    fileIds: readonly string[],
    byFile: ReadonlyMap<string, InspectionReport[]>,
  ) => void
  clearDrawingInspectionReports: () => void
  /** Version number of each drawing version a listed report belongs to, by file_version id. Bounded. */
  reportVersionNumbers: Map<string, number>
  setReportVersionNumbers: (numbers: ReadonlyMap<string, number>) => void
  /**
   * Set by "Show in Inspection tab" on a report row of the file list: the Inspection tab of this
   * drawing opens its Reports view (and highlights the report), then clears the request.
   */
  inspectionReportsFocus: { fileId: string; reportId: string | null } | null
  /** Reports being regenerated (`regenerateReport`), for the row's spinner. Session state. */
  regeneratingReportIds: ReadonlySet<string>
  setReportRegenerating: (reportId: string, regenerating: boolean) => void
  focusInspectionReports: (fileId: string, reportId?: string | null) => void
  clearInspectionReportsFocus: () => void
}

/** The next map: written ids move to the end (most recent), the oldest go past the cap. */
export function mergeDrawingReports(
  current: ReadonlyMap<string, InspectionReport[]>,
  fileIds: readonly string[],
  byFile: ReadonlyMap<string, InspectionReport[]>,
  max = MAX_DRAWINGS_WITH_REPORTS,
): Map<string, InspectionReport[]> {
  const next = new Map(current)
  for (const id of fileIds) {
    next.delete(id)
    next.set(id, byFile.get(id) ?? [])
  }
  for (const key of next.keys()) {
    if (next.size <= max) break
    next.delete(key)
  }
  return next
}

export const createInspectionReportsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  InspectionReportsSlice
> = (set) => ({
  drawingInspectionReports: new Map(),
  setDrawingInspectionReports: (fileIds, byFile) =>
    set((state) => ({
      drawingInspectionReports: mergeDrawingReports(state.drawingInspectionReports, fileIds, byFile),
    })),
  clearDrawingInspectionReports: () =>
    set({ drawingInspectionReports: new Map(), reportVersionNumbers: new Map() }),
  regeneratingReportIds: new Set<string>(),
  setReportRegenerating: (reportId, regenerating) =>
    set((state) => {
      if (state.regeneratingReportIds.has(reportId) === regenerating) return {}
      const next = new Set(state.regeneratingReportIds)
      if (regenerating) next.add(reportId)
      else next.delete(reportId)
      return { regeneratingReportIds: next }
    }),
  reportVersionNumbers: new Map(),
  setReportVersionNumbers: (numbers) =>
    set((state) => {
      let changed = false
      for (const [id, n] of numbers) if (state.reportVersionNumbers.get(id) !== n) changed = true
      if (!changed) return {}
      const next = new Map(state.reportVersionNumbers)
      for (const [id, n] of numbers) {
        next.delete(id)
        next.set(id, n)
      }
      for (const key of next.keys()) {
        if (next.size <= MAX_REPORT_VERSION_NUMBERS) break
        next.delete(key)
      }
      return { reportVersionNumbers: next }
    }),
  inspectionReportsFocus: null,
  focusInspectionReports: (fileId, reportId = null) =>
    set({ inspectionReportsFocus: { fileId, reportId } }),
  clearInspectionReportsFocus: () => set({ inspectionReportsFocus: null }),
})
