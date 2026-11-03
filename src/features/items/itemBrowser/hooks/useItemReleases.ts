/**
 * The released versions of the item browser's primary files (schema 509). Read in batches of 100
 * files per query (`listReleasedVersions`), only for files not read yet or whose version or state
 * changed since, so a vault of items costs a handful of queries once and one per change after.
 * The map holds one entry per primary file of the vault and is dropped on an organization change.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { listReleasedVersions } from '@/lib/supabase/releases'
import type { ItemRow } from '@/types/item'
import type { VersionRelease } from '@/types/releases'

import { releaseFetchPlan } from './itemReleases'

export function useItemReleases(rows: readonly ItemRow[], orgId: string | null): Map<string, VersionRelease[]> {
  const [releases, setReleases] = useState<Map<string, VersionRelease[]>>(new Map())
  const loaded = useRef(new Map<string, string>())

  useEffect(() => {
    loaded.current = new Map()
    setReleases(new Map())
  }, [orgId])

  const primaries = useMemo(() => {
    const list: { fileId: string; signature: string }[] = []
    for (const row of rows) {
      const id = row.primaryFileId
      if (!id) continue
      const pdm = row.files.find((f) => f.id === id)
      list.push({ fileId: id, signature: `${pdm?.version ?? 0}:${pdm?.workflow_state_id ?? ''}` })
    }
    return list
  }, [rows])

  useEffect(() => {
    if (!orgId) return
    const ids = releaseFetchPlan(primaries, loaded.current)
    if (ids.length === 0) return
    const signatures = new Map(primaries.map((p) => [p.fileId, p.signature]))
    let cancelled = false
    void (async () => {
      try {
        const byFile = await listReleasedVersions(ids)
        if (cancelled) return
        for (const id of ids) loaded.current.set(id, signatures.get(id) ?? '')
        setReleases((prev) => {
          const next = new Map(prev)
          for (const [id, list] of byFile) next.set(id, list)
          return next
        })
      } catch (error) {
        log.warn('[ItemBrowser]', 'Reading released versions failed', { error, count: ids.length })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [primaries, orgId])

  return releases
}
