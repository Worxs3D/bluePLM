/**
 * Data of the Reports view: the drawing's reports, its versions and the organization's templates.
 * The report list lives in the store's `drawingInspectionReports`: the view writes to it after a
 * generate, import or status change, and follows it when a command elsewhere (the file context
 * menu, a report row in the file list) changes it, so every surface shows the same reports.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { InspectionReport, InspectionTemplate } from '@/types/inspectionReports'

import { loadReportContext, publishReports, type ReportContext } from './reportCommands'
import type { VersionInfo } from './reportModel'
import { retryWorkingCopyPins } from './workingCopyPin'

export interface InspectionReportsData {
  reports: InspectionReport[]
  versions: VersionInfo[]
  templates: InspectionTemplate[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  /** The loaded reports, versions and templates, for the shared commands. */
  context: ReportContext
  /** Replace one report in the list (after an update) and publish the list. */
  replaceReport: (report: InspectionReport) => void
  /** Add a new report and publish the list. */
  addReport: (report: InspectionReport) => void
  removeReport: (id: string) => void
}

const NO_REPORTS: InspectionReport[] = []

export function useInspectionReports(fileId: string | undefined, orgId: string | undefined): InspectionReportsData {
  const setReportVersionNumbers = usePDMStore((s) => s.setReportVersionNumbers)
  const stored = usePDMStore((s) => (fileId ? s.drawingInspectionReports.get(fileId) : undefined))
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [templates, setTemplates] = useState<InspectionTemplate[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const reports = loaded ? (stored ?? NO_REPORTS) : NO_REPORTS

  const reload = useCallback(async () => {
    if (!fileId || !orgId) return
    const mine = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const context = await loadReportContext(fileId, orgId)
      if (mine !== generation.current) return
      setVersions(context.versions)
      setReportVersionNumbers(new Map(context.versions.map((v) => [v.id, v.version])))
      setTemplates(context.templates)
      publishReports(fileId, context.reports)
      setLoaded(true)
      retryWorkingCopyPins(fileId, context.reports)
    } catch (err) {
      if (mine !== generation.current) return
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[InspectionReports]', 'Load failed', { fileId, error: message })
      setError(message)
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [fileId, orgId, setReportVersionNumbers])

  useEffect(() => {
    setLoaded(false)
    void reload()
  }, [reload])

  // A report generated elsewhere for a version this list does not have yet means a version was
  // checked in since the load: read again, once per such version. Also reload when the store
  // dropped this drawing's entry (its list is bounded).
  const reloadedFor = useRef(new Set<string>())
  useEffect(() => {
    reloadedFor.current = new Set()
  }, [fileId])
  useEffect(() => {
    if (!loaded || loading) return
    const known = new Set(versions.map((v) => v.id))
    const unknown = (stored ?? []).map((r) => r.fileVersionId).filter((id) => !known.has(id) && !reloadedFor.current.has(id))
    const evicted = stored === undefined && !reloadedFor.current.has('')
    if (unknown.length === 0 && !evicted) return
    for (const id of unknown) reloadedFor.current.add(id)
    if (evicted) reloadedFor.current.add('')
    void reload()
  }, [stored, loaded, loading, versions, reload])

  const update = useCallback(
    (fn: (prev: InspectionReport[]) => InspectionReport[]) => {
      if (!fileId) return
      const current = usePDMStore.getState().drawingInspectionReports.get(fileId) ?? []
      publishReports(fileId, fn(current))
    },
    [fileId],
  )

  const replaceReport = useCallback(
    (report: InspectionReport) => update((prev) => prev.map((r) => (r.id === report.id ? report : r))),
    [update],
  )
  const addReport = useCallback(
    (report: InspectionReport) => update((prev) => [report, ...prev.filter((r) => r.id !== report.id)]),
    [update],
  )
  const removeReport = useCallback((id: string) => update((prev) => prev.filter((r) => r.id !== id)), [update])

  return {
    reports,
    versions,
    templates,
    loading,
    error,
    reload,
    context: { reports, versions, templates },
    replaceReport,
    addReport,
    removeReport,
  }
}
