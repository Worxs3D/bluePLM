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

import { createAndOpenOrder, dropFilesOnOrder } from './actions'
import { OrderDetailsSection } from './detail/OrderDetailsSection'
import { OrderLinesSection } from './detail/OrderLinesSection'
import { OrderTitleBar } from './detail/OrderTitleBar'
import { useFileDropTarget } from './hooks/useFileDropTarget'

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
  // Files dragged from the file list or the tree onto an open draft are added to it.
  const drop = useFileDropTarget(
    (found, orderable) => {
      if (activeOrderId) void dropFilesOnOrder(activeOrderId, found, orderable)
    },
    order?.status === 'draft',
  )

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
    <div
      {...drop.handlers}
      data-order-drop="detail"
      className={`relative min-w-0 flex-1 overflow-y-auto bg-ui-bg font-ui ${drop.over ? 'ring-2 ring-inset ring-ui-accent/50' : ''}`}
    >
      {drop.over && (
        <div className="pointer-events-none sticky top-3 z-10 flex h-0 items-start justify-center overflow-visible">
          <span className="rounded-lg border border-ui-border bg-ui-bg px-3 py-1.5 text-[13px] text-ui-fg shadow-lg">
            {t('orders.dropHint', { order: order.orderNumber })}
          </span>
        </div>
      )}
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
