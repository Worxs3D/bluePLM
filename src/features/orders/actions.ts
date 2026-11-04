/**
 * What the Orders UI does when a button is pressed: call `@/lib/orders`, say what happened in a
 * toast (never a raw error code), and refresh the store (`refreshOrder` / `loadOrders`). Every
 * screen and menu goes through these, so a ui-look scene can drive the same paths with fake RPCs.
 */

import {
  addOrderLines,
  createOrder,
  deleteOrder,
  duplicateOrder,
  exportOrder,
  generateMissingOutputs,
  planOrderLinesForFiles,
  removeOrderLines,
  setOrderStatus,
  updateOrder,
  updateOrderLine,
} from '@/lib/orders'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import type {
  AddLineInput,
  LineOutputState,
  OrderErrorCode,
  OrderHeaderPatch,
  OrderLinePatch,
  OrderOutputKind,
  OrderStatus,
  SupplyOrder,
  SupplyOrderLine,
} from '@/types/orders'

import { addResultMessage, type PlannerSkipReason } from './lib/addResultMessage'
import { defaultOrderTitle } from './lib/orderList'

/** Where files go: an existing order, or a new one. */
export type OrderTarget = { orderId: string } | 'new'

/** The sentence for a refused write; every code has one (`orders.error*`). */
export function orderErrorText(code: OrderErrorCode): string {
  return t(`orders.error${code}`)
}

function store() {
  return usePDMStore.getState()
}

function toastFailure(code: OrderErrorCode, message: string, context: string) {
  log.warn('[Orders]', context, { code, message })
  store().addToast('error', orderErrorText(code))
}

/** Open the Orders view on this order. */
export function showOrder(orderId: string): void {
  const s = store()
  s.setActiveView('orders')
  void s.openOrder(orderId)
}

/** Create an empty draft and open it. Returns the new order, or null (a toast said why). */
export async function createAndOpenOrder(title?: string): Promise<SupplyOrder | null> {
  const result = await createOrder({ title: title?.trim() || t('orders.untitled') })
  if (!result.ok) {
    toastFailure(result.code, result.message, 'Creating an order failed')
    return null
  }
  await store().loadOrders()
  showOrder(result.order.id)
  return result.order
}

/** Save header fields. Returns true when saved. */
export async function saveOrderHeader(orderId: string, patch: OrderHeaderPatch): Promise<boolean> {
  const result = await updateOrder(orderId, patch)
  if (!result.ok) {
    toastFailure(result.code, result.message, 'Saving the order failed')
    await store().refreshOrder(orderId)
    return false
  }
  // refreshOrder also updates the order's row in the list.
  await store().refreshOrder(orderId)
  return true
}

/** Send planned lines to an order (new or existing) and toast the outcome. */
async function addPlannedLines(
  target: OrderTarget,
  lines: AddLineInput[],
  plannerSkipped: ReadonlyArray<{ reason: PlannerSkipReason }>,
  newTitle: string | null,
): Promise<void> {
  if (lines.length === 0) {
    const message = addResultMessage({
      orderNumber: '',
      added: 0,
      updated: 0,
      plannerSkipped,
      serverSkipped: [],
    })
    store().addToast(
      'warning',
      plannerSkipped.length > 0
        ? message.parts.map((p) => t(`orders.${p.key}`, p.params)).join(' ')
        : t('orders.toastNothingToAdd'),
    )
    return
  }

  let order: SupplyOrder | undefined
  if (target === 'new') {
    const created = await createOrder({ title: newTitle || t('orders.untitled') })
    if (!created.ok) {
      toastFailure(created.code, created.message, 'Creating an order failed')
      return
    }
    order = created.order
  } else {
    order = store().orders.find((o) => o.id === target.orderId)
  }
  const orderId = target === 'new' ? (order as SupplyOrder).id : target.orderId

  const result = await addOrderLines(orderId, lines)
  if (!result.ok) {
    toastFailure(result.code, result.message, 'Adding lines to an order failed')
    if (target === 'new') await store().loadOrders()
    return
  }
  const message = addResultMessage({
    orderNumber: order?.orderNumber ?? t('orders.theOrder'),
    added: result.added,
    updated: result.updated,
    plannerSkipped,
    serverSkipped: result.skipped,
  })
  store().addToast(
    message.tone,
    message.parts.map((p) => t(`orders.${p.key}`, p.params)).join(' '),
    undefined,
    { label: t('orders.toastOpen'), onClick: () => showOrder(orderId) },
  )
  await store().loadOrders()
  if (target === 'new' || store().activeOrderId === orderId) await store().refreshOrder(orderId)
  if (target === 'new') showOrder(orderId)
}

/** The context menu's Add: plan lines for the selected files, then add them. */
export async function addFilesToOrder(
  files: readonly LocalFile[],
  target: OrderTarget,
  withReferencedParts: boolean,
): Promise<void> {
  try {
    const plan = await planOrderLinesForFiles([...files], { withReferencedParts })
    const title = defaultOrderTitle(
      files.map((f) => ({ partNumber: f.pdmData?.part_number ?? null, name: f.name })),
      (key, params) =>
        key === 'one' ? params.first : t('orders.titleAndMore', { first: params.first, count: params.count }),
    )
    await addPlannedLines(target, plan.lines, plan.skipped, title)
  } catch (error) {
    log.error('[Orders]', 'Planning order lines failed', { error })
    store().addToast('error', t('orders.toastAddFailed'))
  }
}

/** Version history's "Add this version to order": exactly that version, nothing paired. */
export async function addVersionToOrder(
  file: Pick<LocalFile, 'name' | 'extension' | 'pdmData'>,
  fileVersionId: string,
  target: OrderTarget,
): Promise<void> {
  const isDrawing = file.extension.toLowerCase() === '.slddrw'
  const kinds: OrderOutputKind[] = isDrawing ? ['pdf'] : ['step']
  const title = file.pdmData?.part_number?.trim() || file.name.replace(/\.[^.]+$/, '')
  await addPlannedLines(target, [{ fileVersionId, outputKinds: kinds }], [], title)
}

/** Save one line's quantity, kinds, notes or pinned version. */
export async function saveOrderLine(
  orderId: string,
  lineId: string,
  patch: OrderLinePatch,
): Promise<boolean> {
  const result = await updateOrderLine(lineId, patch)
  if (!result.ok) {
    toastFailure(result.code, result.message, 'Saving an order line failed')
  }
  await store().refreshOrder(orderId)
  return result.ok
}

/** Remove lines from a draft; the toast offers no undo (the line can be added again). */
export async function removeLines(orderId: string, lineIds: string[]): Promise<void> {
  const result = await removeOrderLines(orderId, lineIds)
  if (!result.ok) toastFailure(result.code, result.message, 'Removing order lines failed')
  // refreshOrder also updates the order's row in the list.
  await store().refreshOrder(orderId)
}

/** What one line lacks, as the server's MISSING_OUTPUTS refusal lists it (every line, seen or not). */
export interface OrderMissing {
  lineId: string
  kinds: OrderOutputKind[]
}

export interface StatusChangeResult {
  outcome: 'done' | 'missing' | 'failed'
  /** With `missing`: the server's list, when the refusal carried one. */
  missing?: OrderMissing[]
}

/**
 * Move an order to `status`. Sending without `allowMissing` returns `missing` (with the server's
 * list of what each line lacks) when outputs are missing, so the caller can show them and offer
 * "Send anyway"; the refusal changes nothing on the server.
 */
export async function changeOrderStatus(
  order: SupplyOrder,
  status: OrderStatus,
  allowMissing = false,
): Promise<StatusChangeResult> {
  const result = await setOrderStatus(order.id, status, allowMissing)
  if (!result.ok) {
    await store().refreshOrder(order.id)
    if (result.code === 'MISSING_OUTPUTS' && !allowMissing) return { outcome: 'missing', missing: result.missing }
    toastFailure(result.code, result.message, 'Changing the order status failed')
    return { outcome: 'failed' }
  }
  store().addToast(
    'success',
    t(`orders.toastStatus_${status}`, { order: order.orderNumber }),
  )
  await store().refreshOrder(order.id)
  return { outcome: 'done' }
}

export async function duplicateAndOpenOrder(order: SupplyOrder): Promise<void> {
  const result = await duplicateOrder(order.id)
  if (!result.ok) {
    toastFailure(result.code, result.message, 'Duplicating an order failed')
    return
  }
  // Lines in vaults the caller cannot read are not copied (schema 513 returns how many).
  const skipped = result.skipped
  const copied = t('orders.toastDuplicated', { order: order.orderNumber, copy: result.order.orderNumber })
  store().addToast(
    skipped > 0 ? 'warning' : 'success',
    skipped === 0
      ? copied
      : `${copied} ${skipped === 1 ? t('orders.duplicateSkippedOne') : t('orders.duplicateSkippedMany', { count: skipped })}`,
  )
  await store().loadOrders()
  showOrder(result.order.id)
}

export async function deleteOrderAndClose(order: SupplyOrder): Promise<void> {
  const result = await deleteOrder(order.id)
  if (!result.ok) {
    toastFailure(result.code, result.message, 'Deleting an order failed')
    return
  }
  store().addToast('success', t('orders.toastDeleted', { order: order.orderNumber }))
  if (store().activeOrderId === order.id) store().setActiveOrderId(null)
  await store().loadOrders()
}

/** Export the outputs as a zip, or save them to a folder (desktop). Never throws. */
export async function exportOrderOutputs(
  order: SupplyOrder,
  lines: SupplyOrderLine[],
  mode: 'zip' | 'folder',
): Promise<void> {
  const s = store()
  const orgId = s.organization?.id
  if (!orgId) return
  const states = s.orderOutputStates[order.id]
  const result = await exportOrder(orgId, order, lines, mode, {
    states: states ? new Map(Object.entries(states)) : undefined,
  })
  const missingNote = (missing: number) =>
    missing === 0
      ? ''
      : ` ${missing === 1 ? t('orders.exportMissingOne') : t('orders.exportMissingMany', { count: missing })}`
  switch (result.status) {
    case 'saved':
      store().addToast(
        result.missing > 0 ? 'warning' : 'success',
        t('orders.toastExportSaved', { count: result.files, path: result.path }) +
          missingNote(result.missing),
      )
      return
    case 'downloaded':
      store().addToast(
        result.missing > 0 ? 'warning' : 'success',
        t('orders.toastExportDownloaded', { count: result.files, order: order.orderNumber }) +
          missingNote(result.missing),
      )
      return
    case 'canceled':
      return
    case 'failed':
      log.warn('[Orders]', 'Exporting an order failed', { code: result.code, message: result.message })
      store().addToast(
        'error',
        result.files && result.files.length > 0
          ? `${t(`orders.exportError${result.code}`)} ${result.files.slice(0, 3).join(', ')}`
          : t(`orders.exportError${result.code}`),
      )
  }
}

/**
 * Generate the missing outputs of a draft (desktop): the jobs run in the background through the
 * output queue, and the states are read again once they have all finished.
 */
export function generateMissing(
  order: SupplyOrder,
  lines: SupplyOrderLine[],
  states: Readonly<Record<string, LineOutputState[]>>,
): void {
  const result = generateMissingOutputs(lines, new Map(Object.entries(states)))
  if (result.status === 'desktop_only') {
    store().addToast('info', t('orders.generateOnDesktop'))
    return
  }
  if (result.queued === 0) {
    store().addToast('info', t('orders.toastNothingToGenerate'))
    return
  }
  store().addToast(
    'info',
    result.queued === 1
      ? t('orders.toastGeneratingOne', { order: order.orderNumber })
      : t('orders.toastGeneratingMany', { order: order.orderNumber, count: result.queued }),
  )
  void result.done.then(() => store().refreshOrderOutputs(order.id))
}
