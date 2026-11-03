/**
 * Loads the inspection reports of drawings the file list expands, so the expansion lists them after
 * the referenced files. One batched query per change (`listInspectionReportsForFiles`), for the
 * drawings that were just expanded or have never been loaded; a drawing is read again each time it
 * is expanded. The Inspection tab's Reports view writes its list to the same store entry after a
 * generate or import, so the expansion follows it without a reload.
 */
import { useEffect, useRef } from 'react'

import { log } from '@/lib/logger'
import { getFileVersionNumbers, listInspectionReportsForFiles } from '@/lib/supabase'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import { drawingIdsToLoad } from './drawingReportsToLoad'

export function useDrawingReportsLoader(
  files: readonly LocalFile[],
  expandedDrawingRefs: ReadonlySet<string>,
): void {
  const setDrawingInspectionReports = usePDMStore((s) => s.setDrawingInspectionReports)
  const setReportVersionNumbers = usePDMStore((s) => s.setReportVersionNumbers)
  const inFlight = useRef(new Set<string>())
  const previous = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const loaded = usePDMStore.getState().drawingInspectionReports
    const ids = drawingIdsToLoad(files, expandedDrawingRefs, previous.current, loaded, inFlight.current)
    previous.current = new Set(expandedDrawingRefs)
    if (ids.length === 0) return
    for (const id of ids) inFlight.current.add(id)

    void (async () => {
      try {
        const byFile = await listInspectionReportsForFiles(ids)
        setDrawingInspectionReports(ids, byFile)
        const versionIds = [...byFile.values()].flat().map((r) => r.fileVersionId)
        if (versionIds.length > 0) setReportVersionNumbers(await getFileVersionNumbers(versionIds))
      } catch (err) {
        // A database before schema 504 has no reports table: show none rather than retry forever.
        log.debug('[FileList]', 'Inspection reports unavailable', {
          count: ids.length,
          error: err instanceof Error ? err.message : String(err),
        })
        setDrawingInspectionReports(ids, new Map())
      } finally {
        for (const id of ids) inFlight.current.delete(id)
      }
    })()
  }, [files, expandedDrawingRefs, setDrawingInspectionReports, setReportVersionNumbers])
}
