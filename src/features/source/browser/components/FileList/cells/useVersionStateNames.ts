/**
 * The names of the workflow states the versions in version history were checked in at
 * (`file_version.workflow_state_id`), read in one query per opened history.
 */
import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { log } from '@/lib/logger'

export function useVersionStateNames(stateIds: readonly (string | null | undefined)[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const key = [...new Set(stateIds.filter((id): id is string => Boolean(id)))].sort().join(',')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const ids = key.split(',')
    void (async () => {
      const { data, error } = await supabase.from('workflow_state').select('id, name, label').in('id', ids)
      if (cancelled) return
      if (error) {
        log.warn('[VersionHistory]', 'Reading the version states failed', { error })
        return
      }
      setNames(new Map((data ?? []).map((row) => [row.id, row.label || row.name])))
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  return names
}
