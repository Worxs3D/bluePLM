/**
 * The released versions of one drawing, as a set of `file_version` ids (schema 509), for the
 * report menu (a released version's report is frozen: no overwrite, no delete).
 *
 * The store's `fileReleases` (the outputs slice, loaded with the file list's child rows) is used
 * when it holds the drawing; otherwise the drawing's releases are read once with
 * `listReleasedVersions`. A read that fails (a database before 509) counts as nothing released:
 * the server refuses an overwrite or delete of a released version's report anyway.
 */
import { useEffect, useMemo, useState } from 'react'

import { log } from '@/lib/logger'
import { listReleasedVersions } from '@/lib/supabase/releases'
import { usePDMStore } from '@/stores/pdmStore'

const NONE: ReadonlySet<string> = new Set()

export function useReleasedVersionIds(fileId: string | undefined): ReadonlySet<string> {
  const stored = usePDMStore((s) => (fileId ? s.fileReleases.get(fileId) : undefined))
  const [fetched, setFetched] = useState<{ fileId: string; ids: ReadonlySet<string> } | null>(null)

  useEffect(() => {
    if (!fileId || stored) return
    let cancelled = false
    listReleasedVersions([fileId])
      .then((byFile) => {
        if (cancelled) return
        setFetched({ fileId, ids: new Set((byFile.get(fileId) ?? []).map((r) => r.fileVersionId)) })
      })
      .catch((err: unknown) => {
        log.warn('[InspectionReports]', 'Released versions unavailable', {
          fileId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
    }
  }, [fileId, stored])

  return useMemo(() => {
    if (stored) return new Set(stored.map((r) => r.fileVersionId))
    return fetched && fetched.fileId === fileId ? fetched.ids : NONE
  }, [stored, fetched, fileId])
}
