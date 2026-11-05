/**
 * What an order export holds (Export zip / Save files to folder). Pure.
 *
 * - Each line's included, ready outputs, flat, named by the organization's export filename
 *   pattern (`versionOutputFileName`) with the line's snapshot metadata. `source` keeps the
 *   file's own name.
 * - The same content under the same name is written once (two lines sharing a drawing); a
 *   different file under a taken name becomes `name (2).ext`, compared case-insensitively.
 * - `<order number>.csv`: one row per line (RFC 4180, CRLF, UTF-8 with a BOM so Excel reads it;
 *   text cells that start with `=`, `+`, `-`, `@`, tab or CR get a leading `'` so a spreadsheet
 *   never runs them as formulas).
 * - `order.json`: the order, its lines and the hash of every file, for the supplier's tools.
 *
 * The CSV headers are fixed machine-readable column names, not prose, so they are not translated.
 */

import { outputFileName } from '@/lib/outputs/fileName'
import { versionOutputFileName } from '@/lib/outputs/naming'
import { kindTakesConfiguration } from '@/lib/outputs/kinds'
import type { LineOutputState, OrderOutputKind, SupplyOrder, SupplyOrderLine } from '@/types/orders'

export interface OrderExportEntry {
  /** Path inside the zip or the folder (flat: a file name). */
  zipPath: string
  storageHash: string
  fileSize: number
}

export interface OrderExportPlan {
  entries: OrderExportEntry[]
  /** The CSV's file name and text. */
  csv: { name: string; content: string }
  /** `order.json`'s text. */
  json: { name: string; content: string }
  /** The included kinds of each line that are not ready (missing or unsupported). */
  missing: Array<{ lineId: string; kinds: OrderOutputKind[] }>
  /** The base name for the zip and the folder (the order number, safe for a file name). */
  baseName: string
}

export const ORDER_JSON_NAME = 'order.json'
export const ORDER_JSON_FORMAT = 'blueplm-order/1'

export const ORDER_CSV_HEADERS = [
  'line',
  'part_number',
  'description',
  'revision',
  'version',
  'configuration',
  'quantity',
  'files',
] as const

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * A file name Windows can create: a device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9) before the
 * first dot, with any extension, gets an underscore (`CON.step` -> `CON_.step`). Pure.
 */
export function notDeviceName(name: string): string {
  const dot = name.indexOf('.')
  const base = dot < 0 ? name : name.slice(0, dot)
  if (!WINDOWS_DEVICE_NAME.test(base.trim())) return name
  return `${base}_${dot < 0 ? '' : name.slice(dot)}`
}

/** The order number as a file base name (`ORD-0001`); `order` when it is blank. */
export function orderBaseName(order: Pick<SupplyOrder, 'orderNumber'>): string {
  if (!order.orderNumber.trim()) return 'order'
  return notDeviceName(outputFileName('{filename}', { filename: order.orderNumber }, ''))
}

const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV cell: formula guard for text, then RFC 4180 quoting. Pure. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'number' ? String(value) : value
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRow(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',')
}

function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' }
}

/** Names handed out, case-insensitive, with the hash each holds. */
class NameTable {
  private readonly taken = new Map<string, string | null>()

  reserve(name: string): void {
    this.taken.set(name.toLowerCase(), null)
  }

  /** The name `wanted` gets for `hash`, and whether that content is already under it. */
  claim(wanted: string, hash: string): { name: string; duplicate: boolean } {
    const { base, ext } = splitName(wanted)
    for (let n = 1; ; n++) {
      const name = n === 1 ? wanted : `${base} (${n})${ext}`
      const key = name.toLowerCase()
      if (!this.taken.has(key)) {
        this.taken.set(key, hash)
        return { name, duplicate: false }
      }
      if (this.taken.get(key) === hash) return { name, duplicate: true }
    }
  }
}

/** The name `kind` of `line` is saved under (before de-duplication). Pure. */
export function lineOutputName(
  line: Pick<
    SupplyOrderLine,
    'fileName' | 'drawingFileName' | 'drawingVersionId' | 'configuration' | 'partNumber' | 'revision' | 'description'
  >,
  kind: OrderOutputKind,
  pattern: string,
  now?: Date,
): string {
  if (kind === 'source') {
    const name = line.fileName.split(/[\\/]/).pop() || line.fileName
    const { base, ext } = splitName(name)
    return notDeviceName(outputFileName('{filename}', { filename: base }, ext))
  }
  // A drawing export is named after the drawing file, with the line's (the model's) metadata.
  const fromDrawing = (kind === 'pdf' || kind === 'dxf') && line.drawingVersionId && line.drawingFileName
  const named = versionOutputFileName(
    { kind, configuration: kindTakesConfiguration(kind) ? line.configuration : null },
    {
      sourceFileName: fromDrawing ? line.drawingFileName! : line.fileName,
      partNumber: line.partNumber,
      revision: line.revision,
      description: line.description,
    },
    pattern,
    now,
  )
  return notDeviceName(named)
}

export function planOrderExport(
  order: SupplyOrder,
  lines: readonly SupplyOrderLine[],
  states: ReadonlyMap<string, readonly LineOutputState[]>,
  orgPattern: string,
  now: Date = new Date(),
): OrderExportPlan {
  const baseName = orderBaseName(order)
  const csvName = `${baseName}.csv`
  const names = new NameTable()
  names.reserve(csvName)
  names.reserve(ORDER_JSON_NAME)

  const entries: OrderExportEntry[] = []
  const missing: OrderExportPlan['missing'] = []
  const csvLines = [csvRow(ORDER_CSV_HEADERS)]
  const jsonLines: unknown[] = []
  const sorted = [...lines].sort((a, b) => a.position - b.position)

  sorted.forEach((line, index) => {
    const lineStates = states.get(line.id) ?? []
    const files: Array<{ kind: OrderOutputKind; name: string; storageHash: string; fileSize: number }> = []
    const lacking: OrderOutputKind[] = []
    for (const kind of line.outputKinds) {
      const state = lineStates.find((s) => s.kind === kind)
      if (!state || state.status !== 'ready' || !state.output) {
        lacking.push(kind)
        continue
      }
      const { name, duplicate } = names.claim(lineOutputName(line, kind, orgPattern, now), state.output.storageHash)
      if (!duplicate) {
        entries.push({ zipPath: name, storageHash: state.output.storageHash, fileSize: state.output.fileSize })
      }
      files.push({ kind, name, storageHash: state.output.storageHash, fileSize: state.output.fileSize })
    }
    if (lacking.length > 0) missing.push({ lineId: line.id, kinds: lacking })
    csvLines.push(
      csvRow([
        index + 1,
        line.partNumber,
        line.description,
        line.revision,
        line.version,
        line.configuration,
        line.quantity,
        files.map((f) => f.name).join('; '),
      ]),
    )
    jsonLines.push({
      line: index + 1,
      file_name: line.fileName,
      part_number: line.partNumber,
      description: line.description,
      revision: line.revision,
      version: line.version,
      configuration: line.configuration,
      drawing_file_name: line.drawingFileName,
      drawing_version: line.drawingVersion,
      quantity: line.quantity,
      notes: line.notes,
      files: files.map((f) => ({ kind: f.kind, name: f.name, sha256: f.storageHash, size: f.fileSize })),
      missing_kinds: lacking,
    })
  })

  const json = {
    format: ORDER_JSON_FORMAT,
    exported_at: now.toISOString(),
    order: {
      order_number: order.orderNumber,
      title: order.title,
      purpose: order.purpose,
      status: order.status,
      supplier_name: order.supplierName,
      due_date: order.dueDate,
      notes: order.notes,
      sent_at: order.sentAt,
      line_count: order.lineCount,
    },
    lines: jsonLines,
  }

  return {
    entries,
    csv: { name: csvName, content: `\uFEFF${csvLines.join('\r\n')}\r\n` },
    json: { name: ORDER_JSON_NAME, content: `${JSON.stringify(json, null, 2)}\n` },
    missing,
    baseName,
  }
}
