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
import { requestMissingOutputs } from '@/lib/orders/generate'
import { applyDefaultKinds, orderSettingsFromOrg } from '@/lib/orders/settings'
import { cancelOutputRequests } from '@/lib/outputs'
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
  OrderPurpose,
  OrderStatus,
  SupplyOrder,
  SupplyOrderLine,
} from '@/types/orders'
import type { OutputRequestErrorCode } from '@/types/outputRequests'

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

/**
 * Create an empty draft (a purchase unless `purpose` says quote) and open it. Returns the new
 * order, or null (a toast said why).
 */
export async function createAndOpenOrder(
  title?: string,
  purpose?: OrderPurpose,
): Promise<SupplyOrder | null> {
  const result = await createOrder({ title: title?.trim() || t('orders.untitled'), ...(purpose ? { purpose } : {}) })
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
    // The organization's default kinds per kind of line (Settings > Orders).
    const lines = applyDefaultKinds(plan.lines, orderSettingsFromOrg(store().organization?.settings))
    const title = defaultOrderTitle(
      files.map((f) => ({ partNumber: f.pdmData?.part_number ?? null, name: f.name })),
      (key, params) =>
        key === 'one' ? params.first : t('orders.titleAndMore', { first: params.first, count: params.count }),
    )
    await addPlannedLines(target, lines, plan.skipped, title)
  } catch (error) {
    log.error('[Orders]', 'Planning order lines failed', { error })
    store().addToast('error', t('orders.toastAddFailed'))
  }
}

/**
 * Files dropped on a draft order (the list row or the open order), added like the context menu's
 * Add. `found` are the store's files for the drag, `orderable` those that can become lines.
 */
export async function dropFilesOnOrder(
  orderId: string,
  found: readonly LocalFile[],
  orderable: readonly LocalFile[],
): Promise<void> {
  if (found.length === 0) return
  if (orderable.length === 0) {
    store().addToast('warning', t('orders.toastDropNothing'))
    return
  }
  await addFilesToOrder(orderable, { orderId }, false)
}

/** Version history's "Add this version to order": exactly that version, nothing paired. */
export async function addVersionToOrder(
  file: Pick<LocalFile, 'name' | 'extension' | 'pdmData'>,
  fileVersionId: string,
  target: OrderTarget,
): Promise<void> {
  const isDrawing = file.extension.toLowerCase() === '.slddrw'
  // Nothing is paired here, so a model is a line without a drawing.
  const defaults = orderSettingsFromOrg(store().organization?.settings).defaultKinds
  const kinds: OrderOutputKind[] = isDrawing ? defaults.drawing : defaults.model
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

/** The sentence for a refused output request; codes without their own fall back to UNKNOWN. */
function requestErrorText(code: OutputRequestErrorCode): string {
  const known: readonly OutputRequestErrorCode[] = ['NO_VAULT_ACCESS', 'NOT_ALLOWED', 'NOT_MEMBER']
  return t(`orders.requestError${known.includes(code) ? code : 'UNKNOWN'}`)
}

/**
 * Request the missing outputs of a draft (web, or a desktop without SOLIDWORKS): any signed-in
 * desktop with SOLIDWORKS that can read the vault generates them, and the chips say "Requested"
 * until it has. The states are read again so the chips change at once.
 */
export async function requestMissing(
  order: SupplyOrder,
  lines: SupplyOrderLine[],
  states: Readonly<Record<string, LineOutputState[]>>,
): Promise<void> {
  const result = await requestMissingOutputs(lines, new Map(Object.entries(states)))
  if (!result.ok) {
    log.warn('[Orders]', 'Requesting outputs failed', { code: result.code, message: result.message })
    store().addToast('error', requestErrorText(result.code))
    return
  }
  const asked = result.created + result.existing
  const skipped = result.skipped.length
  if (asked === 0 && skipped === 0) {
    store().addToast('info', t('orders.toastNothingToRequest'))
  } else {
    const sentence =
      asked === 1
        ? t('orders.toastRequestedOne', { order: order.orderNumber })
        : t('orders.toastRequestedMany', { order: order.orderNumber, count: asked })
    const skippedNote =
      skipped === 0 ? '' : ` ${skipped === 1 ? t('orders.requestSkippedOne') : t('orders.requestSkippedMany', { count: skipped })}`
    store().addToast(skipped > 0 ? 'warning' : 'success', asked === 0 ? skippedNote.trim() : sentence + skippedNote)
  }
  await store().refreshOrderOutputs(order.id)
}

/** Cancel output requests (the requester's own, or any for an admin) and read the states again. */
export async function cancelRequests(order: SupplyOrder, requestIds: readonly string[]): Promise<void> {
  if (requestIds.length === 0) return
  const result = await cancelOutputRequests(requestIds)
  if (!result.ok) {
    log.warn('[Orders]', 'Cancelling output requests failed', { code: result.code, message: result.message })
    store().addToast('error', requestErrorText(result.code))
  } else {
    store().addToast(
      'success',
      result.cancelled === 1 ? t('orders.toastRequestCancelledOne') : t('orders.toastRequestCancelledMany', { count: result.cancelled }),
    )
  }
  await store().refreshOrderOutputs(order.id)
}
