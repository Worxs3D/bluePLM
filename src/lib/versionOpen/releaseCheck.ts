/**
 * Before a release (gap 12 c): which assemblies and drawings being released have a newest
 * checked-in version whose references are approximate, so the release would not freeze them.
 *
 * A release stamps the version the file is at. Its closure is approximate when the version was
 * checked in before exact reference tracking (schema 107), or when a reference's content did not
 * match a vault version at check-in; such a release still happens, but opening it later follows
 * today's references, so the user is warned first. Parts reference nothing the release could
 * freeze and are not checked.
 *
 * A file whose closure cannot be read is not reported (the release itself still goes through the
 * database's own checks); the read error is logged.
 */

import { processWithConcurrency } from '@/lib/concurrency'
import { log } from '@/lib/logger'
import { getSupabaseClient } from '@/lib/supabase/client'

import { getFreezeStatus } from './freeze'
import type { FreezeStatus } from './types'

/** The release candidate: a file row with its server id and the version it is at. */
export interface ReleaseCandidate {
  name: string
  fileId: string
  version: number | null
}

export interface ApproximateRelease {
  name: string
  fileId: string
  version: number
  fileVersionId: string
}

const CONCURRENCY = 4

/** Assemblies and drawings: the files whose references a release freezes. */
export function hasFreezableReferences(fileName: string): boolean {
  return /\.(sldasm|slddrw)$/i.test(fileName)
}

export interface ReleaseCheckDeps {
  /** file id -> the version id of the given version number (or of the newest one). */
  versionIds: (candidates: readonly ReleaseCandidate[]) => Promise<Map<string, { id: string; version: number }>>
  freezeStatus: (fileVersionId: string) => Promise<FreezeStatus>
}

async function versionIdOf(c: ReleaseCandidate): Promise<{ id: string; version: number } | null> {
  // The version the file is at; failing that, its newest checked-in one.
  let query = getSupabaseClient().from('file_version').select('id, version').eq('file_id', c.fileId)
  if (c.version !== null) query = query.eq('version', c.version)
  const { data, error } = await query.order('version', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  const row = data?.[0]
  if (row) return { id: row.id, version: row.version }
  return c.version !== null ? versionIdOf({ ...c, version: null }) : null
}

async function versionIds(
  candidates: readonly ReleaseCandidate[],
): Promise<Map<string, { id: string; version: number }>> {
  const found = await processWithConcurrency([...candidates], CONCURRENCY, async (c) => ({
    fileId: c.fileId,
    row: await versionIdOf(c),
  }))
  const out = new Map<string, { id: string; version: number }>()
  for (const { fileId, row } of found) if (row) out.set(fileId, row)
  return out
}

export const defaultReleaseCheckDeps: ReleaseCheckDeps = {
  versionIds,
  freezeStatus: (id) => getFreezeStatus(id),
}

/** The candidates whose release would not freeze their references. Never throws. */
export async function findApproximateReleases(
  candidates: readonly ReleaseCandidate[],
  deps: ReleaseCheckDeps = defaultReleaseCheckDeps,
): Promise<ApproximateRelease[]> {
  const relevant = candidates.filter((c) => c.fileId && hasFreezableReferences(c.name))
  if (relevant.length === 0) return []
  let ids: Map<string, { id: string; version: number }>
  try {
    ids = await deps.versionIds(relevant)
  } catch (err) {
    log.warn('[VersionOpen]', 'Release check: versions unreadable', { error: String(err) })
    return []
  }
  const checked = await processWithConcurrency([...relevant], CONCURRENCY, async (c) => {
    const v = ids.get(c.fileId)
    if (!v) return null
    try {
      const status = await deps.freezeStatus(v.id)
      return status === 'approximate'
        ? { name: c.name, fileId: c.fileId, version: v.version, fileVersionId: v.id }
        : null
    } catch (err) {
      log.warn('[VersionOpen]', 'Release check: closure unreadable', { fileId: c.fileId, error: String(err) })
      return null
    }
  })
  return checked.filter((r): r is ApproximateRelease => r !== null)
}
