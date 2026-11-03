/**
 * One worksheet as a positioned grid the workbook preview draws: column and row geometry, a box
 * per non-empty or styled cell (merges spanning their range), border segments on the grid lines
 * (shared edges drawn once, the heavier style winning), gridlines when the sheet shows them, and
 * the images anchored on the sheet. Pure apart from reading the exceljs worksheet it is given.
 *
 * Geometry follows the report engine (src/lib/inspection/excel/place.ts): px at 96 dpi, a column
 * of w characters is `w * 7 + 5` px, a row of h points `h * 96 / 72` px.
 */
import type {
  Alignment,
  Border,
  Borders,
  Cell,
  CellValue,
  Color,
  Fill,
  Font,
  Worksheet,
} from 'exceljs'

import { columnPx, rowPx, usedExtent } from '@/lib/inspection/excel/place'
import { decodeRange, mergeRanges, type Box } from '@/lib/inspection/excel/workbook'

/** Largest sheet drawn; a bigger one is cut and says so. */
export const MAX_GRID_ROWS = 600
export const MAX_GRID_COLS = 80

const EMU_PER_PX = 9525
const PT_TO_PX = 96 / 72
const DEFAULT_FONT_PT = 11
const INDENT_PX = 9

export interface GridTextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  /** px */
  size?: number
  family?: string
}

export interface GridCell {
  row: number
  col: number
  /** Box of the cell (or its merge), px from the sheet's top-left. */
  left: number
  top: number
  width: number
  height: number
  /** Width the text may use: wider than the cell when unwrapped text overflows into empty cells. */
  textWidth: number
  background: string | null
  text: string
  /** Rich text runs; null when the whole cell has one font. */
  runs: GridTextRun[] | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string
  /** px */
  fontSize: number
  fontFamily: string
  horizontal: 'left' | 'center' | 'right' | 'justify'
  vertical: 'top' | 'middle' | 'bottom'
  wrap: boolean
  /** px */
  indent: number
  /** 90 (up), -90 (down) or 0. */
  rotation: number
}

export interface GridEdge {
  /** 'h': a horizontal segment at y = top; 'v': a vertical one at x = left. */
  orientation: 'h' | 'v'
  left: number
  top: number
  /** Length along the line, px. */
  length: number
  /** px */
  thickness: number
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'double'
  color: string
}

export interface GridImage {
  imageId: string
  left: number
  top: number
  width: number
  height: number
}

export interface SheetGrid {
  name: string
  /** px of each drawn column / row (hidden ones are 0). */
  colWidths: number[]
  rowHeights: number[]
  width: number
  height: number
  cells: GridCell[]
  edges: GridEdge[]
  /** Gridlines (thin, light), only when the sheet shows them. */
  gridlines: GridEdge[]
  images: GridImage[]
  /** The sheet is larger than the drawn grid. */
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** The Office theme (lt1, dk1, lt2, dk2, accent 1-6), as Excel resolves theme indexes. */
const THEME_COLORS = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']

/** Excel's legacy indexed palette (0-63); 64 is the system foreground, 65 the background. */
const INDEXED_COLORS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
  '000000', 'FFFFFF',
]

type AnyColor = Partial<Color> & { indexed?: number; tint?: number }

function applyTint(hex: string, tint: number | undefined): string {
  if (!tint) return hex
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const tinted = channels.map((c) => Math.round(tint < 0 ? c * (1 + tint) : c + (255 - c) * tint))
  return tinted.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')
}

/** `#rrggbb` of an exceljs color, or null when it names none. */
export function cssColor(color: AnyColor | undefined): string | null {
  if (!color) return null
  let hex: string | undefined
  if (typeof color.argb === 'string' && /^[0-9a-f]{6,8}$/i.test(color.argb)) hex = color.argb.slice(-6)
  else if (typeof color.theme === 'number') hex = THEME_COLORS[color.theme]
  else if (typeof color.indexed === 'number') hex = INDEXED_COLORS[color.indexed]
  if (!hex) return null
  return `#${applyTint(hex, color.tint).toLowerCase()}`
}

function fillColor(fill: Fill | undefined): string | null {
  if (!fill) return null
  if (fill.type === 'pattern') {
    if (fill.pattern === 'none') return null
    // A solid fill is its foreground; a hatch is drawn as its foreground too (close enough to read).
    return cssColor(fill.fgColor as AnyColor) ?? (fill.pattern === 'solid' ? null : cssColor(fill.bgColor as AnyColor))
  }
  return cssColor(fill.stops[0]?.color as AnyColor)
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const DATE_TOKEN = /yyyy|yy|mmmm|mmm|mm|m|dd|d|hh|h|ss|s|AM\/PM/gi
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** A date in a number format's own pattern (the common tokens); ISO date when it has none. */
export function formatDate(date: Date, numFmt: string | undefined): string {
  // exceljs reads a serial date as UTC midnight of that day, so the parts are read in UTC.
  const pattern = (numFmt ?? '').replace(/\[[^\]]*\]|"[^"]*"|\\./g, '')
  if (!/[ymdhs]/i.test(pattern)) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const hasTime = /h/i.test(pattern)
  const ampm = /AM\/PM/i.test(pattern)
  let afterHour = false
  return (numFmt ?? '').replace(/"([^"]*)"|\\(.)|\[[^\]]*\]/g, '$1$2').replace(DATE_TOKEN, (token) => {
    const lower = token.toLowerCase()
    const hours = date.getUTCHours()
    switch (lower) {
      case 'yyyy':
        return String(date.getUTCFullYear())
      case 'yy':
        return pad(date.getUTCFullYear() % 100)
      case 'mmmm':
        return MONTHS_LONG[date.getUTCMonth()]
      case 'mmm':
        return MONTHS[date.getUTCMonth()]
      case 'mm':
      case 'm': {
        // After an hour token, m means minutes.
        const minutes = afterHour && hasTime
        afterHour = false
        const value = minutes ? date.getUTCMinutes() : date.getUTCMonth() + 1
        return lower === 'mm' ? pad(value) : String(value)
      }
      case 'dd':
        return pad(date.getUTCDate())
      case 'd':
        return String(date.getUTCDate())
      case 'hh':
      case 'h': {
        afterHour = true
        const h = ampm ? hours % 12 || 12 : hours
        return lower === 'hh' ? pad(h) : String(h)
      }
      case 'ss':
      case 's':
        return lower === 'ss' ? pad(date.getUTCSeconds()) : String(date.getUTCSeconds())
      case 'am/pm':
        return hours < 12 ? 'AM' : 'PM'
      default:
        return token
    }
  })
}

/** A number in its format's decimals, grouping and percent (the shapes report templates use). */
export function formatNumber(value: number, numFmt: string | undefined): string {
  const fmt = (numFmt ?? 'General').split(';')[0].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  if (!numFmt || /^general$/i.test(fmt.trim()) || fmt.trim() === '@') {
    if (Number.isInteger(value)) return String(value)
    // Excel's General shows about 10 significant digits.
    return String(Number(value.toPrecision(10)))
  }
  const percent = fmt.includes('%')
  const n = percent ? value * 100 : value
  const decimalsMatch = /\.([0#?]+)/.exec(fmt)
  const decimals = decimalsMatch ? decimalsMatch[1].length : 0
  const grouped = /[#0],[#0]/.test(fmt)
  const text = grouped
    ? n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : n.toFixed(decimals)
  return percent ? `${text}%` : text
}

function valueTextOf(value: CellValue | undefined, numFmt: string | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return formatNumber(value, numFmt)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return formatDate(value, numFmt)
  if ('richText' in value) return value.richText.map((r) => r.text).join('')
  if ('formula' in value || 'sharedFormula' in value) {
    const result = (value as { result?: CellValue }).result
    if (result !== null && typeof result === 'object' && 'error' in result) return String(result.error)
    return valueTextOf(result, numFmt)
  }
  if ('hyperlink' in value) return typeof value.text === 'string' ? value.text : valueTextOf(value.text as CellValue, numFmt)
  if ('error' in value) return String(value.error)
  return ''
}

/** The value a formula shows, for the default alignment. */
function shownValue(value: CellValue | undefined): CellValue | undefined {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && ('formula' in value || 'sharedFormula' in value)) {
    return (value as { result?: CellValue }).result
  }
  return value
}

// ---------------------------------------------------------------------------
// Fonts and alignment
// ---------------------------------------------------------------------------

/** A CSS font stack for an Office font, with metric-compatible fallbacks. */
export function fontStack(name: string | undefined): string {
  const n = (name ?? 'Calibri').trim()
  const fallbacks: Record<string, string> = {
    calibri: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
    arial: 'Arial, "Liberation Sans", Helvetica, sans-serif',
    'arial narrow': '"Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif',
    cambria: 'Cambria, Caladea, Georgia, serif',
    'times new roman': '"Times New Roman", "Liberation Serif", Times, serif',
    'courier new': '"Courier New", "Liberation Mono", monospace',
    consolas: 'Consolas, "Courier New", monospace',
    'segoe ui': '"Segoe UI", Arial, sans-serif',
  }
  return fallbacks[n.toLowerCase()] ?? `"${n.replace(/"/g, '')}", Calibri, Arial, sans-serif`
}

function runOf(text: string, font: Partial<Font> | undefined, base: GridCell): GridTextRun {
  return {
    text,
    bold: font?.bold ?? base.bold,
    italic: font?.italic ?? base.italic,
    underline: font?.underline !== undefined ? font.underline !== false && font.underline !== 'none' : base.underline,
    strike: font?.strike ?? base.strike,
    color: cssColor(font?.color as AnyColor) ?? base.color,
    size: font?.size ? font.size * PT_TO_PX : base.fontSize,
    family: font?.name ? fontStack(font.name) : base.fontFamily,
  }
}

function horizontalOf(alignment: Partial<Alignment> | undefined, value: CellValue | undefined): GridCell['horizontal'] {
  switch (alignment?.horizontal) {
    case 'center':
    case 'centerContinuous':
    case 'distributed':
      return 'center'
    case 'right':
      return 'right'
    case 'left':
    case 'fill':
      return 'left'
    case 'justify':
      return 'justify'
  }
  const shown = shownValue(value)
  if (typeof shown === 'number' || shown instanceof Date) return 'right'
  if (typeof shown === 'boolean') return 'center'
  return 'left'
}

function verticalOf(alignment: Partial<Alignment> | undefined): GridCell['vertical'] {
  if (alignment?.vertical === 'top') return 'top'
  if (alignment?.vertical === 'middle' || alignment?.vertical === 'distributed' || alignment?.vertical === 'justify') {
    return 'middle'
  }
  return 'bottom'
}

function rotationOf(alignment: Partial<Alignment> | undefined): number {
  const r = alignment?.textRotation
  if (r === 'vertical' || r === 255) return 90
  if (typeof r !== 'number' || r === 0) return 0
  // Excel: 1-90 counter-clockwise, 91-180 clockwise (91 = -1).
  const degrees = r > 90 ? 90 - r : r
  return Math.abs(degrees) >= 45 ? Math.sign(degrees) * 90 : 0
}

// ---------------------------------------------------------------------------
// Borders
// ---------------------------------------------------------------------------

const BORDER_WEIGHT: Record<string, number> = {
  hair: 1,
  dotted: 2,
  dashDotDot: 3,
  dashDot: 4,
  dashed: 5,
  thin: 6,
  mediumDashDotDot: 7,
  slantDashDot: 8,
  mediumDashDot: 9,
  mediumDashed: 10,
  medium: 11,
  double: 12,
  thick: 13,
}

function edgeLook(border: Partial<Border> | undefined): Omit<GridEdge, 'orientation' | 'left' | 'top' | 'length'> & { weight: number } | null {
  const style = border?.style
  if (!style) return null
  const color = cssColor(border.color as AnyColor) ?? '#000000'
  const weight = BORDER_WEIGHT[style] ?? 6
  if (style === 'thick') return { thickness: 3, lineStyle: 'solid', color, weight }
  if (style === 'double') return { thickness: 3, lineStyle: 'double', color, weight }
  if (style.startsWith('medium') || style === 'slantDashDot') {
    return { thickness: 2, lineStyle: style === 'medium' ? 'solid' : 'dashed', color, weight }
  }
  if (style === 'dotted') return { thickness: 1, lineStyle: 'dotted', color, weight }
  if (style === 'dashed' || style === 'dashDot' || style === 'dashDotDot') return { thickness: 1, lineStyle: 'dashed', color, weight }
  // hair: a lighter thin line.
  return { thickness: 1, lineStyle: style === 'hair' ? 'dotted' : 'solid', color, weight }
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/** Whether a sheet is listed: hidden and very hidden sheets (`_blueplm`) are not. */
export function isVisibleSheet(ws: Pick<Worksheet, 'state'>): boolean {
  return ws.state !== 'hidden' && ws.state !== 'veryHidden'
}

interface AnchorLike {
  nativeCol?: number
  nativeColOff?: number
  nativeRow?: number
  nativeRowOff?: number
  col?: number
  row?: number
}

function prefix(sizes: number[]): number[] {
  const out = [0]
  for (const s of sizes) out.push(out[out.length - 1] + s)
  return out
}

export function sheetToGrid(ws: Worksheet): SheetGrid {
  const extent = usedExtent(ws)
  const lastRow = Math.min(Math.max(extent.lastRow, 1), MAX_GRID_ROWS)
  const lastCol = Math.min(Math.max(extent.lastCol, 1), MAX_GRID_COLS)
  const truncated = extent.lastRow > MAX_GRID_ROWS || extent.lastCol > MAX_GRID_COLS

  const colWidths: number[] = []
  for (let c = 1; c <= lastCol; c++) colWidths.push(ws.getColumn(c).hidden ? 0 : columnPx(ws, c))
  const rowHeights: number[] = []
  for (let r = 1; r <= lastRow; r++) rowHeights.push(ws.getRow(r).hidden ? 0 : rowPx(ws, r))
  const xs = prefix(colWidths)
  const ys = prefix(rowHeights)
  const width = xs[xs.length - 1]
  const height = ys[ys.length - 1]

  // Merges clipped to the drawn grid; every covered cell points at its merge.
  const merges: Box[] = mergeRanges(ws)
    .map(decodeRange)
    .filter((m) => m.top <= lastRow && m.left <= lastCol)
    .map((m) => ({ ...m, bottom: Math.min(m.bottom, lastRow), right: Math.min(m.right, lastCol) }))
  const mergeAt = new Map<string, Box>()
  for (const m of merges) {
    for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) mergeAt.set(`${r}:${c}`, m)
  }
  const boxOf = (r: number, c: number): Box => mergeAt.get(`${r}:${c}`) ?? { top: r, left: c, bottom: r, right: c }

  const cells: GridCell[] = []
  const edgeMap = new Map<string, GridEdge & { weight: number }>()
  const hasText = new Set<string>()

  const putEdge = (key: string, edge: GridEdge & { weight: number }) => {
    const current = edgeMap.get(key)
    if (!current || edge.weight >= current.weight) edgeMap.set(key, edge)
  }

  for (let r = 1; r <= lastRow; r++) {
    if (rowHeights[r - 1] === 0) continue
    const row = ws.getRow(r)
    for (let c = 1; c <= lastCol; c++) {
      if (colWidths[c - 1] === 0) continue
      const cell: Cell = row.getCell(c)
      const box = boxOf(r, c)
      const border: Partial<Borders> | undefined = cell.border
      // Border sides on the perimeter of the cell's box (a merge's inside edges are not drawn).
      if (border) {
        const sides: Array<[keyof Borders, boolean, string, () => GridEdge]> = [
          ['top', r === box.top, `h:${r}:${c}`, () => ({ orientation: 'h', left: xs[c - 1], top: ys[r - 1], length: colWidths[c - 1], thickness: 1, lineStyle: 'solid', color: '' })],
          ['bottom', r === box.bottom, `h:${r + 1}:${c}`, () => ({ orientation: 'h', left: xs[c - 1], top: ys[r], length: colWidths[c - 1], thickness: 1, lineStyle: 'solid', color: '' })],
          ['left', c === box.left, `v:${c}:${r}`, () => ({ orientation: 'v', left: xs[c - 1], top: ys[r - 1], length: rowHeights[r - 1], thickness: 1, lineStyle: 'solid', color: '' })],
          ['right', c === box.right, `v:${c + 1}:${r}`, () => ({ orientation: 'v', left: xs[c], top: ys[r - 1], length: rowHeights[r - 1], thickness: 1, lineStyle: 'solid', color: '' })],
        ]
        for (const [side, onPerimeter, key, geometry] of sides) {
          if (!onPerimeter || side === 'diagonal') continue
          const look = edgeLook(border[side] as Partial<Border> | undefined)
          if (look) putEdge(key, { ...geometry(), ...look })
        }
      }

      // One box per merge (at its master) or per single cell.
      if (box.top !== r || box.left !== c) continue
      const value = cell.value
      const fill = fillColor(cell.fill)
      const text = valueTextOf(value, cell.numFmt)
      if (!fill && text === '') continue

      const font = cell.font
      const alignment = cell.alignment
      const left = xs[box.left - 1]
      const top = ys[box.top - 1]
      const boxWidth = xs[box.right] - left
      const boxHeight = ys[box.bottom] - top
      const grid: GridCell = {
        row: r,
        col: c,
        left,
        top,
        width: boxWidth,
        height: boxHeight,
        textWidth: boxWidth,
        background: fill,
        text,
        runs: null,
        bold: !!font?.bold,
        italic: !!font?.italic,
        underline: !!font?.underline && font.underline !== 'none',
        strike: !!font?.strike,
        color: cssColor(font?.color as AnyColor) ?? '#000000',
        fontSize: (font?.size ?? DEFAULT_FONT_PT) * PT_TO_PX,
        fontFamily: fontStack(font?.name),
        horizontal: horizontalOf(alignment, value),
        vertical: verticalOf(alignment),
        wrap: !!alignment?.wrapText,
        indent: (alignment?.indent ?? 0) * INDENT_PX,
        rotation: rotationOf(alignment),
      }
      if (value && typeof value === 'object' && 'richText' in value) {
        grid.runs = value.richText.map((run) => runOf(run.text, run.font, grid))
      }
      if (text !== '') hasText.add(`${r}:${c}`)
      cells.push(grid)
    }
  }

  // Unwrapped, left-aligned text in a single cell runs on over the empty cells to its right.
  for (const cell of cells) {
    if (cell.text === '' || cell.wrap || cell.rotation !== 0 || cell.horizontal !== 'left') continue
    if (mergeAt.has(`${cell.row}:${cell.col}`)) continue
    let c = cell.col + 1
    let extra = 0
    while (c <= lastCol && !hasText.has(`${cell.row}:${c}`) && !mergeAt.has(`${cell.row}:${c}`)) {
      extra += colWidths[c - 1]
      c++
    }
    cell.textWidth = cell.width + extra
  }

  // Border segments, joined along each line where they look the same.
  const edges = joinEdges([...edgeMap.values()].map(({ weight: _weight, ...edge }) => edge))

  const showGridLines = (ws.views?.[0] as { showGridLines?: boolean } | undefined)?.showGridLines !== false
  const gridlines: GridEdge[] = []
  if (showGridLines) {
    const line = { thickness: 1, lineStyle: 'solid' as const, color: '#e1e1e1' }
    for (let i = 0; i < ys.length; i++) gridlines.push({ orientation: 'h', left: 0, top: ys[i], length: width, ...line })
    for (let i = 0; i < xs.length; i++) gridlines.push({ orientation: 'v', left: xs[i], top: 0, length: height, ...line })
  }

  const images: GridImage[] = []
  for (const image of ws.getImages()) {
    const range = image.range as unknown as { tl: AnchorLike; br?: AnchorLike; ext?: { width: number; height: number } }
    const at = (a: AnchorLike) => {
      const col = a.nativeCol ?? Math.floor(a.col ?? 0)
      const row = a.nativeRow ?? Math.floor(a.row ?? 0)
      const colOff = a.nativeColOff !== undefined ? a.nativeColOff / EMU_PER_PX : ((a.col ?? 0) % 1) * (colWidths[col] ?? 64)
      const rowOff = a.nativeRowOff !== undefined ? a.nativeRowOff / EMU_PER_PX : ((a.row ?? 0) % 1) * (rowHeights[row] ?? 20)
      const x = (xs[Math.min(col, xs.length - 1)] ?? width) + colOff
      const y = (ys[Math.min(row, ys.length - 1)] ?? height) + rowOff
      return { x, y }
    }
    const tl = at(range.tl)
    let w: number
    let h: number
    if (range.ext && range.ext.width > 0) {
      w = range.ext.width
      h = range.ext.height
    } else if (range.br) {
      const br = at(range.br)
      w = br.x - tl.x
      h = br.y - tl.y
    } else continue
    if (tl.x >= width || tl.y >= height || w <= 0 || h <= 0) continue
    images.push({ imageId: String(image.imageId), left: tl.x, top: tl.y, width: w, height: h })
  }

  return { name: ws.name, colWidths, rowHeights, width, height, cells, edges, gridlines, images, truncated }
}

/** Join touching segments on one line that look alike (fewer elements to draw). */
export function joinEdges(edges: GridEdge[]): GridEdge[] {
  const sorted = [...edges].sort((a, b) =>
    a.orientation !== b.orientation
      ? a.orientation < b.orientation ? -1 : 1
      : a.orientation === 'h'
        ? a.top - b.top || a.left - b.left
        : a.left - b.left || a.top - b.top,
  )
  const out: GridEdge[] = []
  for (const edge of sorted) {
    const last = out[out.length - 1]
    const same =
      last &&
      last.orientation === edge.orientation &&
      last.thickness === edge.thickness &&
      last.lineStyle === edge.lineStyle &&
      last.color === edge.color
    if (same && edge.orientation === 'h' && last.top === edge.top && last.left + last.length === edge.left) {
      last.length += edge.length
    } else if (same && edge.orientation === 'v' && last.left === edge.left && last.top + last.length === edge.top) {
      last.length += edge.length
    } else {
      out.push({ ...edge })
    }
  }
  return out
}
