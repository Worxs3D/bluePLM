/**
 * Shown when the server refused to mark an order sent because outputs are missing: which line
 * lacks which kind, with "Generate missing" (desktop) and "Send anyway" (records what exists;
 * the missing kinds are stored with the order). The list is the server's, which checks every
 * line, including lines in vaults this user cannot see; those are counted, not named. Without a
 * server list it falls back to the outputs this screen resolved. Escape and Cancel close it.
 */

import { useEffect, useState } from 'react'

import { Dialog } from '@/components/core/Dialog'
import { Button } from '@/components/core/ui'
import { useHostWindow } from '@/hooks/useHostWindow'
import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import type { LineOutputState, OrderOutputKind, SupplyOrder, SupplyOrderLine } from '@/types/orders'

import { changeOrderStatus, generateMissing, type OrderMissing } from '../actions'
import { kindKey } from '../lib/format'
import { isPurgedLine, livingLines, missingOutputs } from '../lib/outputChips'

/** Lines listed before "and N more". */
const LIST_LIMIT = 8

interface SendOrderDialogProps {
  open: boolean
  onClose: () => void
  order: SupplyOrder
  lines: SupplyOrderLine[]
  states: Record<string, LineOutputState[]> | undefined
  /** The server's MISSING_OUTPUTS list, when it gave one. */
  serverMissing: OrderMissing[] | null
}

interface MissingRows {
  visible: Array<{ line: SupplyOrderLine; kinds: OrderOutputKind[] }>
  /** Missing outputs on lines this user cannot see. */
  hiddenOutputs: number
  /** No server list and some lines are hidden: they were not checked here. */
  hiddenUnchecked: boolean
}

function missingRows(
  lines: SupplyOrderLine[],
  states: Record<string, LineOutputState[]> | undefined,
  serverMissing: OrderMissing[] | null,
  order: SupplyOrder,
): MissingRows {
  if (!serverMissing) {
    return {
      visible: missingOutputs(lines, states),
      hiddenOutputs: 0,
      hiddenUnchecked: order.lineCount > lines.length,
    }
  }
  const byId = new Map(lines.map((l) => [l.id, l]))
  const visible: MissingRows['visible'] = []
  let hiddenOutputs = 0
  for (const m of serverMissing) {
    const line = byId.get(m.lineId)
    if (line) visible.push({ line, kinds: m.kinds })
    else hiddenOutputs += m.kinds.length
  }
  return { visible, hiddenOutputs, hiddenUnchecked: false }
}

export function SendOrderDialog({ open, onClose, order, lines, states, serverMissing }: SendOrderDialogProps) {
  const { t } = useTranslation()
  const host = useHostWindow()
  const [busy, setBusy] = useState<'send' | null>(null)
  const { visible, hiddenOutputs, hiddenUnchecked } = missingRows(lines, states, serverMissing, order)
  const total = visible.reduce((n, m) => n + m.kinds.length, 0) + hiddenOutputs
  const generatable = visible.some((m) => !isPurgedLine(m.line))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    host.document.addEventListener('keydown', onKey)
    return () => host.document.removeEventListener('keydown', onKey)
  }, [open, onClose, host])

  const sendAnyway = async () => {
    setBusy('send')
    try {
      if ((await changeOrderStatus(order, 'sent', true)).outcome === 'done') onClose()
    } finally {
      setBusy(null)
    }
  }

  const generate = () => {
    generateMissing(order, livingLines(lines), states ?? {})
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="max-w-lg"
      title={t('orders.sendMissingTitle')}
      description={
        total === 1
          ? t('orders.sendMissingBodyOne', { order: order.orderNumber })
          : t('orders.sendMissingBodyMany', { order: order.orderNumber, count: total })
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            {t('orders.cancel')}
          </Button>
          {hasDesktop() && order.status === 'draft' && generatable && (
            <Button variant="secondary" disabled={busy !== null} onClick={generate}>
              {t('orders.generateMissing')}
            </Button>
          )}
          <Button
            variant="primary"
            loading={busy === 'send'}
            disabled={busy !== null}
            onClick={() => void sendAnyway()}
          >
            {t('orders.sendAnyway')}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-ui-divider text-[13px]" aria-label={t('orders.missingListLabel')}>
        {visible.slice(0, LIST_LIMIT).map(({ line, kinds }) => (
          <li key={line.id} className="flex items-baseline justify-between gap-4 py-2">
            <span className="min-w-0 truncate text-ui-fg" title={line.fileName}>
              {line.partNumber || line.fileName}
              {isPurgedLine(line) && (
                <span className="ml-2 text-ui-fg-tertiary">{t('orders.purged')}</span>
              )}
            </span>
            <span className="flex-shrink-0 text-ui-warning">
              {kinds.map((k) => t(kindKey(k))).join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {visible.length > LIST_LIMIT && (
        <p className="mt-2 text-[13px] text-ui-fg-secondary">
          {t('orders.andMoreLines', { count: visible.length - LIST_LIMIT })}
        </p>
      )}
      {hiddenOutputs > 0 && (
        <p className="mt-2 text-[13px] text-ui-fg-secondary">
          {hiddenOutputs === 1
            ? t('orders.sendMissingHiddenOne')
            : t('orders.sendMissingHiddenMany', { count: hiddenOutputs })}
        </p>
      )}
      {hiddenUnchecked && (
        <p className="mt-2 text-[13px] text-ui-fg-secondary">{t('orders.sendMissingHiddenUnchecked')}</p>
      )}
      {!hasDesktop() && (
        <p className="mt-3 text-[13px] text-ui-fg-secondary">{t('orders.generateOnDesktop')}</p>
      )}
    </Dialog>
  )
}
