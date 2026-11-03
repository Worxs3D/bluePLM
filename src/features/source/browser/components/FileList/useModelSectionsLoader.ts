/**
 * Reads the chevron's Drawings and Used in sections of expanded parts and assemblies
 * (`modelSectionsToLoad`): drawings that show the model (`getDrawingsForFileConfig`, every
 * configuration) and assemblies that reference it (`getWhereUsed`, the Where Used tab's source).
 * One query per file and section. A failed read shows the section empty and is not retried for
 * `RETRY_AFTER_MS`, so a lost connection costs one query per expansion, never a loop.
 */
import { useEffect, useRef } from 'react'

import { log } from '@/lib/logger'
import { getWhereUsed } from '@/lib/supabase'
import { getDrawingsForFileConfig } from '@/lib/supabase/files'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'

import { uniqueParents } from './fileSections'
import { assembliesUsingModel, modelSectionsToLoad, type WhereUsedRow } from './modelSectionsToLoad'

const RETRY_AFTER_MS = 60_000
const MAX_FAILURES_KEPT = 500

export function useModelSectionsLoader(files: readonly LocalFile[], expandedConfigFiles: ReadonlySet<string>): void {
  const toggles = usePDMStore((s) => s.fileSectionToggles)
  const previous = useRef<ReadonlySet<string>>(new Set())
  const inFlight = useRef({ drawings: new Set<string>(), usedIn: new Set<string>() })
  const failedAt = useRef(new Map<string, number>())

  useEffect(() => {
    const now = Date.now()
    for (const [key, at] of failedAt.current) if (now - at > RETRY_AFTER_MS) failedAt.current.delete(key)
    const state = usePDMStore.getState()
    const plan = modelSectionsToLoad(
      files,
      expandedConfigFiles,
      previous.current,
      toggles,
      state.modelDrawings,
      state.modelUsedIn,
      inFlight.current,
    )
    previous.current = expandedConfigFiles
    const drawings = plan.drawings.filter((id) => !failedAt.current.has(`d:${id}`))
    const usedIn = plan.usedIn.filter((id) => !failedAt.current.has(`u:${id}`))

    const read = (
      ids: string[],
      kind: 'd' | 'u',
      running: Set<string>,
      fetch: (id: string) => Promise<DrawingRefItem[]>,
      store: (byFile: ReadonlyMap<string, DrawingRefItem[]>) => void,
    ) => {
      for (const id of ids) {
        running.add(id)
        void fetch(id)
          .then((items) => store(new Map([[id, items]])))
          .catch((err) => {
            log.debug('[FileList]', 'Model section unavailable', {
              section: kind === 'd' ? 'drawings' : 'usedIn',
              error: err instanceof Error ? err.message : String(err),
            })
            failedAt.current.set(`${kind}:${id}`, Date.now())
            while (failedAt.current.size > MAX_FAILURES_KEPT) {
              const oldest = failedAt.current.keys().next().value
              if (oldest === undefined) break
              failedAt.current.delete(oldest)
            }
            store(new Map([[id, []]]))
          })
          .finally(() => running.delete(id))
      }
    }

    read(
      drawings,
      'd',
      inFlight.current.drawings,
      async (id) => {
        const result = await getDrawingsForFileConfig(id, null)
        if (result.error) throw new Error(result.error)
        return uniqueParents(result.items)
      },
      state.setModelDrawings,
    )
    read(
      usedIn,
      'u',
      inFlight.current.usedIn,
      async (id) => {
        const { references, error } = await getWhereUsed(id)
        if (error) throw new Error(error.message)
        return assembliesUsingModel((references ?? []) as unknown as WhereUsedRow[])
      },
      state.setModelUsedIn,
    )
  }, [files, expandedConfigFiles, toggles])
}
