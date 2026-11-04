/**
 * The lines of an order: the table, the note about lines in vaults this user cannot see, and
 * the output actions (Generate missing on the desktop for a draft, Export zip, and Save files to
 * folder on the desktop). A sent order exports exactly what was recorded when it went out.
 */

import { useState } from 'react'
import { Download, FolderDown, Wand2 } from 'lucide-react'

import { Button, Callout, EmptyState, Section } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { linesEditable } from '@/lib/orders'
import { hasDesktop } from '@/lib/platform'
import type { LineOutputState, SupplyOrder, SupplyOrderLine } from '@/types/orders'

import { exportOrderOutputs, generateMissing } from '../actions'
import { useLatestVersions } from '../hooks/useLatestVersions'
import { livingLines, missingCount, missingOutputs } from '../lib/outputChips'
import { OrderLineRow, WIDE_COLUMN } from './OrderLineRow'

/** The `<col>` of a column shown from `xl` up (`WIDE_COLUMN` on its cells). */
const WIDE_COL = 'hidden xl:table-column'

interface OrderLinesSectionProps {
  order: SupplyOrder
  lines: SupplyOrderLine[]
  states: Record<string, LineOutputState[]> | undefined
}

export function OrderLinesSection({ order, lines, states }: OrderLinesSectionProps) {
  const { t } = useTranslation()
  const desktop = hasDesktop()
  const editable = linesEditable(order)
  const latest = useLatestVersions(lines, editable)
  const [busy, setBusy] = useState<'zip' | 'folder' | 'generate' | null>(null)

  const hidden = Math.max(0, order.lineCount - lines.length)
  // Before sending, "missing" is about outputs that exist now; once sent, about what went out.
  // Purged lines (no file left in the vault) cannot be generated.
  const generatable = livingLines(lines)
  const missing = editable ? missingCount(missingOutputs(generatable, states)) : 0

  const run = async (id: 'zip' | 'folder' | 'generate', work: () => Promise<void>) => {
    setBusy(id)
    try {
      await work()
    } finally {
      setBusy(null)
    }
  }

  const actions =
    lines.length > 0 ? (
      <>
        {desktop && editable && missing > 0 && (
          <Button
            size="sm"
            icon={<Wand2 size={14} />}
            loading={busy === 'generate'}
            disabled={busy !== null}
            onClick={() => void run('generate', async () => generateMissing(order, generatable, states ?? {}))}
          >
            {missing === 1
              ? t('orders.generateMissingOne')
              : t('orders.generateMissingMany', { count: missing })}
          </Button>
        )}
        <Button
          size="sm"
          icon={<Download size={14} />}
          loading={busy === 'zip'}
          disabled={busy !== null}
          onClick={() => void run('zip', () => exportOrderOutputs(order, lines, 'zip'))}
        >
          {t('orders.exportZip')}
        </Button>
        {desktop && (
          <Button
            size="sm"
            icon={<FolderDown size={14} />}
            loading={busy === 'folder'}
            disabled={busy !== null}
            onClick={() => void run('folder', () => exportOrderOutputs(order, lines, 'folder'))}
          >
            {t('orders.saveToFolder')}
          </Button>
        )}
      </>
    ) : undefined

  const count =
    lines.length === 1 ? t('orders.lineCountOne') : t('orders.lineCountMany', { count: lines.length })

  return (
    <Section
      title={t('orders.linesTitle')}
      description={lines.length > 0 ? count : undefined}
      actions={actions}
    >
      {hidden > 0 && (
        <Callout tone="info" className="my-3">
          {hidden === 1 ? t('orders.hiddenLinesOne') : t('orders.hiddenLinesMany', { count: hidden })}
        </Callout>
      )}
      {!editable && lines.length > 0 && (
        <p className="pb-2 text-[13px] text-ui-fg-secondary">{t('orders.linesFrozen')}</p>
      )}
      {lines.length === 0 ? (
        <EmptyState
          className="py-4"
          title={t('orders.noLinesTitle')}
          description={editable ? t('orders.noLinesBody') : t('orders.noLinesFrozenBody')}
        />
      ) : (
        // Fixed columns that fit the pane (no horizontal scroll, which would also clip the row
        // menus); below `xl` the drawing and note columns fold into the item cell.
        <div>
          <table className="w-full table-fixed border-collapse text-left text-[13px] text-ui-fg">
            <colgroup>
              <col />
              <col className="w-12" />
              <col className="w-28" />
              <col className={`w-52 ${WIDE_COL}`} />
              <col className="w-20" />
              <col className="w-48" />
              <col className={`w-40 ${WIDE_COL}`} />
              <col className="w-10" />
            </colgroup>
            <thead>
              <tr className="border-b border-ui-border text-[12px] font-normal text-ui-fg-tertiary">
                <th scope="col" className="py-2 pl-0 pr-2 font-normal">
                  {t('orders.colItem')}
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  {t('orders.colRevision')}
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  {t('orders.colVersion')}
                </th>
                <th scope="col" className={`px-2 py-2 font-normal ${WIDE_COLUMN}`}>
                  {t('orders.colDrawing')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-normal">
                  {t('orders.colQuantity')}
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  {t('orders.colOutputs')}
                </th>
                <th scope="col" className={`px-2 py-2 font-normal ${WIDE_COLUMN}`}>
                  {t('orders.colNotes')}
                </th>
                <th scope="col" className="py-2 pl-2 pr-0">
                  <span className="sr-only">{t('orders.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ui-divider">
              {lines.map((line) => (
                <OrderLineRow
                  key={line.id}
                  orderId={order.id}
                  line={line}
                  states={states?.[line.id]}
                  editable={editable}
                  latest={line.fileId ? latest.get(line.fileId) : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
