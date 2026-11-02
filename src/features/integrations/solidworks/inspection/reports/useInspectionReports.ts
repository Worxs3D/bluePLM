/**
 * Data of the Reports view: the drawing's reports, its versions and the organization's templates.
 * Every change to the report list is written to the store's `drawingInspectionReports` as well, so
 * the file list's drawing expansion shows the same reports.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { getFileVersions, listInspectionReports, listInspectionTemplates } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { InspectionReport, InspectionTemplate } from '@/types/inspectionReports'

import type { VersionInfo } from './reportModel'

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

export interface InspectionReportsData {
  reports: InspectionReport[]
  versions: VersionInfo[]
  templates: InspectionTemplate[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  /** Replace one report in the list (after an update) and publish the list. */
  replaceReport: (report: InspectionReport) => void
  /** Add a new report and publish the list. */
  addReport: (report: InspectionReport) => void
  removeReport: (id: string) => void
}

export function useInspectionReports(fileId: string | undefined, orgId: string | undefined): InspectionReportsData {
  const setDrawingInspectionReports = usePDMStore((s) => s.setDrawingInspectionReports)
  const setReportVersionNumbers = usePDMStore((s) => s.setReportVersionNumbers)
  const [reports, setReports] = useState<InspectionReport[]>([])
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [templates, setTemplates] = useState<InspectionTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const reportsRef = useRef<InspectionReport[]>([])

  const publish = useCallback(
    (list: InspectionReport[]) => {
      if (!fileId) return
      setDrawingInspectionReports([fileId], new Map([[fileId, list]]))
    },
    [fileId, setDrawingInspectionReports],
  )

  const reload = useCallback(async () => {
    if (!fileId) return
    const mine = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const [list, versionResult, templateList] = await Promise.all([
        listInspectionReports(fileId),
        getFileVersions(fileId),
        orgId ? listInspectionTemplates(orgId).catch((err: unknown) => {
          // Before schema 504, or no access: generation still offers the built-ins.
          log.warn('[InspectionReports]', 'Templates unavailable', { error: String(err) })
          return [] as InspectionTemplate[]
        }) : Promise.resolve([] as InspectionTemplate[]),
      ])
      if (mine !== generation.current) return
      if (versionResult.error) throw new Error(versionResult.error.message)
      reportsRef.current = list
      setReports(list)
      const versionList = ((versionResult.versions ?? []) as FileVersionRow[]).map(toVersionInfo)
      setVersions(versionList)
      setReportVersionNumbers(new Map(versionList.map((v) => [v.id, v.version])))
      setTemplates(templateList)
      publish(list)
    } catch (err) {
      if (mine !== generation.current) return
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[InspectionReports]', 'Load failed', { fileId, error: message })
      setError(message)
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [fileId, orgId, publish, setReportVersionNumbers])

  useEffect(() => {
    reportsRef.current = []
    setReports([])
    void reload()
  }, [reload])

  const update = useCallback(
    (fn: (prev: InspectionReport[]) => InspectionReport[]) => {
      const next = fn(reportsRef.current)
      reportsRef.current = next
      setReports(next)
      publish(next)
    },
    [publish],
  )

  const replaceReport = useCallback(
    (report: InspectionReport) => update((prev) => prev.map((r) => (r.id === report.id ? report : r))),
    [update],
  )
  const addReport = useCallback((report: InspectionReport) => update((prev) => [report, ...prev]), [update])
  const removeReport = useCallback((id: string) => update((prev) => prev.filter((r) => r.id !== id)), [update])

  return { reports, versions, templates, loading, error, reload, replaceReport, addReport, removeReport }
}
