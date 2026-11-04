/**
 * The status buttons of an open order, from the transitions the server allows
 * (`nextAllowedStatuses`). One primary button at most (the forward step), the reopen or restore
 * step as a secondary button, and Cancel in the overflow menu with Duplicate and Delete.
 */

import { deletable } from '@/lib/orders/status'
import type { OrderStatus, SupplyOrder } from '@/types/orders'

export type OrderStatusActionId = 'send' | 'receive' | 'close' | 'reopen' | 'restore' | 'cancel'

export interface OrderStatusAction {
  id: OrderStatusActionId
  /** The status the action moves the order to. */
  target: OrderStatus
  /** `bar`: a button in the header; `overflow`: an entry of the "More" menu. */
  placement: 'bar' | 'overflow'
  primary: boolean
  danger: boolean
}

/** Which action a transition is, given where the order is now. */
function actionFor(current: OrderStatus, target: OrderStatus): OrderStatusActionId | null {
  switch (target) {
    case 'sent':
      return 'send'
    case 'received':
      return 'receive'
    case 'closed':
      return 'close'
    case 'cancelled':
      return 'cancel'
    case 'draft':
      return current === 'cancelled' ? 'restore' : current === 'sent' ? 'reopen' : null
  }
}

/** Forward steps first, then the steps back; Cancel last. */
const ORDER: readonly OrderStatusActionId[] = [
  'send',
  'receive',
  'close',
  'restore',
  'reopen',
  'cancel',
]

/** The status actions for an order in `current` that may move to `allowed`. */
export function orderStatusActions(
  current: OrderStatus,
  allowed: readonly OrderStatus[],
): OrderStatusAction[] {
  const ids = new Map<OrderStatusActionId, OrderStatus>()
  for (const target of allowed) {
    const id = actionFor(current, target)
    if (id) ids.set(id, target)
  }
  let primaryTaken = false
  return ORDER.filter((id) => ids.has(id)).map((id) => {
    const overflow = id === 'cancel'
    // The forward step is the view's one primary; a cancelled order's only step (restore) is too.
    const primary = !primaryTaken && !overflow && id !== 'reopen'
    if (primary) primaryTaken = true
    return {
      id,
      target: ids.get(id) as OrderStatus,
      placement: overflow ? 'overflow' : 'bar',
      primary,
      danger: id === 'cancel',
    }
  })
}

/**
 * Whether to offer Delete: a draft or cancelled order, to its creator or an administrator. The
 * server checks the same (`NOT_ALLOWED`); this only keeps the menu honest.
 */
export function canDeleteOrder(
  order: Pick<SupplyOrder, 'status' | 'createdBy'>,
  userId: string | null,
  isAdmin: boolean,
): boolean {
  if (!deletable(order)) return false
  return isAdmin || (!!userId && order.createdBy === userId)
}
