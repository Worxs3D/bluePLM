/**
 * The Orders tab of the file details pane (5.13.0): the orders whose lines pin this file, as a
 * line's model or as its drawing, with each order's number, title, status and the versions it
 * pins. A click opens the order in the Orders view. Read under RLS (`listOrdersForFile`), again
 * when the file changes or the order list does (an add from the context menu reloads it).
 */

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button, EmptyState, ListRow, RowGroup, StatusText } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { listOrdersForFile, type FileOrderEntry } from '@/lib/orders/fileOrders'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import { showOrder } from './actions'
import { STATUS_TONE, shortDate } from './lib/format'

type Load = { status: 'loading' } | { status: 'failed' } | { status: 'done'; entries: FileOrderEntry[] }

export function FileOrdersTab({ file }: { file: LocalFile }) {
  const { t, language } = useTranslation()
  const fileId = file.pdmData?.id ?? null
  // The list's identity changes whenever an order is added to or changed in this session.
  const orders = usePDMStore((s) => s.orders)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    setLoad((prev) => (prev.status === 'done' ? prev : { status: 'loading' }))
    listOrdersForFile(fileId)
      .then((entries) => {
        if (!cancelled) setLoad({ status: 'done', entries })
      })
      .catch((error: unknown) => {
        log.warn('[Orders]', 'Loading the orders of a file failed', {
          message: error instanceof Error ? error.message : String(error),
        })
        if (!cancelled) setLoad({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [fileId, orders, attempt])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  if (!fileId) {
    return (
      <EmptyState
        className="px-4 py-4"
        title={t('orders.fileOrdersNotInVaultTitle')}
        description={t('orders.fileOrdersNotInVaultBody')}
      />
    )
  }
  if (load.status === 'loading') {
    return (
      <div className="px-4 py-4 font-ui">
        <StatusText tone="neutral">{t('orders.fileOrdersLoading')}</StatusText>
      </div>
    )
  }
  if (load.status === 'failed') {
    return (
      <EmptyState
        className="px-4 py-4"
        title={t('orders.fileOrdersFailedTitle')}
        description={t('orders.loadFailedBody')}
        actions={
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={retry}>
            {t('orders.retry')}
          </Button>
        }
      />
    )
  }
  if (load.entries.length === 0) {
    return (
      <EmptyState
        className="px-4 py-4"
        title={t('orders.fileOrdersEmptyTitle')}
        description={t('orders.fileOrdersEmptyBody')}
      />
    )
  }

  return (
    <div className="font-ui">
      <RowGroup>
        {load.entries.map(({ order, versions, asDrawing }) => {
          const pinned =
            versions.length === 0
              ? null
              : versions.length === 1
                ? t('orders.versionShort', { version: versions[0] })
                : t('orders.fileOrdersVersions', { versions: versions.map((v) => `v${v}`).join(', ') })
          const meta = [
            order.orderNumber,
            pinned,
            asDrawing ? t('orders.fileOrdersAsDrawing') : null,
            order.supplierName,
          ]
            .filter(Boolean)
            .join(' · ')
          const date = shortDate(order.sentAt ?? order.createdAt, language)
          return (
            <ListRow
              key={order.id}
              title={order.title}
              hint={t('orders.fileOrdersOpen', { order: order.orderNumber })}
              trailing={date ? <span className="tabular-nums">{date}</span> : undefined}
              onActivate={() => showOrder(order.id)}
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
    </div>
  )
}
