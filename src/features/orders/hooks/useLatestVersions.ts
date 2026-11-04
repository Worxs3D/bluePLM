import { useEffect, useState } from 'react'

import { log } from '@/lib/logger'
import { getLatestCheckedInVersions } from '@/lib/supabase/reviews'
import type { SupplyOrderLine } from '@/types/orders'

export interface LatestVersion {
  fileVersionId: string
  version: number
}

/**
 * The newest checked-in version of each line's file, for the "newer version" badge of a draft.
 * Looked up again when the lines or their pinned versions change; empty while `enabled` is
 * false (a sent order is frozen) or when the lookup fails.
 */
export function useLatestVersions(
  lines: readonly SupplyOrderLine[] | undefined,
  enabled: boolean,
): ReadonlyMap<string, LatestVersion> {
  const [latest, setLatest] = useState<ReadonlyMap<string, LatestVersion>>(new Map())
  // Purged lines (no file left) have no newer version to look up.
  const living = (lines ?? []).filter((l) => !!l.fileId && !!l.fileVersionId)
  const key = enabled ? living.map((l) => `${l.fileId}:${l.version}`).join(',') : ''

  useEffect(() => {
    if (!key) {
      setLatest(new Map())
      return
    }
    let cancelled = false
    getLatestCheckedInVersions(living.map((l) => l.fileId as string))
      .then((rows) => {
        if (cancelled) return
        setLatest(
          new Map(rows.map((r) => [r.fileId, { fileVersionId: r.fileVersionId, version: r.version }])),
        )
      })
      .catch((error: unknown) => {
        log.warn('[Orders]', 'Looking up the latest versions of order lines failed', { error })
      })
    return () => {
      cancelled = true
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- key stands for the living lines

  return latest
}
