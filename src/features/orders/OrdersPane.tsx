/**
 * The Orders list in the sidebar: search, the Open / All filter, "New order", and one row per
 * order (title, status, number, supplier, line count, date). Selecting a row opens the order in
 * the main area (`OrderDetailView`). Arrow keys move through the list.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import {
  Button,
  EmptyState,
  IconButton,
  ListRow,
  RowGroup,
  SegmentedControl,
  StatusText,
  TextInput,
} from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { SupplyOrder } from '@/types/orders'

import { createAndOpenOrder } from './actions'
import { STATUS_TONE, shortDate } from './lib/format'
import { filterOrders, type OrderListFilter } from './lib/orderList'

const OPTION_ID = (id: string) => `order-option-${id}`

export function OrdersPane() {
  const { t, language } = useTranslation()
  const { orders, ordersLoaded, ordersError, activeOrderId, loadOrders, openOrder } = usePDMStore(
    useShallow((s) => ({
      orders: s.orders,
      ordersLoaded: s.ordersLoaded,
      ordersError: s.ordersError,
      activeOrderId: s.activeOrderId,
      loadOrders: s.loadOrders,
      openOrder: s.openOrder,
    })),
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OrderListFilter>('open')
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ordersLoaded) void loadOrders()
  }, [ordersLoaded, loadOrders])

  const visible = useMemo(() => filterOrders(orders, filter, query), [orders, filter, query])

  const newOrder = async () => {
    setCreating(true)
    try {
      await createAndOpenOrder()
    } finally {
      setCreating(false)
    }
  }

  // Roving focus: the selected row (else the first) is the one Tab reaches.
  const focusIndex = Math.max(
    0,
    visible.findIndex((o) => o.id === activeOrderId),
  )
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    if (visible.length === 0) return
    event.preventDefault()
    const current = visible.findIndex((o) => OPTION_ID(o.id) === (event.target as HTMLElement).id)
    const from = current === -1 ? focusIndex : current
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, from + (event.key === 'ArrowDown' ? 1 : -1)))
    const order = visible[next]
    void openOrder(order.id)
    listRef.current?.querySelector<HTMLElement>(`[id="${OPTION_ID(order.id)}"]`)?.focus()
  }

  return (
    <div className="flex h-full min-w-0 flex-col font-ui">
      <div className="flex-shrink-0 space-y-2 border-b border-ui-border px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ui-fg-tertiary"
              aria-hidden
            />
            <TextInput
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('orders.searchPlaceholder')}
              aria-label={t('orders.searchLabel')}
              className="pl-7"
            />
          </div>
          <IconButton
            label={t('orders.newOrder')}
            icon={<Plus size={16} />}
            onClick={() => void newOrder()}
            disabled={creating}
          />
        </div>
        <SegmentedControl
          size="sm"
          aria-label={t('orders.filterLabel')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: t('orders.filterOpen') },
            { value: 'all', label: t('orders.filterAll') },
          ]}
        />
      </div>

      {/* A failed load is an error even when an order opened from elsewhere is already in `orders`. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordersError && !ordersLoaded ? (
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
        ) : orders.length === 0 ? (
          <EmptyState
            className="px-4 py-4"
            title={t('orders.emptyTitle')}
            description={t('orders.emptyBody')}
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={<Plus size={14} />}
                loading={creating}
                onClick={() => void newOrder()}
              >
                {t('orders.newOrder')}
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            className="px-4 py-4"
            title={t('orders.noMatchTitle')}
            description={
              filter === 'open' ? t('orders.noMatchOpenBody') : t('orders.noMatchBody')
            }
          />
        ) : (
          <div
            ref={listRef}
            role="listbox"
            aria-label={t('orders.listLabel')}
            onKeyDown={onListKeyDown}
          >
            <RowGroup>
              {visible.map((order, index) => (
                <OrderListRow
                  key={order.id}
                  order={order}
                  selected={order.id === activeOrderId}
                  tabIndex={index === focusIndex ? 0 : -1}
                  language={language}
                  onOpen={() => void openOrder(order.id)}
                />
              ))}
            </RowGroup>
          </div>
        )}
      </div>
    </div>
  )
}

interface OrderListRowProps {
  order: SupplyOrder
  selected: boolean
  tabIndex: number
  language: string
  onOpen: () => void
}

function OrderListRow({ order, selected, tabIndex, language, onOpen }: OrderListRowProps) {
  const { t } = useTranslation()
  const date = shortDate(order.sentAt ?? order.createdAt, language)
  const lines =
    order.lineCount === 1
      ? t('orders.lineCountOne')
      : t('orders.lineCountMany', { count: order.lineCount })
  // The count before the supplier, so a narrow pane cuts the name, not the count.
  const meta = [order.orderNumber, lines, order.supplierName].filter(Boolean).join(' · ')
  return (
    <ListRow
      id={OPTION_ID(order.id)}
      role="option"
      tabIndex={tabIndex}
      selected={selected}
      onActivate={onOpen}
      hint={`${order.orderNumber} ${order.title}`}
      title={order.title}
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
}
