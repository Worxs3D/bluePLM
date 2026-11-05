/**
 * `supply_order` and `supply_order_line` rows (PostgREST SELECT or an RPC's row json) to the
 * camelCase domain types. Tolerant: a missing or mistyped column becomes its empty value, never a
 * throw, so one odd row cannot blank the whole list. Pure.
 */

import {
  ORDER_OUTPUT_KINDS,
  ORDER_PURPOSES,
  ORDER_STATUSES,
  type OrderOutputKind,
  type OrderPurpose,
  type OrderStatus,
  type SentOutput,
  type SupplyOrder,
  type SupplyOrderLine,
} from '@/types/orders'

export const ORDER_COLUMNS =
  'id, org_id, sequence, order_number, title, purpose, status, supplier_id, supplier_name, due_date, notes, line_count, created_by, created_at, updated_by, updated_at, sent_by, sent_at, received_at, closed_at, cancelled_at'

export const LINE_COLUMNS =
  'id, order_id, org_id, position, file_id, file_version_id, vault_id, configuration, drawing_file_id, drawing_version_id, drawing_vault_id, quantity, output_kinds, notes, file_name, part_number, description, revision, version, drawing_file_name, drawing_version, sent_outputs, missing_kinds, added_by, added_at, updated_at'

type Row = Record<string, unknown>

export function isRow(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = num(v, NaN)
  return Number.isFinite(n) ? n : null
}

export function isOrderOutputKind(v: unknown): v is OrderOutputKind {
  return typeof v === 'string' && (ORDER_OUTPUT_KINDS as readonly string[]).includes(v)
}

function kinds(v: unknown): OrderOutputKind[] {
  if (!Array.isArray(v)) return []
  return ORDER_OUTPUT_KINDS.filter((k) => v.includes(k))
}

function status(v: unknown): OrderStatus {
  return (ORDER_STATUSES as readonly unknown[]).includes(v) ? (v as OrderStatus) : 'draft'
}

function purpose(v: unknown): OrderPurpose {
  return (ORDER_PURPOSES as readonly unknown[]).includes(v) ? (v as OrderPurpose) : 'purchase'
}

function sentOutputs(v: unknown): SentOutput[] | null {
  if (!Array.isArray(v)) return null
  const out: SentOutput[] = []
  for (const item of v) {
    if (!isRow(item) || !isOrderOutputKind(item.kind)) continue
    const storageHash = str(item.storage_hash)
    if (!storageHash) continue
    out.push({
      kind: item.kind,
      storageHash,
      fileSize: num(item.file_size),
      fileName: strOrNull(item.file_name),
    })
  }
  return out
}

export function toSupplyOrder(row: Row): SupplyOrder {
  return {
    id: str(row.id),
    orgId: str(row.org_id),
    sequence: num(row.sequence),
    orderNumber: str(row.order_number),
    title: str(row.title),
    purpose: purpose(row.purpose),
    status: status(row.status),
    supplierId: strOrNull(row.supplier_id),
    supplierName: strOrNull(row.supplier_name),
    dueDate: strOrNull(row.due_date),
    notes: strOrNull(row.notes),
    lineCount: num(row.line_count),
    createdBy: strOrNull(row.created_by),
    createdAt: str(row.created_at),
    updatedBy: strOrNull(row.updated_by),
    updatedAt: strOrNull(row.updated_at),
    sentBy: strOrNull(row.sent_by),
    sentAt: strOrNull(row.sent_at),
    receivedAt: strOrNull(row.received_at),
    closedAt: strOrNull(row.closed_at),
    cancelledAt: strOrNull(row.cancelled_at),
  }
}

export function toSupplyOrderLine(row: Row): SupplyOrderLine {
  return {
    id: str(row.id),
    orderId: str(row.order_id),
    orgId: str(row.org_id),
    position: num(row.position),
    fileId: strOrNull(row.file_id),
    fileVersionId: strOrNull(row.file_version_id),
    vaultId: strOrNull(row.vault_id),
    configuration: strOrNull(row.configuration),
    drawingFileId: strOrNull(row.drawing_file_id),
    drawingVersionId: strOrNull(row.drawing_version_id),
    drawingVaultId: strOrNull(row.drawing_vault_id),
    quantity: num(row.quantity, 1),
    outputKinds: kinds(row.output_kinds),
    notes: strOrNull(row.notes),
    fileName: str(row.file_name),
    partNumber: strOrNull(row.part_number),
    description: strOrNull(row.description),
    revision: strOrNull(row.revision),
    version: num(row.version),
    drawingFileName: strOrNull(row.drawing_file_name),
    drawingVersion: numOrNull(row.drawing_version),
    sentOutputs: sentOutputs(row.sent_outputs),
    missingKinds: Array.isArray(row.missing_kinds) ? kinds(row.missing_kinds) : null,
    addedBy: strOrNull(row.added_by),
    addedAt: str(row.added_at),
    updatedAt: strOrNull(row.updated_at),
  }
}

/** Lines in the order the order lists them. */
export function sortLines(lines: SupplyOrderLine[]): SupplyOrderLine[] {
  return lines.sort((a, b) => a.position - b.position || a.addedAt.localeCompare(b.addedAt))
}
