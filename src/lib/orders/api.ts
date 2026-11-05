/**
 * Orders on the server (schema 513): reads of `supply_order` / `supply_order_line` under RLS
 * (orders org-wide, a line only when its file's vault is readable) and the SECURITY DEFINER RPCs,
 * the only writers. Every write returns `{ ok: true, ... }` or `{ ok: false, code, message }`,
 * where `code` is the RPC's `HINT` (the 505/509 convention) or `UNKNOWN`; nothing here throws for
 * a refusal. The reads throw on a query error.
 *
 * Calls go through the untyped client, as the 505 output wrappers do, so this file does not depend
 * on `npm run gen:types` having run against 513. RPC names and argument keys are literal so
 * `rpcContract.test.ts` can check each call against its SQL signature.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logger'
import { getSupabaseClient } from '@/lib/supabase/client'
import {
  ORDER_ERROR_CODES,
  type AddLineInput,
  type CreateOrderInput,
  type OrderErrorCode,
  type OrderHeaderPatch,
  type OrderLinePatch,
  type OrderLineSkipReason,
  type OrderOutputKind,
  type OrderResult,
  type OrderStatus,
  type SupplyOrder,
  type SupplyOrderLine,
} from '@/types/orders'

import {
  isOrderOutputKind,
  isRow,
  LINE_COLUMNS,
  ORDER_COLUMNS,
  sortLines,
  toSupplyOrder,
  toSupplyOrderLine,
} from './rows'
import { readAllPages } from './paging'

/** Closed and cancelled orders the list loads (the newest); open orders load without a cap. */
export const ORDER_LIST_DONE_LIMIT = 200
const OPEN_STATUSES = ['draft', 'sent', 'received']
const DONE_STATUSES = ['closed', 'cancelled']

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

type RpcError = Pick<PostgrestError, 'message' | 'code'> & { hint?: string | null; details?: string | null }

/** The error code of a refused RPC: its hint when it is one of ours. */
export function orderErrorCode(error: { hint?: string | null } | null | undefined): OrderErrorCode {
  const hint = error?.hint ?? ''
  return ORDER_ERROR_CODES.find((c) => c === hint) ?? 'UNKNOWN'
}

/** `[{line_id, kinds}]` from a MISSING_OUTPUTS refusal's DETAIL, when it carries one. */
export function missingFromDetail(details: string | null | undefined): Array<{ lineId: string; kinds: OrderOutputKind[] }> | undefined {
  if (!details) return undefined
  try {
    const parsed: unknown = JSON.parse(details)
    return missingList(parsed)
  } catch {
    return undefined
  }
}

function missingList(v: unknown): Array<{ lineId: string; kinds: OrderOutputKind[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ lineId: string; kinds: OrderOutputKind[] }> = []
  for (const item of v) {
    if (!isRow(item) || typeof item.line_id !== 'string') continue
    const kinds = Array.isArray(item.kinds) ? item.kinds.filter(isOrderOutputKind) : []
    out.push({ lineId: item.line_id, kinds })
  }
  return out
}

type Refusal = Extract<OrderResult, { ok: false }>

function refusal(fn: string, error: RpcError): Refusal {
  const code = orderErrorCode(error)
  log.warn('[Orders]', `${fn} failed`, { code, sqlState: error.code, message: error.message })
  const missing = code === 'MISSING_OUTPUTS' ? missingFromDetail(error.details) : undefined
  return missing ? { ok: false, code, message: error.message, missing } : { ok: false, code, message: error.message }
}

function thrown(fn: string, error: unknown): Refusal {
  const message = error instanceof Error ? error.message : String(error)
  log.warn('[Orders]', `${fn} failed`, { code: 'UNKNOWN', message })
  return { ok: false, code: 'UNKNOWN', message }
}

/** Run one RPC; a refusal or a thrown error comes back as `{ ok: false }`. */
async function callOrderRpc<T extends object>(
  fn: string,
  call: () => PromiseLike<{ data: unknown; error: RpcError | null }>,
  map: (data: Record<string, unknown>) => T,
): Promise<OrderResult<T>> {
  try {
    const { data, error } = await call()
    if (error) return refusal(fn, error)
    return { ok: true, ...map(isRow(data) ? data : {}) }
  } catch (error) {
    return thrown(fn, error)
  }
}

function orderOf(data: Record<string, unknown>): { order: SupplyOrder } {
  return { order: toSupplyOrder(isRow(data.order) ? data.order : {}) }
}

function count(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The organization's orders, newest first: every open one (draft, sent, received), with no cap,
 * and the newest `ORDER_LIST_DONE_LIMIT` closed or cancelled ones. Throws on a query error.
 */
export async function listOrders(orgId: string): Promise<SupplyOrder[]> {
  const [open, done] = await Promise.all([
    readAllPages((from, to) =>
      db()
        .from('supply_order')
        .select(ORDER_COLUMNS)
        .eq('org_id', orgId)
        .in('status', OPEN_STATUSES)
        .order('sequence', { ascending: false })
        .range(from, to),
    ),
    db()
      .from('supply_order')
      .select(ORDER_COLUMNS)
      .eq('org_id', orgId)
      .in('status', DONE_STATUSES)
      .order('sequence', { ascending: false })
      .limit(ORDER_LIST_DONE_LIMIT),
  ])
  if (done.error) throw new Error(done.error.message)
  const rows = [...open, ...((done.data ?? []) as unknown[]).filter(isRow)]
  const byId = new Map(rows.map(toSupplyOrder).map((o) => [o.id, o]))
  return [...byId.values()].sort((a, b) => b.sequence - a.sequence)
}

/**
 * One order and the lines this user can see (RLS hides lines in vaults they cannot read;
 * `order.lineCount` still counts them). Null when the order is gone or not visible. Throws on a
 * query error.
 */
export async function loadOrder(
  orderId: string,
): Promise<{ order: SupplyOrder; lines: SupplyOrderLine[] } | null> {
  const [orderRes, lineRows] = await Promise.all([
    db().from('supply_order').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle(),
    readAllPages((from, to) =>
      db()
        .from('supply_order_line')
        .select(LINE_COLUMNS)
        .eq('order_id', orderId)
        .order('position', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])
  if (orderRes.error) throw new Error(orderRes.error.message)
  if (!isRow(orderRes.data)) return null
  const lines = sortLines(lineRows.map(toSupplyOrderLine))
  return { order: toSupplyOrder(orderRes.data), lines }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function createOrder(input: CreateOrderInput): Promise<OrderResult<{ order: SupplyOrder }>> {
  return callOrderRpc(
    'supply_order_create',
    () =>
      db().rpc('supply_order_create', {
        p_title: input.title,
        p_purpose: input.purpose ?? 'purchase',
        p_supplier_id: input.supplierId ?? null,
        p_supplier_name: input.supplierName ?? null,
        p_due_date: input.dueDate ?? null,
        p_notes: input.notes ?? null,
      }),
    orderOf,
  )
}

/** The snake_case patch of the keys given (undefined keys are left out, null clears). */
export function headerPatchJson(patch: OrderHeaderPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.title !== undefined) out.title = patch.title
  if (patch.purpose !== undefined) out.purpose = patch.purpose
  if (patch.supplierId !== undefined) out.supplier_id = patch.supplierId
  if (patch.supplierName !== undefined) out.supplier_name = patch.supplierName
  if (patch.dueDate !== undefined) out.due_date = patch.dueDate
  if (patch.notes !== undefined) out.notes = patch.notes
  return out
}

export function linePatchJson(patch: OrderLinePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.quantity !== undefined) out.quantity = patch.quantity
  if (patch.outputKinds !== undefined) out.output_kinds = patch.outputKinds
  if (patch.notes !== undefined) out.notes = patch.notes
  if (patch.fileVersionId !== undefined) out.file_version_id = patch.fileVersionId
  if (patch.drawingVersionId !== undefined) out.drawing_version_id = patch.drawingVersionId
  return out
}

/** The `p_lines` json of `supply_order_add_lines`: only the keys given. */
export function addLinesJson(lines: readonly AddLineInput[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const out: Record<string, unknown> = { file_version_id: line.fileVersionId }
    if (line.configuration !== undefined) out.configuration = line.configuration
    if (line.drawingVersionId !== undefined) out.drawing_version_id = line.drawingVersionId
    if (line.quantity !== undefined) out.quantity = line.quantity
    if (line.outputKinds !== undefined) out.output_kinds = line.outputKinds
    return out
  })
}

export function updateOrder(
  orderId: string,
  patch: OrderHeaderPatch,
): Promise<OrderResult<{ order: SupplyOrder }>> {
  return callOrderRpc(
    'supply_order_update',
    () => db().rpc('supply_order_update', { p_order_id: orderId, p_patch: headerPatchJson(patch) }),
    orderOf,
  )
}

const SKIP_REASONS: readonly OrderLineSkipReason[] = ['NOT_FOUND', 'NO_VAULT_ACCESS', 'NOT_A_DRAWING', 'WRONG_ORG']

export interface AddOrderLinesResult {
  added: number
  updated: number
  skipped: Array<{ fileVersionId: string; reason: OrderLineSkipReason }>
}

export function addOrderLines(
  orderId: string,
  lines: readonly AddLineInput[],
): Promise<OrderResult<AddOrderLinesResult>> {
  return callOrderRpc(
    'supply_order_add_lines',
    () => db().rpc('supply_order_add_lines', { p_order_id: orderId, p_lines: addLinesJson(lines) }),
    (data) => ({
      added: count(data.added),
      updated: count(data.updated),
      skipped: (Array.isArray(data.skipped) ? data.skipped : []).filter(isRow).map((s) => ({
        fileVersionId: typeof s.file_version_id === 'string' ? s.file_version_id : '',
        reason: SKIP_REASONS.find((r) => r === s.reason) ?? 'NOT_FOUND',
      })),
    }),
  )
}

export function updateOrderLine(
  lineId: string,
  patch: OrderLinePatch,
): Promise<OrderResult<{ line: SupplyOrderLine }>> {
  return callOrderRpc(
    'supply_order_update_line',
    () => db().rpc('supply_order_update_line', { p_line_id: lineId, p_patch: linePatchJson(patch) }),
    (data) => ({ line: toSupplyOrderLine(isRow(data.line) ? data.line : {}) }),
  )
}

export function removeOrderLines(
  orderId: string,
  lineIds: readonly string[],
): Promise<OrderResult<{ removed: number }>> {
  return callOrderRpc(
    'supply_order_remove_lines',
    () => db().rpc('supply_order_remove_lines', { p_order_id: orderId, p_line_ids: [...lineIds] }),
    (data) => ({ removed: count(data.removed) }),
  )
}

/**
 * Move an order to `status`. Sending (`sent`) records the outputs that go out and refuses
 * `MISSING_OUTPUTS` unless `allowMissing`; `missing` lists what each line lacked.
 */
export function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  allowMissing = false,
): Promise<OrderResult<{ order: SupplyOrder; missing: Array<{ lineId: string; kinds: OrderOutputKind[] }> }>> {
  return callOrderRpc(
    'supply_order_set_status',
    () =>
      db().rpc('supply_order_set_status', {
        p_order_id: orderId,
        p_status: status,
        p_allow_missing: allowMissing,
      }),
    (data) => ({ ...orderOf(data), missing: missingList(data.missing) ?? [] }),
  )
}

/** A new draft with the same lines and pinned versions; lines this user cannot read are skipped. */
export function duplicateOrder(
  orderId: string,
  title?: string | null,
): Promise<OrderResult<{ order: SupplyOrder; skipped: number }>> {
  return callOrderRpc(
    'supply_order_duplicate',
    () => db().rpc('supply_order_duplicate', { p_order_id: orderId, p_title: title ?? null }),
    (data) => ({ ...orderOf(data), skipped: count(data.skipped) }),
  )
}

/** Delete a draft or cancelled order (its creator or an administrator). */
export function deleteOrder(orderId: string): Promise<OrderResult> {
  return callOrderRpc(
    'supply_order_delete',
    () => db().rpc('supply_order_delete', { p_order_id: orderId }),
    () => ({}),
  )
}
