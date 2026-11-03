/**
 * Drawing PDF → one PNG per page, for embedding in an inspection report. Renderer only (needs a
 * DOM canvas); pdfjs-dist and its worker are loaded on first use, the same way the review PDF
 * viewer sets them up (worker shipped as a Vite asset, never fetched from a CDN).
 */
import { lazyLoader } from './lazy'
import type { DrawingPageImage } from './place'

/** pdf.js with its worker configured; a failed import is retried on the next call. */
const loadPdfjs = lazyLoader(async () => {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  return pdfjs
})

/** Longest side and area caps keep a large sheet within canvas limits. */
const MAX_SIDE_PX = 8000
const MAX_AREA_PX = 40_000_000
/**
 * A report prints a drawing page about 10 in wide (landscape, one page wide). 3300 px across it
 * is about 300 ppi on paper, enough for balloon numbers and tolerance text; more only grows the file.
 */
const TARGET_LONG_SIDE_PX = 3300
/** Small sheets are still rendered at least this fine. */
const MIN_DPI = 200

/**
 * pdf.js scale (px per PDF point) for a page of `widthPt` x `heightPt`. With `dpi` the page is
 * rendered at that resolution; without, its long side gets `TARGET_LONG_SIDE_PX` (never below
 * `MIN_DPI`). Either way the canvas caps apply.
 */
export function rasterScale(widthPt: number, heightPt: number, dpi?: number): number {
  const longSide = Math.max(widthPt, heightPt, 1)
  let scale = dpi !== undefined ? dpi / 72 : Math.max(TARGET_LONG_SIDE_PX / longSide, MIN_DPI / 72)
  if (longSide * scale > MAX_SIDE_PX) scale = MAX_SIDE_PX / longSide
  const area = widthPt * heightPt * scale * scale
  if (area > MAX_AREA_PX) scale *= Math.sqrt(MAX_AREA_PX / area)
  return scale
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Canvas could not be encoded as PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Render every page of a PDF, legible when printed in a report (`rasterScale`). */
export async function rasterizePdf(pdfBytes: Uint8Array, dpi?: number): Promise<DrawingPageImage[]> {
  const pdfjs = await loadPdfjs()
  // pdf.js keeps the buffer; hand it a copy so the caller's bytes stay usable.
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false })
  const doc = await task.promise
  const pages: DrawingPageImage[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = rasterScale(base.width, base.height, dpi)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2D canvas unavailable')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      pages.push({ png: await canvasToPng(canvas), widthPx: canvas.width, heightPx: canvas.height })
      page.cleanup()
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await doc.destroy()
  }
  return pages
}
