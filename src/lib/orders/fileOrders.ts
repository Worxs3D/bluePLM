/**
 * "Orders this file is in" (5.13.0): the orders whose lines pin a file, as the model of a line or
 * as its drawing, for the Orders tab of the file details pane. Lines are read under RLS (a line
 * only when its file's vault is readable), orders org-wide. Bounded: the newest
 * `FILE_ORDER_LINE_LIMIT` lines of each kind, which is far more orders than one file is ever in.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseClient } from '@/lib/supabase/client'
import type { SupplyOrder } from '@/types/orders'

import { isRow, ORDER_COLUMNS, toSupplyOrder } from './rows'

/** Lines read per kind (model, drawing). */
export const FILE_ORDER_LINE_LIMIT = 200

/** One line's pin of the file, as `groupFileOrders` reads it. */
export interface FileOrderPin {
  orderId: string
  /** The version of this file the line pins. */
  version: number | null
  /** The file is the line's drawing, not its model. */
  asDrawing: boolean
}

/** One order the file is in, with the versions of the file its lines pin. */
export interface FileOrderEntry {
  order: SupplyOrder
  /** Distinct pinned versions, newest first. */
  versions: number[]
  /** Some line pins the file as its drawing. */
  asDrawing: boolean
}

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * The orders of these pins, newest order first (by number), each with its pinned versions. Pins
 * whose order is not in `orders` (not visible) are dropped. Pure.
 */
export function groupFileOrders(
  pins: readonly FileOrderPin[],
  orders: readonly SupplyOrder[],
): FileOrderEntry[] {
  const byId = new Map(orders.map((o) => [o.id, o]))
  const entries = new Map<string, { order: SupplyOrder; versions: Set<number>; asDrawing: boolean }>()
  for (const pin of pins) {
    const order = byId.get(pin.orderId)
    if (!order) continue
    const entry = entries.get(order.id) ?? { order, versions: new Set<number>(), asDrawing: false }
    if (pin.version !== null) entry.versions.add(pin.version)
    entry.asDrawing ||= pin.asDrawing
    entries.set(order.id, entry)
  }
  return [...entries.values()]
    .map((e) => ({ order: e.order, versions: [...e.versions].sort((a, b) => b - a), asDrawing: e.asDrawing }))
    .sort((a, b) => b.order.sequence - a.order.sequence)
}

/** The orders whose lines pin this file. Throws on a query error. */
export async function listOrdersForFile(fileId: string): Promise<FileOrderEntry[]> {
  const [models, drawings] = await Promise.all([
    db()
      .from('supply_order_line')
      .select('order_id, version')
      .eq('file_id', fileId)
      .order('added_at', { ascending: false })
      .limit(FILE_ORDER_LINE_LIMIT),
    db()
      .from('supply_order_line')
      .select('order_id, drawing_version')
      .eq('drawing_file_id', fileId)
      .order('added_at', { ascending: false })
      .limit(FILE_ORDER_LINE_LIMIT),
  ])
  if (models.error) throw new Error(models.error.message)
  if (drawings.error) throw new Error(drawings.error.message)
  const pins: FileOrderPin[] = [
    ...((models.data ?? []) as unknown[]).filter(isRow).map((r) => ({
      orderId: String(r.order_id ?? ''),
      version: num(r.version),
      asDrawing: false,
    })),
    ...((drawings.data ?? []) as unknown[]).filter(isRow).map((r) => ({
      orderId: String(r.order_id ?? ''),
      version: num(r.drawing_version),
      asDrawing: true,
    })),
  ].filter((p) => p.orderId !== '')
  const ids = [...new Set(pins.map((p) => p.orderId))]
  if (ids.length === 0) return []
  const { data, error } = await db().from('supply_order').select(ORDER_COLUMNS).in('id', ids)
  if (error) throw new Error(error.message)
  const orders = ((data ?? []) as unknown[]).filter(isRow).map(toSupplyOrder)
  return groupFileOrders(pins, orders)
}
