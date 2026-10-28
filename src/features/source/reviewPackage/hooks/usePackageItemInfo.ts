/**
 * Loads, per pinned version in the draft, its dependency summary and (for drawings) whether its
 * review PDF exists. Results are keyed by `file_versions.id`, which never changes content, so a
 * version is fetched once per pane mount; only PDF status is re-read after a generate run.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { getDrawingPdf, getVersionDependencyClosure } from '@/lib/supabase/reviews'
import type { ReviewPackageDraftItem } from '@/types/reviewPackageDraft'

import { itemPreviewKind, summarizeClosure, type DependencySummary } from '../lib/itemInfo'

export type PdfStatus = 'ready' | 'missing' | 'not_needed' | 'unknown'

export interface PackageItemInfo {
  dependencies: DependencySummary | null
  dependenciesFailed: boolean
  pdf: PdfStatus
}

/** Lookups run a few at a time so a 200-item package does not fire 400 requests at once. */
const LOOKUP_CONCURRENCY = 4

async function loadPdfStatus(item: ReviewPackageDraftItem): Promise<PdfStatus> {
  if (itemPreviewKind(item.extension) !== 'drawing') return 'not_needed'
  try {
    return (await getDrawingPdf(item.fileVersionId)) ? 'ready' : 'missing'
  } catch (error) {
    log.warn('[ReviewPackage]', 'PDF status lookup failed', { error, fileVersionId: item.fileVersionId })
    return 'unknown'
  }
}

async function loadInfo(item: ReviewPackageDraftItem): Promise<PackageItemInfo> {
  const pdf = await loadPdfStatus(item)
  try {
    const rows = await getVersionDependencyClosure(item.fileVersionId)
    return { dependencies: summarizeClosure(rows), dependenciesFailed: false, pdf }
  } catch (error) {
    log.warn('[ReviewPackage]', 'Dependency lookup failed', { error, fileVersionId: item.fileVersionId })
    return { dependencies: null, dependenciesFailed: true, pdf }
  }
}

async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]
      await task()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

export function usePackageItemInfo(items: readonly ReviewPackageDraftItem[]) {
  const [info, setInfo] = useState<Record<string, PackageItemInfo>>({})
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const pending = items.filter((item) => !requested.current.has(item.fileVersionId))
    if (pending.length === 0) return
    for (const item of pending) requested.current.add(item.fileVersionId)
    void runLimited(
      pending.map((item) => async () => {
        const result = await loadInfo(item)
        if (mounted.current) setInfo((prev) => ({ ...prev, [item.fileVersionId]: result }))
      }),
      LOOKUP_CONCURRENCY,
    )
  }, [items])

  /** Re-read PDF status (after generating PDFs). */
  const refreshPdfStatus = useCallback(async (targets: readonly ReviewPackageDraftItem[]) => {
    await runLimited(
      targets.map((item) => async () => {
        const pdf = await loadPdfStatus(item)
        if (!mounted.current) return
        setInfo((prev) => {
          const current = prev[item.fileVersionId]
          if (!current) return prev
          return { ...prev, [item.fileVersionId]: { ...current, pdf } }
        })
      }),
      LOOKUP_CONCURRENCY,
    )
  }, [])

  return { info, refreshPdfStatus }
}
