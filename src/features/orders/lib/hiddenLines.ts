/**
 * The note about an order's lines in vaults this user cannot see (5.13.0): how many, in which
 * vaults, and who can give access. Without the server's summary it gives the count alone. Pure.
 */

import type { HiddenLineVault } from '@/lib/orders/hiddenLines'

type Translate = (key: string, params?: Record<string, string | number>) => string

/** At most this many vaults are named; the rest are "and N more". */
export const HIDDEN_VAULTS_NAMED = 3

/** "Electronics (2), Archive (1)" or with "and 2 more vaults". */
export function hiddenVaultList(vaults: readonly HiddenLineVault[], t: Translate): string {
  const named = vaults.slice(0, HIDDEN_VAULTS_NAMED).map((v) =>
    t('orders.hiddenVaultCount', { vault: v.vaultName ?? t('orders.hiddenVaultUnnamed'), count: v.count }),
  )
  const rest = vaults.length - named.length
  return rest > 0 ? t('orders.hiddenVaultsAndMore', { vaults: named.join(', '), count: rest }) : named.join(', ')
}

export function hiddenLinesText(hidden: number, vaults: readonly HiddenLineVault[] | null, t: Translate): string {
  const count = hidden === 1 ? t('orders.hiddenLinesOne') : t('orders.hiddenLinesMany', { count: hidden })
  if (!vaults || vaults.length === 0) return count
  const where =
    vaults.length === 1
      ? hidden === 1
        ? t('orders.hiddenLinesInVaultOne', { vault: vaults[0].vaultName ?? t('orders.hiddenVaultUnnamed') })
        : t('orders.hiddenLinesInVaultMany', { count: hidden, vault: vaults[0].vaultName ?? t('orders.hiddenVaultUnnamed') })
      : t('orders.hiddenLinesInVaults', { count: hidden, vaults: hiddenVaultList(vaults, t) })
  return `${where} ${t('orders.hiddenLinesAsk')}`
}
