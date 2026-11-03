/**
 * Image placement for generated reports: the organization logo at `{{LOGO}}` cells and the
 * drawing pages stacked on the table sheet (or at `{{DRAWING}}`), one printed page each.
 *
 * Sheet geometry is in px at 96 dpi: a column of width w characters is `w * 7 + 5` px, a row of
 * h points is `h * 96 / 72` px (Excel's own conversions for the default Calibri 11 font).
 */
import type { Workbook, Worksheet } from 'exceljs'

import { decodeAddress, decodeRange, encodeRange, mergeRanges, toArrayBuffer, type Box } from './workbook'

export interface DrawingPageImage {
  png: Uint8Array
  widthPx: number
  heightPx: number
}

export interface ReportLogo {
  bytes: Uint8Array
  extension: 'png' | 'jpeg'
}

const DEFAULT_COL_PX = 64
const DEFAULT_ROW_PX = 20
/** Rows reserved under a drawing image get this height, so the stack does not depend on the reader's default. */
const IMAGE_ROW_PT = 15
const CAPTION_ROW_PT = 18
/** Width used when the anchor sheet has no content to measure (a bare `{{DRAWING}}` sheet). */
const FALLBACK_WIDTH_PX = 1008
/** Printable height / width of one page, Letter and A4, with the built-in margins and some slack. */
const PAGE_RATIO = { landscape: 0.65, portrait: 1.25 }
/** Printable height / width of an A4 page (the shorter of Letter and A4) with the built-in margins, no slack. */
const FIRST_PAGE_RATIO = { landscape: 0.66, portrait: 1.4 }

export function columnPx(ws: Worksheet, col: number): number {
  const width = ws.getColumn(col).width
  return width ? Math.round(width * 7 + 5) : DEFAULT_COL_PX
}

export function rowPx(ws: Worksheet, row: number): number {
  const height = ws.getRow(row).height
  return height ? Math.round((height * 96) / 72) : DEFAULT_ROW_PX
}

function spanPx(ws: Worksheet, box: Box): { width: number; height: number } {
  let width = 0
  let height = 0
  for (let c = box.left; c <= box.right; c++) width += columnPx(ws, c)
  for (let r = box.top; r <= box.bottom; r++) height += rowPx(ws, r)
  return { width, height }
}

/** The merge whose master is `cell`, or the cell alone. */
function cellBox(ws: Worksheet, cell: string): Box {
  const { row, col } = decodeAddress(cell)
  return mergeRanges(ws).map(decodeRange).find((m) => m.top === row && m.left === col) ?? { top: row, left: col, bottom: row, right: col }
}

const EMU_PER_PX = 9525

/**
 * A top-left anchor `dx` / `dy` px into the sheet from the top-left of (col, row), both 1-based,
 * with the offset expressed inside the column and row it lands in (Excel wants it that way).
 */
function anchorAt(ws: Worksheet, col: number, row: number, dx: number, dy: number): { col: number; row: number } {
  let c = col
  let x = Math.max(0, Math.round(dx))
  while (x >= columnPx(ws, c)) x -= columnPx(ws, c++)
  let r = row
  let y = Math.max(0, Math.round(dy))
  while (y >= rowPx(ws, r)) y -= rowPx(ws, r++)
  const native = { nativeCol: c - 1, nativeColOff: x * EMU_PER_PX, nativeRow: r - 1, nativeRowOff: y * EMU_PER_PX }
  return native as unknown as { col: number; row: number }
}

export function fitInto(size: { width: number; height: number }, box: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(box.width / size.width, box.height / size.height)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** Pixel size of a PNG or JPEG, or null when the header cannot be read. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1]
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = u32(16)
    const height = u32(20)
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null
      const marker = bytes[o + 1]
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2
        continue
      }
      const length = u16(o + 2)
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = u16(o + 5)
        const width = u16(o + 7)
        return width > 0 && height > 0 ? { width, height } : null
      }
      o += 2 + length
    }
  }
  return null
}

/** Put the logo in each anchor cell's range, aspect kept, with a small inset. */
export function placeLogo(workbook: Workbook, anchors: readonly { sheet: string; cell: string }[], logo: ReportLogo | null | undefined): void {
  if (!logo || anchors.length === 0) return
  const natural = imageSize(logo.bytes)
  const imageId = workbook.addImage({ buffer: toArrayBuffer(logo.bytes), extension: logo.extension })
  for (const at of anchors) {
    const ws = workbook.getWorksheet(at.sheet)
    if (!ws) continue
    const box = cellBox(ws, at.cell)
    const room = spanPx(ws, box)
    const inset = { width: Math.max(1, room.width - 8), height: Math.max(1, room.height - 8) }
    const size = natural ? fitInto(natural, inset) : inset
    const dy = (room.height - size.height) / 2
    ws.addImage(imageId, { tl: anchorAt(ws, box.left, box.top, 4, dy), ext: size, editAs: 'oneCell' })
  }
}

/** Last row and column holding a value, a border or a fill, merges and images included. */
export function usedExtent(ws: Worksheet): { lastRow: number; lastCol: number } {
  let lastRow = 0
  let lastCol = 0
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const styled = cell.border && Object.values(cell.border).some((b) => b && typeof b === 'object' && 'style' in b && b.style)
      const filled = cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern !== 'none'
      if ((cell.value !== null && cell.value !== undefined && cell.value !== '') || styled || filled) {
        lastRow = Math.max(lastRow, r)
        lastCol = Math.max(lastCol, c)
      }
    })
  })
  for (const m of mergeRanges(ws).map(decodeRange)) {
    lastRow = Math.max(lastRow, m.bottom)
    lastCol = Math.max(lastCol, m.right)
  }
  for (const image of ws.getImages()) {
    const range = image.range as unknown as { tl: { nativeRow: number; nativeCol: number }; br?: { nativeRow: number; nativeCol: number } }
    lastRow = Math.max(lastRow, (range.br ?? range.tl).nativeRow + 1)
    lastCol = Math.max(lastCol, (range.br ?? range.tl).nativeCol + 1)
  }
  return { lastRow, lastCol }
}

/**
 * Whether rows 1..`lastRow` print on one page at fit-to-width scale: their height against the
 * printable height of a page as wide as columns 1..`lastCol`.
 */
export function fitsFirstPage(ws: Worksheet, lastRow: number, lastCol: number, orientation: 'landscape' | 'portrait'): boolean {
  let width = 0
  for (let c = 1; c <= lastCol; c++) width += columnPx(ws, c)
  let height = 0
  for (let r = 1; r <= lastRow; r++) height += rowPx(ws, r)
  return height <= width * FIRST_PAGE_RATIO[orientation]
}

/** Average Calibri glyph width as a share of the font size, and line height as a multiple of it. */
const CHAR_EM = 0.48
const LINE_EM = 1.28

/** Lines a paragraph takes when wrapped at word boundaries, `perLine` characters wide. */
export function wrappedLines(text: string, perLine: number): number {
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = used === 0 ? word.length : used + 1 + word.length
    if (need <= perLine) {
      used = need
      continue
    }
    // The word starts a new line; one longer than a line breaks across lines.
    if (used > 0) lines += 1
    lines += Math.floor(Math.max(0, word.length - 1) / perLine)
    used = word.length % perLine || perLine
  }
  return lines
}

/**
 * Grow row `r` so wrapped text in it is not clipped: for each wrapping cell, the lines its text
 * needs at the cell's (merged) width. Rows only grow; a template's own taller rows stay.
 */
export function fitRowHeight(ws: Worksheet, r: number): void {
  const merges = mergeRanges(ws).map(decodeRange)
  let needPt = 0
  ws.getRow(r).eachCell((cell, col) => {
    if (!cell.alignment?.wrapText || (cell.isMerged && cell.master !== cell)) return
    const value = cell.value
    const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
    if (text === '') return
    const box = merges.find((m) => m.top <= r && m.bottom >= r && m.left === col) ?? { top: r, bottom: r, left: col, right: col }
    let widthPx = 0
    for (let c = box.left; c <= box.right; c++) widthPx += columnPx(ws, c)
    const sizePt = cell.font?.size ?? 11
    const indentPx = (cell.alignment.indent ?? 0) * 9
    const charPx = ((sizePt * CHAR_EM * 96) / 72) * (cell.font?.bold ? 1.1 : 1)
    const perLine = Math.max(1, Math.floor((widthPx - 6 - indentPx) / charPx))
    const lines = text.split('\n').reduce((n, part) => n + wrappedLines(part, perLine), 0)
    needPt = Math.max(needPt, lines * sizePt * LINE_EM + 5)
  })
  const row = ws.getRow(r)
  if (needPt > (row.height ?? 15)) row.height = Math.ceil(needPt)
}

export interface DrawingPlacement {
  /** Where the pages go: the `{{DRAWING}}` cell, or null for under the table on `tableSheet`. */
  anchor: { sheet: string; cell: string } | null
  tableSheet: string
  pages: readonly DrawingPageImage[]
  /** Caption above page `index` (0-based) of `total`. */
  caption: (index: number, total: number) => string
}

/** The sheet rows the pages occupy (first caption row to last image row), or null when nothing was placed. */
export interface PlacedDrawing {
  sheet: string
  firstRow: number
  lastRow: number
  lastCol: number
}

/**
 * Stack the drawing pages: for each, a page break, a caption row across the table width, then the
 * image scaled to that width and capped so caption, image and repeated title rows fit one page.
 */
export function placeDrawingPages(workbook: Workbook, p: DrawingPlacement): PlacedDrawing | null {
  if (p.pages.length === 0) return null
  const ws = workbook.getWorksheet(p.anchor?.sheet ?? p.tableSheet) ?? workbook.getWorksheet(p.tableSheet)
  if (!ws) return null

  const extent = usedExtent(ws)
  let startRow: number
  let left = 1
  let right = Math.max(1, extent.lastCol)
  let merged = false
  if (p.anchor && ws.name === p.anchor.sheet) {
    const box = cellBox(ws, p.anchor.cell)
    left = box.left
    right = Math.max(box.left, extent.lastCol)
    // The anchor's merge sets the width; it is unmerged so captions and images can stack from its top.
    if (box.right > box.left || box.bottom > box.top) {
      ws.unMergeCells(encodeRange(box))
      left = box.left
      right = box.right
      merged = true
    }
    ws.getCell(box.top, box.left).value = null
    startRow = box.top
  } else {
    startRow = extent.lastRow + 2
  }

  let width = 0
  for (let c = left; c <= right; c++) width += columnPx(ws, c)
  // Nothing to measure (a sheet holding only a bare anchor cell): use a landscape page width.
  if (!merged && width < 600) width = FALLBACK_WIDTH_PX

  const orientation = ws.pageSetup.orientation === 'landscape' ? 'landscape' : 'portrait'
  // Repeated title rows exist for a table that runs onto a second page. When everything above the
  // drawing fits the first page they would only print over the drawing pages, so they go.
  if (ws.name === p.tableSheet && ws.pageSetup.printTitlesRow && fitsFirstPage(ws, startRow - 1, right, orientation)) {
    ws.pageSetup.printTitlesRow = undefined
  }
  const titles = ws.pageSetup.printTitlesRow
  let titlesPx = 0
  if (titles && ws.name === p.tableSheet) {
    const [a, b = a] = titles.replace(/\$/g, '').split(':').map(Number)
    for (let r = a; r <= b; r++) titlesPx += rowPx(ws, r)
  }
  const captionPx = Math.round((CAPTION_ROW_PT * 96) / 72)
  const imageRowPx = Math.round((IMAGE_ROW_PT * 96) / 72)
  const maxHeight = Math.max(200, Math.round(width * PAGE_RATIO[orientation]) - captionPx - titlesPx - imageRowPx)

  const total = p.pages.length
  let r = startRow
  p.pages.forEach((page, i) => {
    if (r > 1) ws.getRow(r - 1).addPageBreak()
    ws.mergeCells(r, left, r, right)
    const caption = ws.getCell(r, left)
    caption.value = p.caption(i, total)
    caption.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1F3864' } }
    caption.alignment = { vertical: 'middle', horizontal: 'left' }
    // A merged range draws each cell's own border: rule the whole width.
    for (let c = left; c <= right; c++) ws.getCell(r, c).border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    ws.getRow(r).height = CAPTION_ROW_PT

    const size = fitInto({ width: page.widthPx, height: page.heightPx }, { width, height: maxHeight })
    const imageId = workbook.addImage({ buffer: toArrayBuffer(page.png), extension: 'png' })
    const offset = Math.max(0, (width - size.width) / 2)
    ws.addImage(imageId, { tl: anchorAt(ws, left, r + 1, offset, 0), ext: size, editAs: 'oneCell' })
    const rows = Math.ceil(size.height / imageRowPx) + 1
    for (let k = 1; k <= rows; k++) ws.getRow(r + k).height = IMAGE_ROW_PT
    r += rows + 1
  })
  const lastRow = r - 1

  if (ws.pageSetup.fitToPage && ws.pageSetup.fitToHeight === 1 && total > 1) ws.pageSetup.fitToHeight = 0
  const printArea = ws.pageSetup.printArea
  if (printArea && !printArea.includes('&&') && /^\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+$/i.test(printArea)) {
    const box = decodeRange(printArea.replace(/\$/g, ''))
    ws.pageSetup.printArea = encodeRange({ ...box, bottom: Math.max(box.bottom, lastRow), right: Math.max(box.right, right) })
  }
  return { sheet: ws.name, firstRow: startRow, lastRow, lastCol: right }
}
