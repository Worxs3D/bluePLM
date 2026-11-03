/**
 * Loads the version outputs the file list shows: for files it expands (drawings through
 * `expandedDrawingRefs`, parts and assemblies through `expandedConfigFiles`) and, while the Outputs
 * column is shown, for the listed drawings it shows. Each file's newest output per kind across its
 * versions is one batched read (`loadOutputHeads`, which writes the store); an expanded file also
 * gets its latest version id resolved, so a running job can be matched to its row. A file is read
 * again each time it is expanded, and when its version moves on (a check-in elsewhere). A failed
 * read is not retried for `RETRY_AFTER_MS`, so a database without schema 505 costs one query per
 * expansion, never a loop.
 */
import { useEffect, useMemo, useRef } from 'react'

import { log } from '@/lib/logger'
import { loadOutputHeads } from '@/lib/outputs'
import { getFileVersionIdsByNumber } from '@/lib/supabase/versionOutputs'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import { outputsToLoad } from './outputRowModel'

const RETRY_AFTER_MS = 60_000
const MAX_FAILURES_KEPT = 500
const MAX_HEADS_AT_KEPT = 2000
const NO_PATHS: ReadonlySet<string> = new Set()

export function useFileOutputsLoader(
  files: readonly LocalFile[],
  expandedDrawingRefs: ReadonlySet<string>,
  expandedConfigFiles: ReadonlySet<string>,
  /** Paths of the listed drawings the Outputs column shows. */
  columnPaths: ReadonlySet<string> = NO_PATHS,
): void {
  const setFileOutputVersions = usePDMStore((s) => s.setFileOutputVersions)
  const setFileOutputHeads = usePDMStore((s) => s.setFileOutputHeads)
  const inFlight = useRef(new Set<string>())
  const failedAt = useRef(new Map<string, number>())
  const headsAt = useRef(new Map<string, number>())
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
    const plan = outputsToLoad(
      files,
      expanded,
      previous.current,
      state.fileOutputVersions,
      state.fileOutputHeads,
      headsAt.current,
      skip,
      columnPaths,
    )
    previous.current = expanded
    if (plan.resolve.length === 0 && plan.heads.length === 0) return

    const ids = [...new Set([...plan.resolve.map((r) => r.fileId), ...plan.heads])]
    const versionOf = new Map(files.map((f) => [f.pdmData?.id, f.pdmData?.version]))
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
      try {
        if (plan.resolve.length > 0) {
          const resolved = await getFileVersionIdsByNumber(plan.resolve)
          setFileOutputVersions(resolved)
          // A version row that is not readable (yet) is asked for again later, not on every render.
          const missing = plan.resolve.map((r) => r.fileId).filter((id) => !resolved.has(id))
          if (missing.length > 0) fail(missing, new Error('Version not found'))
        }
        if (plan.heads.length > 0) {
          await loadOutputHeads(plan.heads)
          for (const id of plan.heads) {
            const version = versionOf.get(id)
            headsAt.current.delete(id)
            if (version) headsAt.current.set(id, version)
          }
          while (headsAt.current.size > MAX_HEADS_AT_KEPT) {
            const oldest = headsAt.current.keys().next().value
            if (oldest === undefined) break
            headsAt.current.delete(oldest)
          }
        }
      } catch (err) {
        fail(ids, err)
        // Show "none" rather than leave the rows loading; the next expansion reads again.
        if (plan.heads.length > 0) setFileOutputHeads(new Map(plan.heads.map((id) => [id, []])))
      } finally {
        for (const id of ids) inFlight.current.delete(id)
      }
    })()
  }, [files, expanded, columnPaths, setFileOutputVersions, setFileOutputHeads])
}
