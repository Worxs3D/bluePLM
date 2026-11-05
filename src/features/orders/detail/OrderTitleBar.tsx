/**
 * The top of an open order: number, status in words and the dates it moved, the title, and the
 * status actions from `nextAllowedStatuses` (one primary step, Reopen, and a "More" menu with
 * Cancel, Duplicate and Delete). Sending checks the outputs first (`SendOrderDialog`).
 */

import { useState } from 'react'
import { Copy, Trash2, XCircle } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { Button, OverflowMenu, StatusText, type OverflowMenuItem } from '@/components/core/ui'
import { nextAllowedStatuses } from '@/lib/orders'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { LineOutputState, SupplyOrder, SupplyOrderLine } from '@/types/orders'

import {
  changeOrderStatus,
  type OrderMissing,
  deleteOrderAndClose,
  duplicateAndOpenOrder,
} from '../actions'
import { STATUS_TONE, shortDate } from '../lib/format'
import { canDeleteOrder, orderStatusActions, type OrderStatusAction } from '../lib/statusActions'
import { SendOrderDialog } from './SendOrderDialog'

interface OrderTitleBarProps {
  order: SupplyOrder
  lines: SupplyOrderLine[]
  states: Record<string, LineOutputState[]> | undefined
}

export function OrderTitleBar({ order, lines, states }: OrderTitleBarProps) {
  const { t, language } = useTranslation()
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  const [busy, setBusy] = useState<string | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [serverMissing, setServerMissing] = useState<OrderMissing[] | null>(null)
  const [confirm, setConfirm] = useState<'reopen' | 'delete' | null>(null)

  const actions = orderStatusActions(order.status, nextAllowedStatuses(order))
  const bar = actions.filter((a) => a.placement === 'bar')
  const cancel = actions.find((a) => a.id === 'cancel')

  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await work()
    } finally {
      setBusy(null)
    }
  }

  const onAction = (action: OrderStatusAction) => {
    if (action.id === 'send') {
      // The server checks every line, including lines in vaults this user cannot see, and
      // refuses MISSING_OUTPUTS without changing anything; its list fills the dialog.
      void run('send', async () => {
        const result = await changeOrderStatus(order, 'sent')
        if (result.outcome === 'missing') {
          setServerMissing(result.missing ?? null)
          setSendOpen(true)
        }
      })
      return
    }
    if (action.id === 'reopen') {
      setConfirm('reopen')
      return
    }
    void run(action.id, () => changeOrderStatus(order, action.target))
  }

  const more: OverflowMenuItem[] = [
    {
      id: 'duplicate',
      label: t('orders.duplicate'),
      icon: <Copy size={14} />,
      onSelect: () => void run('duplicate', () => duplicateAndOpenOrder(order)),
    },
  ]
  if (cancel) {
    more.push({
      id: 'cancel',
      label: t('orders.action_cancel'),
      icon: <XCircle size={14} />,
      danger: true,
      onSelect: () => void run('cancel', () => changeOrderStatus(order, 'cancelled')),
    })
  }
  if (canDeleteOrder(order, userId, isAdmin)) {
    more.push({
      id: 'delete',
      label: t('orders.delete'),
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => setConfirm('delete'),
    })
  }

  const moved = statusLine(order, language, t)

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ui-fg-secondary">
          <span className="tabular-nums">{order.orderNumber}</span>
          <StatusText tone={STATUS_TONE[order.status]}>
            {t(`orders.status_${order.status}`)}
          </StatusText>
          {moved && <span>{moved}</span>}
        </div>
        <h1
          className="mt-1 truncate text-[16px] font-semibold leading-6 text-ui-fg"
          title={order.title}
        >
          {order.title}
        </h1>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {bar.map((action) => (
          <Button
            key={action.id}
            variant={action.primary ? 'primary' : 'secondary'}
            loading={busy === action.id}
            disabled={busy !== null || (action.id === 'send' && order.lineCount === 0)}
            title={action.id === 'send' && order.lineCount === 0 ? t('orders.sendEmptyHint') : undefined}
            onClick={() => onAction(action)}
          >
            {t(`orders.action_${action.id}`)}
          </Button>
        ))}
        <OverflowMenu label={t('orders.moreActions')} items={more} disabled={busy !== null} />
      </div>

      <SendOrderDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        order={order}
        lines={lines}
        states={states}
        serverMissing={serverMissing}
      />
      <ConfirmDialog
        open={confirm === 'reopen'}
        onClose={() => setConfirm(null)}
        title={t('orders.reopenTitle', { order: order.orderNumber })}
        message={t('orders.reopenBody')}
        confirmText={t('orders.action_reopen')}
        onConfirm={() => void run('reopen', () => changeOrderStatus(order, 'draft'))}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={t('orders.deleteTitle', { order: order.orderNumber })}
        message={t('orders.deleteBody')}
        confirmText={t('orders.delete')}
        variant="danger"
        onConfirm={() => void run('delete', () => deleteOrderAndClose(order))}
      />
    </header>
  )
}

/** "Sent 2 Nov", "Received 5 Nov", ... for the status the order is in; "Created 1 Nov" for a draft. */
function statusLine(
  order: SupplyOrder,
  language: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const at: Record<SupplyOrder['status'], string | null> = {
    draft: order.createdAt,
    sent: order.sentAt,
    received: order.receivedAt,
    closed: order.closedAt,
    cancelled: order.cancelledAt,
  }
  const date = shortDate(at[order.status], language)
  return date ? t(`orders.statusAt_${order.status}`, { date }) : null
}
