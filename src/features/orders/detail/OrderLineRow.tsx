/**
 * One row of the lines table: the pinned file (part number, description, configuration),
 * revision, version (with "Update" when a newer version is checked in), drawing, quantity,
 * output chips with the line's outputs menu, notes, and Remove. Quantity, kinds, notes and the
 * pin change only in a draft. Below `xl` the drawing and note columns fold into the item cell.
 */

import { useState } from 'react'
import { ArrowUpCircle, SlidersHorizontal, Trash2 } from 'lucide-react'

import { Button, IconButton, OverflowMenu, StatusText, TextInput } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import type { LineOutputState, OrderLinePatch, SupplyOrderLine } from '@/types/orders'

import { removeLines, saveOrderLine } from '../actions'
import { useDraftField } from '../hooks/useDraftField'
import type { LatestVersion } from '../hooks/useLatestVersions'
import { kindKey } from '../lib/format'
import { isPurgedLine, lineOutputChips, toggleOutputKind } from '../lib/outputChips'
import { parseQuantity } from '../lib/quantity'
import { OutputChip } from './OutputChip'

interface OrderLineRowProps {
  orderId: string
  line: SupplyOrderLine
  states: LineOutputState[] | undefined
  editable: boolean
  latest: LatestVersion | undefined
}

const CELL = 'px-2 py-2.5 align-top'
/** Shown from `xl` up; below, the item cell carries the drawing and the note. */
export const WIDE_COLUMN = 'hidden xl:table-cell'

export function OrderLineRow({ orderId, line, states, editable, latest }: OrderLineRowProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const quantity = useDraftField(String(line.quantity))
  const notes = useDraftField(line.notes ?? '')
  const chips = lineOutputChips(line, states, editable)
  const name = line.partNumber || line.fileName
  const purged = isPurgedLine(line)
  const newer = editable && !purged && latest && latest.version > line.version ? latest : null
  const drawing = line.drawingFileName
    ? line.drawingVersion !== null
      ? t('orders.drawingWithVersion', { name: line.drawingFileName, version: line.drawingVersion })
      : line.drawingFileName
    : null

  const save = async (patch: OrderLinePatch) => {
    setSaving(true)
    try {
      await saveOrderLine(orderId, line.id, patch)
    } finally {
      setSaving(false)
    }
  }

  // Chips show what the line sends; the menu beside them adds or removes a kind (drafts only).
  const shown = chips.filter((c) => c.state !== 'excluded')
  const choices = purged
    ? []
    : chips
        .filter((c) => c.toggleable)
        .map((c) => ({
          id: c.kind,
          label: t(kindKey(c.kind)),
          checked: c.state !== 'excluded',
          onSelect: () => void save({ outputKinds: toggleOutputKind(line.outputKinds, c.kind) }),
        }))

  const commitQuantity = () => {
    const text = quantity.commit()
    if (text === null) return
    const n = parseQuantity(text)
    if (n === null) {
      quantity.revert()
      return
    }
    if (n !== line.quantity) void save({ quantity: n })
  }

  const commitNotes = () => {
    const text = notes.commit()
    if (text !== null) void save({ notes: text.trim() || null })
  }

  const secondary = [
    line.description,
    line.configuration ? t('orders.configurationShort', { name: line.configuration }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <tr className="transition-colors duration-100 hover:bg-ui-hover">
      <td className={`${CELL} pl-0`}>
        <div className="min-w-0">
          <div className="truncate font-medium text-ui-fg" title={line.fileName}>
            {name}
          </div>
          {secondary && (
            <div className="truncate text-ui-fg-secondary" title={line.description ?? undefined}>
              {secondary}
            </div>
          )}
          {drawing && (
            <div className="truncate text-ui-fg-tertiary xl:hidden" title={line.drawingFileName ?? undefined}>
              {drawing}
            </div>
          )}
          {line.notes && (
            <div className="truncate text-ui-fg-tertiary xl:hidden" title={line.notes}>
              {line.notes}
            </div>
          )}
          {purged && (
            <StatusText tone="warning" title={t('orders.purgedHint')} className="mt-0.5">
              {t('orders.purged')}
            </StatusText>
          )}
        </div>
      </td>
      <td className={`${CELL} text-ui-fg-secondary`}>{line.revision || t('orders.none')}</td>
      <td className={CELL}>
        <div className="tabular-nums">{t('orders.versionShort', { version: line.version })}</div>
        {newer && (
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2 mt-0.5"
            icon={<ArrowUpCircle size={14} />}
            disabled={saving}
            title={t('orders.updateHint', { version: newer.version })}
            onClick={() => void save({ fileVersionId: newer.fileVersionId })}
          >
            {t('orders.updateTo', { version: newer.version })}
          </Button>
        )}
      </td>
      <td className={`${CELL} ${WIDE_COLUMN} text-ui-fg-secondary`}>
        <span className="block truncate" title={line.drawingFileName ?? undefined}>
          {drawing ?? t('orders.none')}
        </span>
      </td>
      <td className={`${CELL} text-right tabular-nums`}>
        {editable ? (
          <TextInput
            size="sm"
            inputMode="numeric"
            className="w-16 text-right"
            aria-label={t('orders.quantityLabel', { name })}
            value={quantity.draft}
            disabled={saving}
            aria-invalid={parseQuantity(quantity.draft) === null || undefined}
            onChange={(e) => quantity.setDraft(e.target.value)}
            onBlur={commitQuantity}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') quantity.revert()
            }}
          />
        ) : (
          line.quantity
        )}
      </td>
      <td className={CELL}>
        <div className="flex items-start gap-1">
          <div
            className="flex min-w-0 flex-1 flex-wrap gap-1 pt-0.5"
            role="group"
            aria-label={t('orders.outputsLabel', { name })}
          >
            {shown.map((chip) => (
              <OutputChip key={chip.kind} chip={chip} />
            ))}
            {shown.length === 0 && <span className="text-ui-fg-tertiary">{t('orders.noOutputs')}</span>}
          </div>
          {choices.length > 0 && (
            <OverflowMenu
              size="sm"
              label={t('orders.chooseOutputs', { name })}
              icon={<SlidersHorizontal size={14} />}
              disabled={saving}
              items={choices}
            />
          )}
        </div>
      </td>
      <td className={`${CELL} ${WIDE_COLUMN}`}>
        {editable ? (
          <TextInput
            size="sm"
            className="w-full min-w-0"
            aria-label={t('orders.lineNotesLabel', { name })}
            placeholder={t('orders.lineNotesPlaceholder')}
            value={notes.draft}
            disabled={saving}
            onChange={(e) => notes.setDraft(e.target.value)}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') notes.revert()
            }}
          />
        ) : (
          <span className="block truncate text-ui-fg-secondary" title={line.notes ?? undefined}>
            {line.notes || t('orders.none')}
          </span>
        )}
      </td>
      <td className={`${CELL} pr-0 text-right`}>
        {editable && (
          <IconButton
            size="sm"
            danger
            label={t('orders.removeLine', { name })}
            icon={<Trash2 size={14} />}
            disabled={saving}
            onClick={() => void removeLines(orderId, [line.id])}
          />
        )}
      </td>
    </tr>
  )
}
