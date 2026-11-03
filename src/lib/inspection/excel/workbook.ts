/**
 * exceljs access for the inspection report engine. exceljs is loaded lazily (dynamic import) so
 * it never lands in the renderer's main chunk; in the browser Vite resolves its `browser` build.
 */
import type { Cell, CellValue, Workbook, Worksheet } from 'exceljs'

import { lazyLoader } from './lazy'

type ExcelJSModule = typeof import('exceljs')

/** Loads exceljs once; a failed import is retried on the next call. */
export const loadExcelJS = lazyLoader<ExcelJSModule>(() =>
  import('exceljs').then((mod: ExcelJSModule & { default?: ExcelJSModule }) =>
    mod.default && typeof mod.default.Workbook === 'function' ? mod.default : mod,
  ),
)

/** Name of the very-hidden sheet that identifies a generated report. */
export const META_SHEET = '_blueplm'

export function toArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = await loadExcelJS()
  return new ExcelJS.Workbook()
}

export async function readWorkbook(bytes: Uint8Array | ArrayBuffer): Promise<Workbook> {
  const workbook = await newWorkbook()
  await workbook.xlsx.load(toArrayBuffer(bytes))
  return workbook
}

export async function writeWorkbook(workbook: Workbook): Promise<Uint8Array> {
  const buffer: ArrayBuffer | Uint8Array = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

/** Plain text of a cell value (rich text joined, formula result, hyperlink text). */
export function valueText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if ('richText' in value) return value.richText.map((r) => r.text).join('')
  if ('formula' in value || 'sharedFormula' in value) {
    const result = (value as { result?: CellValue }).result
    return result === undefined || result === null || typeof result === 'object' ? valueText(result as CellValue) : String(result)
  }
  if ('hyperlink' in value) return typeof value.text === 'string' ? value.text : valueText(value.text as CellValue)
  if ('error' in value) return ''
  return ''
}

export function cellText(cell: Cell): string {
  return valueText(cell.value)
}

/** True when a cell is the master of a merge or not merged. */
export function isMasterOrSingle(cell: Cell): boolean {
  return !cell.isMerged || cell.master.address === cell.address
}

/** Merge ranges of a sheet (`A1:B2`), read from the model. */
export function mergeRanges(ws: Worksheet): string[] {
  return [...(ws.model.merges ?? [])]
}

export interface Box {
  top: number
  left: number
  bottom: number
  right: number
}

export function decodeRange(range: string): Box {
  const [a, b = a] = range.split(':')
  const pa = decodeAddress(a)
  const pb = decodeAddress(b)
  return {
    top: Math.min(pa.row, pb.row),
    left: Math.min(pa.col, pb.col),
    bottom: Math.max(pa.row, pb.row),
    right: Math.max(pa.col, pb.col),
  }
}

export function decodeAddress(address: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(address.trim())
  if (!m) throw new Error(`Bad cell address: ${address}`)
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]), col }
}

export function columnLetter(col: number): string {
  let result = ''
  let n = col
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

export function address(row: number, col: number): string {
  return `${columnLetter(col)}${row}`
}

export function encodeRange(box: Box): string {
  return `${address(box.top, box.left)}:${address(box.bottom, box.right)}`
}
