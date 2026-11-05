import { useEffect, useState } from 'react'

import { getHiddenLineSummary, type HiddenLineVault } from '@/lib/orders/hiddenLines'

/**
 * The vaults of an order's lines this user cannot see (`supply_order_count_hidden_lines`), read
 * again when the order or the number of hidden lines changes. Null until read, with no hidden
 * lines, or when the server could not say (the note then gives the count alone).
 */
export function useHiddenLineVaults(orderId: string, hidden: number): HiddenLineVault[] | null {
  const [vaults, setVaults] = useState<HiddenLineVault[] | null>(null)
  useEffect(() => {
    setVaults(null)
    if (hidden <= 0) return
    let cancelled = false
    void getHiddenLineSummary(orderId).then((summary) => {
      if (!cancelled) setVaults(summary)
    })
    return () => {
      cancelled = true
    }
  }, [orderId, hidden])
  return vaults
}
