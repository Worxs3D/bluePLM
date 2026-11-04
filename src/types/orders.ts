/**
 * Orders (5.11.0, schema 513): a named group of lines sent to a supplier. Each line pins a
 * checked-in model version (or a lone drawing), optionally the drawing whose PDF goes with it, a
 * quantity and the output kinds to send. Once an order is sent its lines freeze and the outputs
 * that went out are recorded (`sentOutputs`). Tables `supply_order` and `supply_order_line`; every
 * write goes through a SECURITY DEFINER RPC. Plan: `.cursor/plans/orders-5.11-agents.plan.md`.
 */

import type { VersionOutputKind } from './versionOutputs'

export type OrderStatus = 'draft' | 'sent' | 'received' | 'closed' | 'cancelled'

export const ORDER_STATUSES: readonly OrderStatus[] = ['draft', 'sent', 'received', 'closed', 'cancelled']

/** Statuses the sidebar's "Open" filter shows. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['draft', 'sent', 'received']

export type OrderPurpose = 'quote' | 'purchase'

export const ORDER_PURPOSES: readonly OrderPurpose[] = ['quote', 'purchase']

/** What a line can send: a version output, or `source` (the version's own file bytes). */
export type OrderOutputKind = VersionOutputKind | 'source'

/** Every kind, in the order a line shows its chips. */
export const ORDER_OUTPUT_KINDS: readonly OrderOutputKind[] = ['pdf', 'step', 'iges', 'stl', 'dxf', 'source']

/**
 * The transitions `supply_order_set_status` allows: `draft → sent → received → closed`,
 * `draft|sent|received → cancelled`, `cancelled → draft`, and `sent → draft` (reopen, which
 * clears the recorded outputs).
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ['sent', 'cancelled'],
  sent: ['received', 'draft', 'cancelled'],
  received: ['closed', 'cancelled'],
  closed: [],
  cancelled: ['draft'],
}

/** An output recorded when the order was sent (`supply_order_line.sent_outputs`). */
export interface SentOutput {
  kind: OrderOutputKind
  /** SHA-256 of the content in the vault bucket. */
  storageHash: string
  fileSize: number
  /** The name it was generated under; null when the row has none (a drawing PDF). */
  fileName: string | null
}

/** A `supply_order` row. */
export interface SupplyOrder {
  id: string
  orgId: string
  sequence: number
  orderNumber: string
  title: string
  purpose: OrderPurpose
  status: OrderStatus
  supplierId: string | null
  /** Free text, or the name the supplier had when picked. */
  supplierName: string | null
  /** `YYYY-MM-DD`. */
  dueDate: string | null
  notes: string | null
  /** Every line, including lines in vaults the reader cannot see (kept by trigger). */
  lineCount: number
  createdBy: string | null
  createdAt: string
  updatedBy: string | null
  updatedAt: string | null
  sentBy: string | null
  sentAt: string | null
  receivedAt: string | null
  closedAt: string | null
  cancelledAt: string | null
}

/** A `supply_order_line` row. The snapshot columns keep an order readable after files move on. */
export interface SupplyOrderLine {
  id: string
  orderId: string
  orgId: string
  position: number
  /**
   * The file and version pinned; null once the file is purged (the snapshot columns keep the line
   * readable, and it has nothing to export).
   */
  fileId: string | null
  fileVersionId: string | null
  /** The vault the file was in when pinned. */
  vaultId: string | null
  /** The configuration ordered; null = the one the version was saved in. */
  configuration: string | null
  /** The drawing pinned; null when none, or once it is purged (`drawingFileName` still says). */
  drawingFileId: string | null
  drawingVersionId: string | null
  drawingVaultId: string | null
  quantity: number
  outputKinds: OrderOutputKind[]
  notes: string | null
  fileName: string
  partNumber: string | null
  description: string | null
  revision: string | null
  version: number
  drawingFileName: string | null
  drawingVersion: number | null
  /** Set when the order was sent; null while it is a draft (or after a reopen). */
  sentOutputs: SentOutput[] | null
  /** The included kinds that had no output when the order was sent. */
  missingKinds: OrderOutputKind[] | null
  addedBy: string | null
  addedAt: string
  updatedAt: string | null
}

/** Why an order RPC refused (its `HINT`), or `UNKNOWN`. */
export type OrderErrorCode =
  | 'NOT_FOUND'
  | 'NOT_MEMBER'
  | 'NO_MODULE_ACCESS'
  | 'NOT_DRAFT'
  | 'FROZEN'
  | 'BAD_TRANSITION'
  | 'EMPTY_ORDER'
  | 'MISSING_OUTPUTS'
  | 'NOT_ALLOWED'
  | 'BAD_PATCH'
  | 'BAD_KIND'
  | 'BAD_QUANTITY'
  | 'NO_VAULT_ACCESS'
  | 'UNKNOWN'

export const ORDER_ERROR_CODES: readonly OrderErrorCode[] = [
  'NOT_FOUND',
  'NOT_MEMBER',
  'NO_MODULE_ACCESS',
  'NOT_DRAFT',
  'FROZEN',
  'BAD_TRANSITION',
  'EMPTY_ORDER',
  'MISSING_OUTPUTS',
  'NOT_ALLOWED',
  'BAD_PATCH',
  'BAD_KIND',
  'BAD_QUANTITY',
  'NO_VAULT_ACCESS',
]

/** Why `supply_order_add_lines` skipped an element. */
export type OrderLineSkipReason = 'NOT_FOUND' | 'NO_VAULT_ACCESS' | 'NOT_A_DRAWING' | 'WRONG_ORG'

/**
 * Whether one kind of a line can be sent. `ready` carries the output; `missing` = the line can
 * have it but none is generated (or none was recorded when it was sent); `unsupported` = the line
 * cannot have this kind (a PDF of a part with no drawing, DXF without a drawing).
 */
export interface LineOutputState {
  kind: OrderOutputKind
  status: 'ready' | 'missing' | 'unsupported'
  /** Whether the line includes this kind (`outputKinds`). States are given for every kind. */
  included: boolean
  output?: { storageHash: string; fileSize: number; fileName: string | null }
}

/** One element of `supply_order_add_lines(p_lines)`. */
export interface AddLineInput {
  fileVersionId: string
  configuration?: string | null
  drawingVersionId?: string | null
  quantity?: number
  outputKinds?: OrderOutputKind[]
}

/** Fields of a new order (`supply_order_create`). */
export interface CreateOrderInput {
  title: string
  purpose?: OrderPurpose
  supplierId?: string | null
  supplierName?: string | null
  dueDate?: string | null
  notes?: string | null
}

/** `supply_order_update(p_patch)`: only the keys given are changed. */
export interface OrderHeaderPatch {
  title?: string
  purpose?: OrderPurpose
  supplierId?: string | null
  supplierName?: string | null
  dueDate?: string | null
  notes?: string | null
}

/** `supply_order_update_line(p_patch)`: only the keys given are changed. */
export interface OrderLinePatch {
  quantity?: number
  outputKinds?: OrderOutputKind[]
  notes?: string | null
  /** Another version of the same file (re-pin). */
  fileVersionId?: string
  /** A drawing's version, or null to drop the drawing. */
  drawingVersionId?: string | null
}

/** What every order write returns. */
export type OrderResult<T extends object = object> =
  | ({ ok: true } & T)
  | {
      ok: false
      code: OrderErrorCode
      message: string
      /** With `MISSING_OUTPUTS`: the kinds each line lacks, when the server said. */
      missing?: Array<{ lineId: string; kinds: OrderOutputKind[] }>
    }

/** Why an order export failed (`exportOrder`). */
export type OrderExportErrorCode =
  /** The order has no lines this user can see. */
  | 'NOTHING_TO_EXPORT'
  /** Saving into a folder needs the desktop app. */
  | 'DESKTOP_ONLY'
  /** A file's content is marked damaged or missing (schema 503); `files` names them. */
  | 'BLOCKED_CONTENT'
  | 'TOO_MANY_FILES'
  | 'TOO_LARGE'
  /** No signed URL could be made for a file. */
  | 'NO_URL'
  /** A download did not hash to the content it names; the whole export is refused. */
  | 'HASH_MISMATCH'
  | 'DOWNLOAD_FAILED'
  | 'WRITE_FAILED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN'

export interface OrderExportProgress {
  phase: 'preparing' | 'downloading' | 'writing'
  completed: number
  total: number
}

export type ExportOrderResult =
  /** Desktop: written to `path` (the zip, or the new folder). */
  | { status: 'saved'; path: string; files: number; missing: number }
  /** Web: the browser saved the zip. */
  | { status: 'downloaded'; files: number; missing: number }
  | { status: 'canceled' }
  | { status: 'failed'; code: OrderExportErrorCode; message: string; files?: string[] }
