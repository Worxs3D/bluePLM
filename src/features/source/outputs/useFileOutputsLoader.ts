/**
 * Loads the version outputs of files the file list expands (drawings through `expandedDrawingRefs`,
 * parts and assemblies through `expandedConfigFiles`): first each file's latest checked-in
 * version id (one batched query), then that version's outputs (`loadVersionOutputs`, which writes
 * the store). A file is read again each time it is expanded, and when its version moves on (a
 * check-in elsewhere). A failed read is not retried for `RETRY_AFTER_MS`, so a database without
 * schema 505 costs one query per expansion, never a loop.
 */
import { useEffect, useMemo, useRef } from 'react'

import { log } from '@/lib/logger'
import { loadVersionOutputs } from '@/lib/outputs'
import { getFileVersionIdsByNumber } from '@/lib/supabase/versionOutputs'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import { outputsToLoad } from './outputRowModel'

const RETRY_AFTER_MS = 60_000
const MAX_FAILURES_KEPT = 500

export function useFileOutputsLoader(
  files: readonly LocalFile[],
  expandedDrawingRefs: ReadonlySet<string>,
  expandedConfigFiles: ReadonlySet<string>,
): void {
  const setFileOutputVersions = usePDMStore((s) => s.setFileOutputVersions)
  const setVersionOutputs = usePDMStore((s) => s.setVersionOutputs)
  const inFlight = useRef(new Set<string>())
  const failedAt = useRef(new Map<string, number>())
  const previous = useRef<ReadonlySet<string>>(new Set())
  const expanded = useMemo(
    () => new Set([...expandedDrawingRefs, ...expandedConfigFiles]),
    [expandedDrawingRefs, expandedConfigFiles],
  )

  useEffect(() => {
    const now = Date.now()
    for (const [id, at] of failedAt.current) if (now - at > RETRY_AFTER_MS) failedAt.current.delete(id)
    const skip = new Set([...inFlight.current, ...failedAt.current.keys()])
    const state = usePDMStore.getState()
    const plan = outputsToLoad(files, expanded, previous.current, state.fileOutputVersions, state.versionOutputs, skip)
    previous.current = expanded
    if (plan.resolve.length === 0 && plan.load.length === 0) return

    const ids = plan.resolve.map((r) => r.fileId)
    for (const id of ids) inFlight.current.add(id)
    const fail = (fileIds: readonly string[], err: unknown) => {
      log.debug('[FileList]', 'Version outputs unavailable', {
        count: fileIds.length,
        error: err instanceof Error ? err.message : String(err),
      })
      for (const id of fileIds) failedAt.current.set(id, Date.now())
      while (failedAt.current.size > MAX_FAILURES_KEPT) {
        const oldest = failedAt.current.keys().next().value
        if (oldest === undefined) break
        failedAt.current.delete(oldest)
      }
    }

    void (async () => {
      const versionIds = new Set(plan.load)
      try {
        if (plan.resolve.length > 0) {
          const resolved = await getFileVersionIdsByNumber(plan.resolve)
          setFileOutputVersions(resolved)
          for (const entry of resolved.values()) versionIds.add(entry.fileVersionId)
          // A version row that is not readable (yet) is asked for again later, not on every render.
          const missing = ids.filter((id) => !resolved.has(id))
          if (missing.length > 0) fail(missing, new Error('Version not found'))
        }
        if (versionIds.size > 0) await loadVersionOutputs([...versionIds])
      } catch (err) {
        fail(ids, err)
        // Show "none" rather than leave the rows loading; the next expansion reads again.
        if (versionIds.size > 0) setVersionOutputs(new Map([...versionIds].map((id) => [id, []])))
      } finally {
        for (const id of ids) inFlight.current.delete(id)
      }
    })()
  }, [files, expanded, setFileOutputVersions, setVersionOutputs])
}
