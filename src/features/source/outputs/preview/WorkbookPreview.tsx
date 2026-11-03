import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'

import { readWorkbook } from '@/lib/inspection/excel/workbook'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'

import { zipUncompressedSize } from './zipGuard'
import { MAX_GRID_COLS, MAX_GRID_ROWS, isVisibleSheet, sheetToGrid, type GridCell, type GridEdge, type SheetGrid } from './sheetGrid'

type WorkbookState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sheets: SheetGrid[]; images: Map<string, string> }

const MIN_ZOOM = 0.2
const MAX_ZOOM = 3
const ZOOM_STEP = 1.25

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Image types a workbook may embed that the preview shows; anything else is skipped. */
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif' }

function imageBlob(image: { buffer?: ArrayBufferLike | Uint8Array; base64?: string; extension: string }): Blob | null {
  // The extension comes from the workbook (a supplier's file): only known image types become a blob.
  const type = IMAGE_TYPES[String(image.extension).toLowerCase()]
  if (!type) return null
  if (image.buffer) {
    const view = image.buffer instanceof Uint8Array ? image.buffer : new Uint8Array(image.buffer)
    const copy = new Uint8Array(view.byteLength)
    copy.set(view)
    return new Blob([copy], { type })
  }
  if (image.base64) {
    const data = image.base64.replace(/^data:[^,]*,/, '')
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type })
  }
  return null
}

/**
 * A read-only render of an .xlsx: its visible sheets as tabs, each drawn from `sheetToGrid` with
 * values, merges, fills, borders, column widths and the embedded images (logo, drawing pages),
 * on white paper as Excel shows it. DOM is built by React only (the web build's Trusted Types
 * policy forbids HTML strings). Image object URLs are revoked when the preview goes away.
 */
export function WorkbookPreview({ bytes }: { bytes: Uint8Array }) {
  const [state, setState] = useState<WorkbookState>({ status: 'loading' })
  const [sheetIndex, setSheetIndex] = useState(0)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [fitZoom, setFitZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    setState({ status: 'loading' })
    setSheetIndex(0)
    // Never inflate an archive past the cap (ChildPreview shows the too-large state first; this is
    // the backstop for any other caller).
    const size = zipUncompressedSize(bytes)
    const read = size.ok ? readWorkbook(bytes) : Promise.reject(new Error(`The workbook cannot be previewed (${size.reason})`))
    read
      .then((workbook) => {
        if (cancelled) return
        const sheets = workbook.worksheets.filter(isVisibleSheet).map(sheetToGrid)
        const images = new Map<string, string>()
        for (const sheet of sheets) {
          for (const image of sheet.images) {
            if (images.has(image.imageId)) continue
            try {
              const blob = imageBlob(workbook.getImage(Number(image.imageId)) as Parameters<typeof imageBlob>[0])
              if (!blob) continue
              const url = URL.createObjectURL(blob)
              urls.push(url)
              images.set(image.imageId, url)
            } catch (err) {
              log.warn('[OutputPreview]', 'A workbook image could not be read', { error: errorText(err) })
            }
          }
        }
        setState({ status: 'ready', sheets, images })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        log.warn('[OutputPreview]', 'Workbook preview failed', { error: errorText(err) })
        setState({ status: 'error', message: errorText(err) })
      })
    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [bytes])

  const sheet = state.status === 'ready' ? state.sheets[Math.min(sheetIndex, state.sheets.length - 1)] : undefined

  // Fit to width, kept on resize.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !sheet) return
    const measure = () => {
      const available = el.clientWidth - 32
      if (available > 0 && sheet.width > 0) setFitZoom(Math.max(MIN_ZOOM, Math.min(1.25, available / sheet.width)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sheet])

  if (state.status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-plm-fg-muted">
        <Loader2 size={18} className="animate-spin" />
        {t('source.outputs.previewReadingWorkbook')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-plm-error">
        {t('source.outputs.previewFailed', { error: state.message })}
      </div>
    )
  }
  if (!sheet) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-plm-fg-muted">
        {t('source.outputs.previewNoSheets')}
      </div>
    )
  }

  const scale = zoom === 'fit' ? fitZoom : zoom
  const setScale = (next: number) => setZoom(Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)) * 100) / 100)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="workbook-preview-scroll min-h-0 flex-1 overflow-auto bg-plm-bg-light p-4">
        <div className="mx-auto overflow-hidden shadow-md" style={{ width: sheet.width * scale, height: sheet.height * scale }}>
          <SheetCanvas sheet={sheet} images={state.images} scale={scale} />
        </div>
        {sheet.truncated && (
          <p className="mt-2 text-center text-xs text-plm-fg-muted">
            {t('source.outputs.previewSheetTruncated', { rows: MAX_GRID_ROWS, cols: MAX_GRID_COLS })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-plm-border bg-plm-panel px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist">
          {state.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              role="tab"
              aria-selected={s === sheet}
              onClick={() => setSheetIndex(i)}
              className={`shrink-0 rounded px-2.5 py-1 text-xs transition-colors ${
                s === sheet
                  ? 'bg-plm-accent/20 font-medium text-plm-accent'
                  : 'text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="mx-1 h-4 w-px bg-plm-border" />
        <button
          className="rounded p-1 text-plm-fg-muted transition-colors hover:bg-plm-bg-light hover:text-plm-fg disabled:opacity-30"
          title={t('source.outputs.previewZoomOut')}
          aria-label={t('source.outputs.previewZoomOut')}
          disabled={scale <= MIN_ZOOM}
          onClick={() => setScale(scale / ZOOM_STEP)}
        >
          <ZoomOut size={15} />
        </button>
        <span className="w-10 select-none text-center text-xs tabular-nums text-plm-fg-muted">
          {Math.round(scale * 100)}%
        </span>
        <button
          className="rounded p-1 text-plm-fg-muted transition-colors hover:bg-plm-bg-light hover:text-plm-fg disabled:opacity-30"
          title={t('source.outputs.previewZoomIn')}
          aria-label={t('source.outputs.previewZoomIn')}
          disabled={scale >= MAX_ZOOM}
          onClick={() => setScale(scale * ZOOM_STEP)}
        >
          <ZoomIn size={15} />
        </button>
        <button
          className={`rounded p-1 transition-colors ${
            zoom === 'fit' ? 'bg-plm-accent/20 text-plm-accent' : 'text-plm-fg-muted hover:bg-plm-bg-light hover:text-plm-fg'
          }`}
          title={t('source.outputs.previewFitWidth')}
          aria-label={t('source.outputs.previewFitWidth')}
          aria-pressed={zoom === 'fit'}
          onClick={() => setZoom('fit')}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  )
}

function edgeStyle(edge: GridEdge): CSSProperties {
  const half = Math.floor(edge.thickness / 2)
  const line = `${edge.thickness}px ${edge.lineStyle} ${edge.color}`
  return edge.orientation === 'h'
    ? { left: edge.left, top: edge.top - half, width: edge.length, height: 0, borderTop: line }
    : { left: edge.left - half, top: edge.top, width: 0, height: edge.length, borderLeft: line }
}

function textDecoration(underline: boolean | undefined, strike: boolean | undefined): string | undefined {
  const parts = [underline ? 'underline' : '', strike ? 'line-through' : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

const ALIGN_ITEMS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'flex-start' } as const

function CellText({ cell }: { cell: GridCell }) {
  const overflow = cell.textWidth > cell.width
  return (
    <div
      className="absolute flex"
      style={{
        left: cell.left,
        top: cell.top,
        width: cell.textWidth,
        height: cell.height,
        alignItems: ALIGN_ITEMS[cell.vertical],
        justifyContent: JUSTIFY[cell.horizontal],
        padding: `0 3px 1px ${3 + cell.indent}px`,
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          color: cell.color,
          fontFamily: cell.fontFamily,
          fontSize: cell.fontSize,
          fontWeight: cell.bold ? 700 : 400,
          fontStyle: cell.italic ? 'italic' : undefined,
          textDecoration: textDecoration(cell.underline, cell.strike),
          textAlign: cell.horizontal,
          whiteSpace: cell.wrap ? 'pre-wrap' : 'pre',
          overflowWrap: cell.wrap ? 'anywhere' : undefined,
          lineHeight: 1.2,
          maxWidth: overflow ? undefined : '100%',
          overflow: cell.wrap || overflow ? undefined : 'hidden',
          textOverflow: 'clip',
          writingMode: cell.rotation !== 0 ? 'vertical-rl' : undefined,
          transform: cell.rotation === 90 ? 'rotate(180deg)' : undefined,
        }}
      >
        {cell.runs
          ? cell.runs.map((run, i) => (
              <span
                key={i}
                style={{
                  color: run.color,
                  fontFamily: run.family,
                  fontSize: run.size,
                  fontWeight: run.bold ? 700 : 400,
                  fontStyle: run.italic ? 'italic' : undefined,
                  textDecoration: textDecoration(run.underline, run.strike),
                }}
              >
                {run.text}
              </span>
            ))
          : cell.text}
      </span>
    </div>
  )
}

/** One sheet at 1:1 px, scaled as a whole. Layers: gridlines, fills, borders, text, images. */
const SheetCanvas = memo(function SheetCanvas({
  sheet,
  images,
  scale,
}: {
  sheet: SheetGrid
  images: ReadonlyMap<string, string>
  scale: number
}) {
  return (
    <div
      className="workbook-sheet relative overflow-hidden bg-white"
      style={{ width: sheet.width, height: sheet.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}
      aria-label={sheet.name}
    >
      {sheet.gridlines.map((edge, i) => (
        <div key={`g${i}`} className="absolute" style={edgeStyle(edge)} />
      ))}
      {sheet.cells.map((cell) =>
        cell.background ? (
          <div
            key={`f${cell.row}:${cell.col}`}
            className="absolute"
            style={{ left: cell.left, top: cell.top, width: cell.width, height: cell.height, background: cell.background }}
          />
        ) : null,
      )}
      {sheet.edges.map((edge, i) => (
        <div key={`e${i}`} className="absolute" style={edgeStyle(edge)} />
      ))}
      {sheet.cells.map((cell) => (cell.text ? <CellText key={`t${cell.row}:${cell.col}`} cell={cell} /> : null))}
      {sheet.images.map((image, i) => {
        const url = images.get(image.imageId)
        return url ? (
          <img
            key={`i${i}`}
            src={url}
            alt=""
            draggable={false}
            className="absolute select-none"
            style={{ left: image.left, top: image.top, width: image.width, height: image.height }}
          />
        ) : null
      })}
    </div>
  )
})
