/**
 * Orders (5.11.0, schema 513): version-pinned lines sent to a supplier, their outputs, and the
 * export (zip or folder). Plan: `.cursor/plans/orders-5.11-agents.plan.md`.
 */

export {
  addOrderLines,
  createOrder,
  deleteOrder,
  duplicateOrder,
  listOrders,
  loadOrder,
  ORDER_LIST_DONE_LIMIT,
  removeOrderLines,
  setOrderStatus,
  updateOrder,
  updateOrderLine,
  type AddOrderLinesResult,
} from './api'
export { ORDER_PAGE_SIZE, readAllPages, type PageQuery } from './paging'
export {
  closureChildLines,
  latestDrawingRefs,
  DRAWING_LINE_KINDS,
  DRAWING_ONLY_LINE_KINDS,
  MODEL_LINE_KINDS,
  pickDrawingModel,
  pickModelDrawing,
  planOrderLinesForFiles,
  type PlanOrderLinesOptions,
  type PlanOrderLinesResult,
  type PlanSkipReason,
} from './plan'
export { lineKindSource, resolveLineOutputs, type LineKindSource } from './outputs'
export { generateMissingOutputs, missingOutputJobs, type GenerateMissingResult } from './generate'
export {
  csvCell,
  lineOutputName,
  ORDER_CSV_HEADERS,
  ORDER_JSON_FORMAT,
  ORDER_JSON_NAME,
  notDeviceName,
  orderBaseName,
  planOrderExport,
  type OrderExportEntry,
  type OrderExportPlan,
} from './exportPlan'
export { exportOrder, type ExportOrderOptions } from './exportOrder'
export { deletable, headerEditable, linesEditable, nextAllowedStatuses } from './status'
