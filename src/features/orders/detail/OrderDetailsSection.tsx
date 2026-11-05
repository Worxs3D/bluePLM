/**
 * The header fields of an order as settings rows: title, purpose (quote or purchase), supplier,
 * due date and notes. Each saves on its own (blur, Enter, or a pick); a closed or cancelled
 * order shows them read-only.
 */

import { Row, RowGroup, Section, SegmentedControl, TextArea, TextInput } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { headerEditable } from '@/lib/orders'
import type { OrderHeaderPatch, OrderPurpose, SupplyOrder } from '@/types/orders'

import { saveOrderHeader } from '../actions'
import { useDraftField } from '../hooks/useDraftField'
import { SupplierPicker } from './SupplierPicker'

export function OrderDetailsSection({ order }: { order: SupplyOrder }) {
  const { t } = useTranslation()
  const editable = headerEditable(order)
  const title = useDraftField(order.title)
  const notes = useDraftField(order.notes ?? '')
  const due = useDraftField(order.dueDate ?? '')
  const save = (patch: OrderHeaderPatch) => void saveOrderHeader(order.id, patch)
  const ids = {
    title: `order-${order.id}-title`,
    supplier: `order-${order.id}-supplier`,
    due: `order-${order.id}-due`,
    notes: `order-${order.id}-notes`,
  }

  const commitTitle = () => {
    const text = title.commit()
    if (text === null) return
    if (!text.trim()) {
      title.revert()
      return
    }
    save({ title: text.trim() })
  }

  const commitNotes = () => {
    const text = notes.commit()
    if (text !== null) save({ notes: text.trim() || null })
  }

  return (
    <Section
      title={t('orders.detailsTitle')}
      description={editable ? undefined : t('orders.headerFrozen')}
    >
      <RowGroup>
        <Row label={t('orders.fieldTitle')} htmlFor={ids.title}>
          {/* The field's own class is w-full: the wrapper gives it its width. */}
          <div className="w-80 max-w-full">
            <TextInput
              id={ids.title}
              value={title.draft}
              disabled={!editable}
              onChange={(e) => title.setDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') title.revert()
              }}
              aria-invalid={!title.draft.trim() || undefined}
            />
          </div>
        </Row>
        <Row label={t('orders.fieldPurpose')} description={t('orders.fieldPurposeHint')}>
          <SegmentedControl<OrderPurpose>
            aria-label={t('orders.fieldPurpose')}
            value={order.purpose}
            onChange={(purpose) => {
              if (editable && purpose !== order.purpose) save({ purpose })
            }}
            options={[
              { value: 'quote', label: t('orders.purpose_quote'), disabled: !editable },
              { value: 'purchase', label: t('orders.purpose_purchase'), disabled: !editable },
            ]}
          />
        </Row>
        <Row label={t('orders.fieldSupplier')} htmlFor={ids.supplier}>
          <SupplierPicker id={ids.supplier} order={order} disabled={!editable} onSave={save} />
        </Row>
        <Row label={t('orders.fieldDueDate')} htmlFor={ids.due}>
          <TextInput
            id={ids.due}
            type="date"
            className="w-44"
            value={due.draft}
            disabled={!editable}
            onChange={(e) => due.setDraft(e.target.value)}
            onBlur={() => {
              const text = due.commit()
              // A half-typed date reads as '' in the input; only a full date or a cleared field saves.
              if (text !== null) save({ dueDate: text || null })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') due.revert()
            }}
          />
        </Row>
        <Row label={t('orders.fieldNotes')} htmlFor={ids.notes} stacked>
          <TextArea
            id={ids.notes}
            rows={3}
            value={notes.draft}
            disabled={!editable}
            placeholder={t('orders.notesPlaceholder')}
            onChange={(e) => notes.setDraft(e.target.value)}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              if (e.key === 'Escape') notes.revert()
            }}
          />
        </Row>
      </RowGroup>
    </Section>
  )
}
