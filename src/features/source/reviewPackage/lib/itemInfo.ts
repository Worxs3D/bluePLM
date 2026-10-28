/**
 * Summaries the package pane shows per item: how many files the pinned version depends on and
 * whether those versions are exact, and whether a drawing already has its review PDF.
 */

import type { DependencyClosureRow } from '@/types/reviews'

export interface DependencySummary {
  /** Distinct files below the root (each counted once however often it is referenced). */
  count: number
  /** Every edge resolved to the exact child version recorded at check-in. */
  exact: boolean
  /** References that resolved to no vault file version. */
  missing: number
}

export function summarizeClosure(rows: readonly DependencyClosureRow[]): DependencySummary {
  const files = new Set<string>()
  let exact = true
  let missing = 0
  for (const row of rows) {
    if (!row.exact) exact = false
    if (row.depth === 0) continue
    if (row.missing) {
      missing++
      continue
    }
    files.add(row.fileVersionId ?? row.fileId ?? row.referencePath ?? '')
  }
  return { count: files.size, exact, missing }
}

/** What the reviewer will look at for an item. */
export type ItemPreviewKind = 'drawing' | 'pdf' | 'other'

export function itemPreviewKind(extension: string | null): ItemPreviewKind {
  const ext = (extension ?? '').toLowerCase().replace(/^(?!\.)/, '.')
  if (ext === '.slddrw') return 'drawing'
  if (ext === '.pdf') return 'pdf'
  return 'other'
}
