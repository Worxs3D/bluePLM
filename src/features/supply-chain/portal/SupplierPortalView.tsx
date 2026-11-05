/**
 * The Supplier Portal sidebar: the organization's quote orders (drafts, awaiting a quote,
 * quoted), the newest of them, and links to Orders and the supplier database. RFQs became quote
 * orders in 5.13.0 (schema 515 imported them), so this reads the store's order list
 * (`loadOrders` → `listOrders`, kept fresh by realtime) and opens an order in the Orders view.
 * Without the Orders module there is nothing to show, and the portal says so.
 */

import { useEffect, useMemo, useState } from 'react'
import { Building2, Globe, Plus, RefreshCw, ShoppingCart } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, EmptyState, ListRow, RowGroup, StatusText } from '@/components/core/ui'
import {
  createAndOpenOrder,
  shortDate,
  showOrder,
  STATUS_TONE,
  useOrdersAvailable,
} from '@/features/orders'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import { quoteSummary } from './quoteSummary'

export function SupplierPortalView() {
  const { t, language } = useTranslation()
  const available = useOrdersAvailable()
  const { orders, ordersLoaded, ordersError, loadOrders, setActiveView } = usePDMStore(
    useShallow((s) => ({
      orders: s.orders,
      ordersLoaded: s.ordersLoaded,
      ordersError: s.ordersError,
      loadOrders: s.loadOrders,
      setActiveView: s.setActiveView,
    })),
  )
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (available && !ordersLoaded) void loadOrders()
  }, [available, ordersLoaded, loadOrders])

  const summary = useMemo(() => quoteSummary(orders), [orders])

  const newQuote = async () => {
    setCreating(true)
    try {
      // A toast says why when it fails; on success the order opens in the Orders view.
      await createAndOpenOrder(t('supplierPortal.newQuoteTitle'), 'quote')
    } finally {
      setCreating(false)
    }
  }

  const stats: Array<[string, number]> = [
    [t('supplierPortal.statDraft'), summary.draft],
    [t('supplierPortal.statSent'), summary.sent],
    [t('supplierPortal.statReceived'), summary.received],
  ]

  return (
    <div className="flex h-full min-w-0 flex-col font-ui">
      <div className="flex-shrink-0 space-y-2.5 border-b border-ui-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Globe size={16} className="flex-shrink-0 text-ui-accent" aria-hidden />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-ui-fg">
              {t('sidebar.supplierPortal')}
            </div>
            <div className="truncate text-[13px] text-ui-fg-secondary">
              {t('supplierPortal.subtitle')}
            </div>
          </div>
        </div>
        {available && (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={14} />}
            loading={creating}
            onClick={() => void newQuote()}
          >
            {t('supplierPortal.newQuote')}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!available ? (
          <EmptyState
            className="px-4 py-4"
            title={t('supplierPortal.unavailableTitle')}
            description={t('supplierPortal.unavailableBody')}
          />
        ) : ordersError && !ordersLoaded ? (
          <EmptyState
            className="px-4 py-4"
            title={t('orders.loadFailedTitle')}
            description={t('orders.loadFailedBody')}
            actions={
              <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => void loadOrders()}>
                {t('orders.retry')}
              </Button>
            }
          />
        ) : !ordersLoaded ? (
          <div className="px-4 py-4">
            <StatusText tone="neutral">{t('orders.loading')}</StatusText>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 border-b border-ui-border">
              {stats.map(([label, value]) => (
                <div key={label} className="px-2 py-2.5 text-center">
                  <div className="text-[16px] font-medium tabular-nums text-ui-fg">{value}</div>
                  <div className="truncate text-[12px] text-ui-fg-secondary" title={label}>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-3 pb-1 pt-2.5 text-[12px] font-medium text-ui-fg-secondary">
              {t('supplierPortal.recentTitle')}
            </div>
            {summary.recent.length === 0 ? (
              <EmptyState
                className="px-4 py-4"
                title={t('supplierPortal.emptyTitle')}
                description={t('supplierPortal.emptyBody')}
              />
            ) : (
              <RowGroup>
                {summary.recent.map((order) => {
                  const date = shortDate(order.sentAt ?? order.createdAt, language)
                  const meta = [order.orderNumber, order.supplierName].filter(Boolean).join(' · ')
                  return (
                    <ListRow
                      key={order.id}
                      title={order.title}
                      hint={`${order.orderNumber} ${order.title}`}
                      onActivate={() => showOrder(order.id)}
                      trailing={date ? <span className="tabular-nums">{date}</span> : undefined}
                      secondary={
                        <span className="flex min-w-0 items-center gap-2">
                          <StatusText tone={STATUS_TONE[order.status]} className="flex-shrink-0">
                            {t(`orders.status_${order.status}`)}
                          </StatusText>
                          <span className="min-w-0 truncate" title={meta}>
                            {meta}
                          </span>
                        </span>
                      }
                    />
                  )
                })}
              </RowGroup>
            )}
          </>
        )}
      </div>

      <div className="flex flex-shrink-0 flex-wrap gap-2 border-t border-ui-border px-3 py-2.5">
        {available && (
          <Button size="sm" icon={<ShoppingCart size={14} />} onClick={() => setActiveView('orders')}>
            {t('supplierPortal.openOrders')}
          </Button>
        )}
        <Button
          size="sm"
          icon={<Building2 size={14} />}
          onClick={() => setActiveView('supplier-database')}
        >
          {t('supplierPortal.suppliers')}
        </Button>
      </div>
    </div>
  )
}
