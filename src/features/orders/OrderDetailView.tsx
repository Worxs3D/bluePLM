/**
 * The main area of the Orders module: the open order (title bar, details, lines) as a page of
 * sections, or an empty, loading or error state. The order comes from the store
 * (`activeOrderId`, `orderLines`, `orderOutputStates`), so a scene can drive it with store
 * actions alone.
 */

import { useEffect, type ReactNode } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, EmptyState, Page, StatusText } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import { createAndOpenOrder } from './actions'
import { OrderDetailsSection } from './detail/OrderDetailsSection'
import { OrderLinesSection } from './detail/OrderLinesSection'
import { OrderTitleBar } from './detail/OrderTitleBar'

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-ui-bg px-4 font-ui">
      <div className="max-w-sm">{children}</div>
    </div>
  )
}

export function OrderDetailView() {
  const { t } = useTranslation()
  const { activeOrderId, orders, ordersLoaded, orderError, lines, states, refreshOrder } =
    usePDMStore(
      useShallow((s) => ({
        activeOrderId: s.activeOrderId,
        orders: s.orders,
        ordersLoaded: s.ordersLoaded,
        orderError: s.activeOrderId ? s.orderErrors[s.activeOrderId] : undefined,
        lines: s.activeOrderId ? s.orderLines[s.activeOrderId] : undefined,
        states: s.activeOrderId ? s.orderOutputStates[s.activeOrderId] : undefined,
        refreshOrder: s.refreshOrder,
      })),
    )
  const order = activeOrderId ? orders.find((o) => o.id === activeOrderId) : undefined

  // An order opened from a link or a toast before its lines arrived.
  useEffect(() => {
    if (activeOrderId && lines === undefined && !orderError) void refreshOrder(activeOrderId)
  }, [activeOrderId]) // eslint-disable-line react-hooks/exhaustive-deps -- once per opened order

  if (!activeOrderId) {
    // With no orders at all the list pane carries the one New order button; else offer it here.
    return (
      <Centered>
        <EmptyState
          align="center"
          title={t('orders.noneOpenTitle')}
          description={t('orders.noneOpenBody')}
          actions={
            orders.length > 0 ? (
              <Button icon={<Plus size={14} />} onClick={() => void createAndOpenOrder()}>
                {t('orders.newOrder')}
              </Button>
            ) : undefined
          }
        />
      </Centered>
    )
  }

  if (orderError && (!order || lines === undefined)) {
    return (
      <Centered>
        <EmptyState
          align="center"
          title={t('orders.openFailedTitle')}
          description={t('orders.openFailedBody')}
          actions={
            <Button icon={<RefreshCw size={14} />} onClick={() => void refreshOrder(activeOrderId)}>
              {t('orders.retry')}
            </Button>
          }
        />
      </Centered>
    )
  }

  if (!order && ordersLoaded && lines !== undefined) {
    return (
      <Centered>
        <EmptyState align="center" title={t('orders.goneTitle')} description={t('orders.goneBody')} />
      </Centered>
    )
  }

  if (!order || lines === undefined) {
    return (
      <Centered>
        <StatusText tone="neutral">{t('orders.loadingOrder')}</StatusText>
      </Centered>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-ui-bg font-ui">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Page>
          <OrderTitleBar order={order} lines={lines} states={states} />
          <OrderDetailsSection key={order.id} order={order} />
          <OrderLinesSection order={order} lines={lines} states={states} />
        </Page>
      </div>
    </div>
  )
}
