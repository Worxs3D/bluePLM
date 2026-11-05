/**
 * Who may read the vaults of a draft's files (`getVaultGrants`), read again whenever that set of
 * vaults changes. Null while loading or when the read failed: the picker then marks nobody, and
 * the server still refuses a reviewer who cannot see a vault (`REVIEWER_NO_VAULT_ACCESS`).
 */

import { useEffect, useState } from 'react'

import { log } from '@/lib/logger'
import { getVaultGrants } from '@/lib/supabase'

export interface DraftVaultGrants {
  users: Readonly<Record<string, readonly string[]>>
  teams: Readonly<Record<string, readonly string[]>>
}

export function useDraftVaultGrants(vaultIds: readonly (string | null)[]): DraftVaultGrants | null {
  const key = [...new Set(vaultIds.filter((v): v is string => !!v))].sort().join(',')
  const [loaded, setLoaded] = useState<{ key: string; grants: DraftVaultGrants } | null>(null)

  useEffect(() => {
    let cancelled = false
    const ids = key ? key.split(',') : []
    void getVaultGrants(ids).then((result) => {
      if (cancelled) return
      if (result.error) {
        log.warn('[ReviewPackage]', 'Loading vault access failed', { error: result.error })
        return
      }
      setLoaded({ key, grants: { users: result.users, teams: result.teams } })
    })
    return () => {
      cancelled = true
    }
  }, [key])

  // Grants read for another set of vaults say nothing about this one.
  return loaded && loaded.key === key ? loaded.grants : null
}
