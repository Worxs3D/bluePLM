/**
 * The supplier of an order: one of the organization's suppliers (module 30), "Other" with a
 * typed name, or none. Picking a supplier stores its id and its current name, so the order still
 * reads correctly if the supplier is renamed or removed later.
 */

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { Select, TextInput } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrderHeaderPatch, SupplyOrder } from '@/types/orders'

import { useDraftField } from '../hooks/useDraftField'
import { ensureSuppliersLoaded } from '../lib/suppliers'

const NONE = ''
const OTHER = '__other__'

interface SupplierPickerProps {
  id: string
  order: SupplyOrder
  disabled: boolean
  onSave: (patch: OrderHeaderPatch) => void
}

export function SupplierPicker({ id, order, disabled, onSave }: SupplierPickerProps) {
  const { t } = useTranslation()
  const { orgId, suppliers } = usePDMStore(
    useShallow((s) => ({ orgId: s.organization?.id ?? null, suppliers: s.suppliers })),
  )
  const [otherChosen, setOtherChosen] = useState(false)
  const name = useDraftField(order.supplierName ?? '')

  useEffect(() => {
    if (orgId) void ensureSuppliersLoaded(orgId)
  }, [orgId])

  const known = order.supplierId ? suppliers.some((s) => s.id === order.supplierId) : false
  const isOther = otherChosen || (!order.supplierId && !!order.supplierName)
  // A supplier no longer listed (inactive or removed) keeps its saved name as an option.
  const value = order.supplierId ? order.supplierId : isOther ? OTHER : NONE

  const onPick = (next: string) => {
    if (next === OTHER) {
      setOtherChosen(true)
      if (order.supplierId) onSave({ supplierId: null, supplierName: null })
      return
    }
    setOtherChosen(false)
    if (next === NONE) {
      onSave({ supplierId: null, supplierName: null })
      return
    }
    const supplier = suppliers.find((s) => s.id === next)
    if (supplier) onSave({ supplierId: supplier.id, supplierName: supplier.name })
  }

  const commitName = () => {
    const text = name.commit()
    if (text !== null) onSave({ supplierId: null, supplierName: text.trim() || null })
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-72">
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
        className="w-full"
      >
        <option value={NONE}>{t('orders.supplierNone')}</option>
        {order.supplierId && !known && (
          <option value={order.supplierId}>{order.supplierName ?? t('orders.supplierUnknown')}</option>
        )}
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code ? `${s.name} (${s.code})` : s.name}
          </option>
        ))}
        <option value={OTHER}>{t('orders.supplierOther')}</option>
      </Select>
      {value === OTHER && (
        <TextInput
          value={name.draft}
          disabled={disabled}
          aria-label={t('orders.supplierNameLabel')}
          placeholder={t('orders.supplierNamePlaceholder')}
          onChange={(e) => name.setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') name.revert()
          }}
        />
      )}
    </div>
  )
}
