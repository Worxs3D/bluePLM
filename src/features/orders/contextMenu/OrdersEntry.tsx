/**
 * The `orders` entry of both file menus: the Orders submenu (add to a draft, new order, with
 * referenced parts, view orders). It applies when the Orders module is available to the user and
 * the selection holds a checked-in file an order can pin (`orderableFiles`), the same question
 * `OrdersSubmenu` asks.
 */
import type { EntryHookResult } from '@/features/source/browser/components/ContextMenu/customizable/types'
import type { LocalFile } from '@/stores/types'

import { useOrdersAvailable } from '../hooks/useOrdersAvailable'
import { orderableFiles } from '../lib/menuTargets'
import { OrdersSubmenu } from './OrdersSubmenu'

export function useOrdersEntries({
  contextFiles,
  onClose,
}: {
  contextFiles: LocalFile[]
  onClose: () => void
}): EntryHookResult<'orders'> {
  const available = useOrdersAvailable()
  return {
    entries: {
      orders:
        available && orderableFiles(contextFiles).length > 0 ? (
          <OrdersSubmenu contextFiles={contextFiles} onClose={onClose} />
        ) : null,
    },
  }
}
