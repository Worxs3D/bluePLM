/**
 * "Choose drawing" on a draft line (5.13.0): every drawing whose latest version references the
 * line's model (`drawingCandidates`, read when the menu opens), the one the pairing rule picks
 * marked "suggested", and "No drawing". Choosing pins that drawing's latest version; a line that
 * had no drawing starts sending its PDF, and "No drawing" drops the PDF and DXF it can no longer
 * have.
 */

import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import { OverflowMenu, type OverflowMenuItem } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { drawingCandidates, type DrawingCandidates } from '@/lib/orders/plan'
import { log } from '@/lib/logger'
import type { OrderOutputKind, OrderLinePatch, SupplyOrderLine } from '@/types/orders'

import { saveOrderLine } from '../actions'

type Load = { status: 'idle' | 'loading' | 'failed' } | { status: 'done'; data: DrawingCandidates }

const DRAWING_KINDS: readonly OrderOutputKind[] = ['pdf', 'dxf']

interface ChooseDrawingMenuProps {
  orderId: string
  line: SupplyOrderLine
  name: string
  disabled?: boolean
}

export function ChooseDrawingMenu({ orderId, line, name, disabled }: ChooseDrawingMenuProps) {
  const { t } = useTranslation()
  const [load, setLoad] = useState<Load>({ status: 'idle' })

  const open = () => {
    setLoad({ status: 'loading' })
    drawingCandidates(line)
      .then((data) => setLoad({ status: 'done', data }))
      .catch((error: unknown) => {
        log.warn('[Orders]', 'Reading drawing candidates failed', {
          message: error instanceof Error ? error.message : String(error),
        })
        setLoad({ status: 'failed' })
      })
  }

  const choose = (drawingVersionId: string | null) => {
    if (drawingVersionId === line.drawingVersionId) return
    const patch: OrderLinePatch = { drawingVersionId }
    if (drawingVersionId === null) {
      const kinds = line.outputKinds.filter((k) => !DRAWING_KINDS.includes(k))
      if (kinds.length !== line.outputKinds.length) patch.outputKinds = kinds
    } else if (!line.drawingVersionId && !line.outputKinds.includes('pdf')) {
      patch.outputKinds = ['pdf', ...line.outputKinds]
    }
    void saveOrderLine(orderId, line.id, patch)
  }

  let items: OverflowMenuItem[]
  if (load.status === 'done') {
    const { candidates, suggestedVersionId } = load.data
    items = [
      ...candidates.map((c) => {
        const label = c.version !== null ? t('orders.drawingWithVersion', { name: c.fileName, version: c.version }) : c.fileName
        return {
          id: c.fileVersionId,
          label: c.fileVersionId === suggestedVersionId ? t('orders.drawingSuggested', { name: label }) : label,
          checked: line.drawingFileId === c.fileId,
          title: c.fileName,
          onSelect: () => choose(c.fileVersionId),
        }
      }),
      ...(candidates.length === 0
        ? [{ id: 'none-found', label: t('orders.drawingsNoneFound'), disabled: true, onSelect: () => undefined }]
        : []),
      { id: 'no-drawing', label: t('orders.noDrawing'), checked: !line.drawingVersionId, onSelect: () => choose(null) },
    ]
  } else if (load.status === 'failed') {
    items = [{ id: 'failed', label: t('orders.drawingsFailed'), disabled: true, onSelect: () => undefined }]
  } else {
    items = [{ id: 'loading', label: t('orders.drawingsLoading'), loading: true, onSelect: () => undefined }]
  }

  return (
    <OverflowMenu
      size="sm"
      align="left"
      label={t('orders.chooseDrawing', { name })}
      icon={<ChevronsUpDown size={14} />}
      disabled={disabled}
      onOpen={open}
      items={items}
    />
  )
}
