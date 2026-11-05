/**
 * Which vaults an order's hidden lines are in (5.13.0, schema 515): `supply_order_count_hidden_lines`
 * returns `[{vault_id, vault_name, count}]` for the lines this user cannot read. Vault names are
 * already visible to the organization; nothing else about the lines is returned. A refusal or an
 * older schema gives `null`, and the UI falls back to the plain count.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logger'
import { getSupabaseClient } from '@/lib/supabase/client'

import { isRow } from './rows'

export interface HiddenLineVault {
  vaultId: string
  /** Null when the vault row is gone. */
  vaultName: string | null
  count: number
}

/** The RPC's rows to `HiddenLineVault`s, the largest count first; odd rows are dropped. Pure. */
export function toHiddenLineVaults(data: unknown): HiddenLineVault[] {
  const rows = Array.isArray(data) ? data : []
  return rows
    .filter(isRow)
    .map((r) => ({
      vaultId: typeof r.vault_id === 'string' ? r.vault_id : '',
      vaultName: typeof r.vault_name === 'string' && r.vault_name !== '' ? r.vault_name : null,
      count: typeof r.count === 'number' ? r.count : Number(r.count),
    }))
    .filter((v) => v.vaultId !== '' && Number.isFinite(v.count) && v.count > 0)
    .sort((a, b) => b.count - a.count || (a.vaultName ?? '').localeCompare(b.vaultName ?? ''))
}

/** The vaults of an order's hidden lines, or null when the server could not say. Never throws. */
export async function getHiddenLineSummary(orderId: string): Promise<HiddenLineVault[] | null> {
  try {
    const client = getSupabaseClient() as unknown as SupabaseClient
    const { data, error } = await client.rpc('supply_order_count_hidden_lines', { p_order_id: orderId })
    if (error) {
      log.warn('[Orders]', 'supply_order_count_hidden_lines failed', { code: error.code, message: error.message })
      return null
    }
    return toHiddenLineVaults(data)
  } catch (error) {
    log.warn('[Orders]', 'supply_order_count_hidden_lines failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
