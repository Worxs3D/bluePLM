/**
 * "Add this version to order" on one row of version history, next to "Add to review package".
 * Pins exactly that `file_version` row (an older version can be ordered on purpose). Opens a
 * small menu: the recent drafts, then "New order".
 */

import { useEffect, useRef, useState } from 'react'
import { FilePlus2, ShoppingCart } from 'lucide-react'

import { IconButton, MenuItem, MenuPanel } from '@/components/core/ui'
import { useHostWindow } from '@/hooks/useHostWindow'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import { addVersionToOrder, type OrderTarget } from './actions'
import { useOrdersAvailable } from './hooks/useOrdersAvailable'
import { recentDraftOrders } from './lib/orderList'

interface AddVersionToOrderButtonProps {
  file: LocalFile
  /** The `file_version` row: its id and number. */
  version: { id: string; version: number }
}

export function AddVersionToOrderButton({ file, version }: AddVersionToOrderButtonProps) {
  const { t } = useTranslation()
  const host = useHostWindow()
  const orders = usePDMStore((s) => s.orders)
  const ordersLoaded = usePDMStore((s) => s.ordersLoaded)
  const loadOrders = usePDMStore((s) => s.loadOrders)
  const available = useOrdersAvailable()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open && !ordersLoaded) void loadOrders()
  }, [open, ordersLoaded, loadOrders])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return
      if (event.type === 'mousedown' && wrapRef.current?.contains(event.target as Node)) return
      if (event.type === 'keydown') event.stopPropagation()
      setOpen(false)
    }
    const doc = host.document
    doc.addEventListener('mousedown', close)
    doc.addEventListener('keydown', close, true)
    return () => {
      doc.removeEventListener('mousedown', close)
      doc.removeEventListener('keydown', close, true)
    }
  }, [open, host])

  if (!available || !file.pdmData?.id) return null

  const add = (target: OrderTarget) => {
    setOpen(false)
    void addVersionToOrder(file, version.id, target)
  }
  const label = t('orders.addVersion', { version: version.version })

  return (
    <div ref={wrapRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <IconButton
        size="sm"
        label={label}
        icon={<ShoppingCart size={14} />}
        aria-haspopup="menu"
        aria-expanded={open}
        pressed={open || undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <MenuPanel className="right-0 top-full mt-1 w-80">
          {recentDraftOrders(orders).map((order) => (
            <MenuItem
              key={order.id}
              icon={<ShoppingCart size={13} />}
              label={t('orders.menuAddTo', { order: order.orderNumber, title: order.title })}
              onSelect={() => add({ orderId: order.id })}
            />
          ))}
          <MenuItem
            icon={<FilePlus2 size={13} />}
            label={t('orders.menuNewOrder')}
            onSelect={() => add('new')}
          />
        </MenuPanel>
      )}
    </div>
  )
}
