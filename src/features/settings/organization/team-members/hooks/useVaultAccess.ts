/**
 * useVaultAccess - Hook for managing vault access
 *
 * Provides state and operations for vault access including:
 * - Loading vaults and access mappings into Zustand store
 * - Saving user and team vault access
 * - Computing accessible vaults for users
 *
 * State is managed in the organizationMetadataSlice of the PDM store.
 */
import { useCallback, useEffect, useRef } from 'react'
import { supabase, getOrgVaultAccess, setUserVaultAccess } from '@/lib/supabase'
import {
  getCommunityTeamVaultAccess,
  getCommunityTeams,
  getCommunityOrgVaultAccess,
  getCommunityVaults,
  setCommunityUserVaultAccess,
  setCommunityTeamVaultAccess,
} from '@/lib/community'
import { isMdbBackendActive } from '@/lib/backendAdapter'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrgVault } from '@/stores/types'
import { type TeamVaultAccessJoin, castQueryResult, insertTeamVaultAccess } from './supabaseHelpers'

export interface VaultAccessLoadPlan {
  loadVaults: boolean
  loadUserAccess: boolean
  loadTeamAccess: boolean
}

export function getDirectVaultIds(
  userId: string,
  vaultAccessMap: Record<string, string[]>,
): string[] {
  return Object.keys(vaultAccessMap).filter((vaultId) => vaultAccessMap[vaultId].includes(userId))
}

export function getInheritedVaultIds(
  teamIds: string[],
  teamVaultAccessMap: Record<string, string[]>,
): string[] {
  return [...new Set(teamIds.flatMap((teamId) => teamVaultAccessMap[teamId] ?? []))]
}

export function getEffectiveVaultIds(
  userId: string,
  teamIds: string[],
  role: string,
  vaultAccessMap: Record<string, string[]>,
  teamVaultAccessMap: Record<string, string[]>,
): string[] {
  const direct = getDirectVaultIds(userId, vaultAccessMap)
  if (role === 'guest') return direct
  return [...new Set([...direct, ...getInheritedVaultIds(teamIds, teamVaultAccessMap)])]
}

/**
 * Keep the effect's load policy independently testable. This initially mirrors
 * the legacy behaviour so the regression test can demonstrate the bug before
 * the policy is corrected.
 */
export function getVaultAccessLoadPlan(
  orgId: string | null,
  orgVaultsLoaded: boolean,
  isLoading: boolean,
): VaultAccessLoadPlan {
  const hasOrganization = Boolean(orgId)
  return {
    loadVaults: hasOrganization && !orgVaultsLoaded && !isLoading,
    // Access mappings are independent metadata. They must be loaded even when
    // another screen populated the vault catalogue earlier.
    loadUserAccess: hasOrganization,
    loadTeamAccess: hasOrganization,
  }
}

export function useVaultAccess(orgId: string | null) {
  // Get actions from store
  const user = usePDMStore((s) => s.user)
  const addToast = usePDMStore((s) => s.addToast)

  // Vault access state from store
  const vaults = usePDMStore((s) => s.orgVaults)
  const vaultAccessMap = usePDMStore((s) => s.vaultAccessMap)
  const teamVaultAccessMap = usePDMStore((s) => s.teamVaultAccessMap)
  const isLoading = usePDMStore((s) => s.orgVaultsLoading)
  const orgVaultsLoaded = usePDMStore((s) => s.orgVaultsLoaded)

  // Listen to vaultsRefreshKey to reload when vaults are created/deleted
  const vaultsRefreshKey = usePDMStore((s) => s.vaultsRefreshKey)
  const prevRefreshKeyRef = useRef(vaultsRefreshKey)

  // Vault access actions from store
  const setOrgVaults = usePDMStore((s) => s.setOrgVaults)
  const setOrgVaultsLoading = usePDMStore((s) => s.setOrgVaultsLoading)
  const setVaultAccessMap = usePDMStore((s) => s.setVaultAccessMap)
  const setTeamVaultAccessMap = usePDMStore((s) => s.setTeamVaultAccessMap)

  const loadVaults = useCallback(async () => {
    if (!orgId) return

    setOrgVaultsLoading(true)
    try {
      if (isMdbBackendActive()) {
        const communityVaults = await getCommunityVaults()
        setOrgVaults(
          communityVaults.map((vault) => ({
            id: vault.id,
            name: vault.name,
            slug: vault.id,
            description: vault.networkRoot,
            storage_bucket: 'network-vault',
            is_default: false,
            created_at: vault.createdAt,
          })),
        )
        return
      }
      const { data, error } = await supabase
        .from('vaults')
        .select('*')
        .eq('org_id', orgId)
        .order('is_default', { ascending: false })
        .order('name')

      if (error) throw error
      setOrgVaults(castQueryResult<OrgVault[]>(data || []))
    } catch (error) {
      log.error('[VaultAccess]', 'Failed to load org vaults', { error: error })
      setOrgVaultsLoading(false)
    }
  }, [orgId, setOrgVaults, setOrgVaultsLoading])

  const loadVaultAccess = useCallback(async () => {
    if (!orgId) return

    if (isMdbBackendActive()) {
      try {
        setVaultAccessMap(await getCommunityOrgVaultAccess())
      } catch (error) {
        log.error('[VaultAccess]', 'Failed to load MDB vault access', { error })
      }
      return
    }

    const { accessMap, error } = await getOrgVaultAccess(orgId)
    if (error) {
      log.error('[VaultAccess]', 'Failed to load vault access', { error })
    } else {
      setVaultAccessMap(accessMap)
    }
  }, [orgId, setVaultAccessMap])

  const loadTeamVaultAccess = useCallback(async () => {
    if (!orgId) return

    try {
      if (isMdbBackendActive()) {
        const teams = await getCommunityTeams()
        const entries = await Promise.all(
          teams.map(async (team) => [team.id, await getCommunityTeamVaultAccess(team.id)] as const),
        )
        setTeamVaultAccessMap(Object.fromEntries(entries))
        return
      }
      const { data, error } = await supabase.from('team_vault_access').select('team_id, vault_id')

      if (error) throw error

      const typedData = castQueryResult<TeamVaultAccessJoin[]>(data || [])

      // Build team -> vault[] map
      const accessMap: Record<string, string[]> = {}
      for (const row of typedData) {
        if (!accessMap[row.team_id]) {
          accessMap[row.team_id] = []
        }
        accessMap[row.team_id].push(row.vault_id)
      }
      setTeamVaultAccessMap(accessMap)
    } catch (error) {
      log.error('[VaultAccess]', 'Failed to load team vault access', { error: error })
    }
  }, [orgId, setTeamVaultAccessMap])

  const loadAll = useCallback(async () => {
    await Promise.all([loadVaults(), loadVaultAccess(), loadTeamVaultAccess()])
  }, [loadVaults, loadVaultAccess, loadTeamVaultAccess])

  const saveUserVaultAccess = useCallback(
    async (userId: string, vaultIds: string[], userName?: string): Promise<boolean> => {
      if (!user || !orgId) return false

      try {
        if (isMdbBackendActive()) {
          await setCommunityUserVaultAccess(userId, vaultIds)
          addToast(
            'success',
            t('mdbSetup.userVaultAccessUpdated', { name: userName || t('mdbSetup.userLabel') }),
          )
          await loadVaultAccess()
          return true
        }
        const result = await setUserVaultAccess(userId, vaultIds, user.id, orgId)

        if (result.success) {
          addToast(
            'success',
            t('mdbSetup.userVaultAccessUpdated', { name: userName || t('mdbSetup.userLabel') }),
          )
          // Reload vault access to get updated map
          await loadVaultAccess()
          return true
        } else {
          addToast('error', result.error || t('mdbSetup.vaultAccessUpdateFailed'))
          return false
        }
      } catch {
        addToast('error', t('mdbSetup.vaultAccessUpdateFailed'))
        return false
      }
    },
    [user, orgId, addToast, loadVaultAccess],
  )

  const saveTeamVaultAccess = useCallback(
    async (teamId: string, vaultIds: string[], teamName?: string): Promise<boolean> => {
      if (!user) return false

      try {
        if (isMdbBackendActive()) {
          await setCommunityTeamVaultAccess(teamId, vaultIds)
          setTeamVaultAccessMap({
            ...teamVaultAccessMap,
            [teamId]: vaultIds,
          })
          addToast(
            'success',
            t('mdbSetup.teamVaultAccessUpdated', { name: teamName || t('mdbSetup.teamLabel') }),
          )
          return true
        }
        // Delete existing access
        await supabase.from('team_vault_access').delete().eq('team_id', teamId)

        // Insert new access
        if (vaultIds.length > 0) {
          await insertTeamVaultAccess(
            vaultIds.map((vaultId) => ({
              team_id: teamId,
              vault_id: vaultId,
              granted_by: user.id,
            })),
          )
        }

        // Update store with new team vault access
        setTeamVaultAccessMap({
          ...teamVaultAccessMap,
          [teamId]: vaultIds,
        })

        addToast(
          'success',
          t('mdbSetup.teamVaultAccessUpdated', { name: teamName || t('mdbSetup.teamLabel') }),
        )
        return true
      } catch {
        addToast('error', t('mdbSetup.vaultAccessUpdateFailed'))
        return false
      }
    },
    [user, addToast, teamVaultAccessMap, setTeamVaultAccessMap],
  )

  // Get directly assigned vault IDs for editing. Team access is shown separately
  // so saving does not accidentally convert inherited access into direct access.
  const getUserDirectVaults = useCallback(
    (userId: string): string[] => getDirectVaultIds(userId, vaultAccessMap),
    [vaultAccessMap],
  )

  const getUserInheritedVaults = useCallback(
    (teamIds: string[]): string[] => getInheritedVaultIds(teamIds, teamVaultAccessMap),
    [teamVaultAccessMap],
  )

  // Get effective vault IDs for display and access summaries.
  const getUserAccessibleVaults = useCallback(
    (userId: string, teamIds: string[] = [], role = 'member'): string[] =>
      getEffectiveVaultIds(userId, teamIds, role, vaultAccessMap, teamVaultAccessMap),
    [teamVaultAccessMap, vaultAccessMap],
  )

  // Get vault access count for a user
  const getUserVaultAccessCount = useCallback(
    (userId: string, teamIds: string[] = [], role = 'member'): number =>
      getEffectiveVaultIds(userId, teamIds, role, vaultAccessMap, teamVaultAccessMap).length,
    [teamVaultAccessMap, vaultAccessMap],
  )

  // The catalogue may already have been loaded by another settings screen.
  useEffect(() => {
    const plan = getVaultAccessLoadPlan(orgId, orgVaultsLoaded, isLoading)
    if (plan.loadVaults) void loadVaults()
  }, [orgId, orgVaultsLoaded, isLoading, loadVaults])

  // Access mappings have their own lifecycle and must never be skipped merely
  // because the catalogue was populated earlier.
  useEffect(() => {
    if (orgId) void Promise.all([loadVaultAccess(), loadTeamVaultAccess()])
  }, [orgId, loadVaultAccess, loadTeamVaultAccess])

  // Reload when vaultsRefreshKey changes (vault created/deleted elsewhere)
  useEffect(() => {
    // Skip initial mount - only reload on actual changes
    if (vaultsRefreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = vaultsRefreshKey
      if (orgId) {
        log.debug('[VaultAccess]', 'Reloading vaults due to refresh trigger')
        loadAll()
      }
    }
  }, [orgId, vaultsRefreshKey, loadAll])

  return {
    vaults,
    vaultAccessMap,
    teamVaultAccessMap,
    isLoading,
    loadVaults,
    loadVaultAccess,
    loadTeamVaultAccess,
    loadAll,
    saveUserVaultAccess,
    saveTeamVaultAccess,
    getUserDirectVaults,
    getUserInheritedVaults,
    getUserAccessibleVaults,
    getUserVaultAccessCount,
  }
}
