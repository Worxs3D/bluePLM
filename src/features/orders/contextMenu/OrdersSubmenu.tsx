/**
 * The "Orders" submenu of both file context menus (file list and explorer tree), next to
 * Reviews, so the two cannot drift apart:
 *
 *   Orders ▸ Add to ORD-0012 Brackets     up to five drafts, most recently changed first
 *            New order with these files
 *            With referenced parts ▸        assemblies only: the same targets, plus each
 *                                           assembly's referenced parts as their own lines
 *            View orders
 *
 * Lines are planned by `planOrderLinesForFiles` and the result comes back as a toast.
 */

import { useEffect, useRef, useState } from 'react'
import { Boxes, FilePlus2, ListChecks, Loader2, RefreshCw, ShoppingCart } from 'lucide-react'

import { ContextSubmenu } from '@/features/source/browser/components/ContextMenu/components'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import type { SupplyOrder } from '@/types/orders'

import { addFilesToOrder, type OrderTarget } from '../actions'
import { useOrdersAvailable } from '../hooks/useOrdersAvailable'
import { hasAssembly, orderableFiles } from '../lib/menuTargets'
import { recentDraftOrders } from '../lib/orderList'

interface OrdersSubmenuProps {
  contextFiles: LocalFile[]
  onClose: () => void
}

type Open = 'none' | 'root' | 'refs'

/** Hover-open with a short grace period, like the other context submenus. */
function useHover(setOpen: (fn: (o: Open) => Open) => void, level: Exclude<Open, 'none'>) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return {
    onMouseEnter: () => {
      if (timer.current) clearTimeout(timer.current)
      setOpen((o) => (level === 'root' && o !== 'none' ? o : level))
    },
    onMouseLeave: () => {
      timer.current = setTimeout(
        () => setOpen((o) => (level === 'root' ? 'none' : o === level ? 'root' : o)),
        150,
      )
    },
  }
}

export function OrdersSubmenu({ contextFiles, onClose }: OrdersSubmenuProps) {
  const { t } = useTranslation()
  const orders = usePDMStore((s) => s.orders)
  const ordersLoaded = usePDMStore((s) => s.ordersLoaded)
  const ordersLoading = usePDMStore((s) => s.ordersLoading)
  const ordersError = usePDMStore((s) => s.ordersError)
  const loadOrders = usePDMStore((s) => s.loadOrders)
  const setActiveView = usePDMStore((s) => s.setActiveView)
  const available = useOrdersAvailable()
  const [open, setOpen] = useState<Open>('none')
  const rootHover = useHover(setOpen, 'root')
  const refsHover = useHover(setOpen, 'refs')
  const rootOpen = open !== 'none'
  // A failed load is not retried by itself: the menu says so and offers to try again.
  const failed = !ordersLoaded && !ordersLoading && !!ordersError

  useEffect(() => {
    if (rootOpen && !ordersLoaded && !ordersLoading && !ordersError) void loadOrders()
  }, [rootOpen, ordersLoaded, ordersLoading, ordersError, loadOrders])

  const files = orderableFiles(contextFiles)
  if (!available || files.length === 0) return null

  const drafts = recentDraftOrders(orders)
  const assemblies = hasAssembly(files)

  const add = (target: OrderTarget, withReferencedParts: boolean) => {
    onClose()
    void addFilesToOrder(files, target, withReferencedParts)
  }

  const targets = (withReferencedParts: boolean) => (
    <>
      {!ordersLoaded && !failed && (
        <div className="context-menu-item opacity-60">
          <Loader2 size={14} className="animate-spin" />
          {t('orders.menuLoading')}
        </div>
      )}
      {failed && (
        <div
          className="context-menu-item text-ui-warning"
          onClick={(e) => {
            e.stopPropagation()
            void loadOrders()
          }}
        >
          <RefreshCw size={14} />
          {t('orders.menuLoadFailed')}
        </div>
      )}
      {drafts.map((order: SupplyOrder) => (
        <div
          key={order.id}
          className="context-menu-item"
          title={t('orders.menuAddToHint', { order: order.orderNumber, title: order.title })}
          onClick={(e) => {
            e.stopPropagation()
            add({ orderId: order.id }, withReferencedParts)
          }}
        >
          <ShoppingCart size={14} className="text-ui-fg-secondary" />
          <span className="max-w-[260px] truncate">
            {t('orders.menuAddTo', { order: order.orderNumber, title: order.title })}
          </span>
        </div>
      ))}
      <div
        className="context-menu-item"
        onClick={(e) => {
          e.stopPropagation()
          add('new', withReferencedParts)
        }}
      >
        <FilePlus2 size={14} className="text-ui-accent" />
        {files.length > 1
          ? t('orders.menuNewOrderMany', { count: files.length })
          : t('orders.menuNewOrder')}
      </div>
    </>
  )

  return (
    <div
      className="context-menu-item relative"
      {...rootHover}
      onClick={(e) => {
        e.stopPropagation()
        // Open only: the hover has usually opened it already, and a toggle would close it again.
        setOpen((o) => (o === 'none' ? 'root' : o))
      }}
    >
      <ShoppingCart size={14} className="text-ui-accent" />
      {t('orders.menuOrders')}
      <span className="ml-auto text-xs text-ui-fg-tertiary">▶</span>

      {rootOpen && (
        <ContextSubmenu minWidth={220} {...rootHover}>
          {targets(false)}

          {assemblies && (
            <div
              className="context-menu-item relative"
              {...refsHover}
              onClick={(e) => e.stopPropagation()}
            >
              <Boxes size={14} className="text-ui-fg-secondary" />
              {t('orders.menuWithReferencedParts')}
              <span className="ml-auto text-xs text-ui-fg-tertiary">▶</span>
              {open === 'refs' && (
                <ContextSubmenu minWidth={220} {...refsHover}>
                  {targets(true)}
                </ContextSubmenu>
              )}
            </div>
          )}

          <div className="context-menu-separator" />
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
              setActiveView('orders')
            }}
          >
            <ListChecks size={14} className="text-ui-fg-secondary" />
            {t('orders.menuView')}
          </div>
        </ContextSubmenu>
      )}
    </div>
  )
}
