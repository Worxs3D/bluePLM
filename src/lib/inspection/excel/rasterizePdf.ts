/**
 * Drawing PDF → one PNG per page, for embedding in an inspection report. Renderer only (needs a
 * DOM canvas); pdfjs-dist and its worker are loaded on first use, the same way the review PDF
 * viewer sets them up (worker shipped as a Vite asset, never fetched from a CDN).
 */
import type { DrawingPageImage } from './generate'
import { lazyLoader } from './lazy'

/** pdf.js with its worker configured; a failed import is retried on the next call. */
const loadPdfjs = lazyLoader(async () => {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  return pdfjs
})

/** Longest side and area caps keep a large sheet (A0 at 200 dpi) within canvas limits. */
const MAX_SIDE_PX = 8000
const MAX_AREA_PX = 40_000_000

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Canvas could not be encoded as PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Render every page of a PDF at `dpi` (capped for very large sheets). */
export async function rasterizePdf(pdfBytes: Uint8Array, dpi = 150): Promise<DrawingPageImage[]> {
  const pdfjs = await loadPdfjs()
  // pdf.js keeps the buffer; hand it a copy so the caller's bytes stay usable.
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false })
  const doc = await task.promise
  const pages: DrawingPageImage[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      let scale = dpi / 72
      const side = Math.max(base.width, base.height) * scale
      if (side > MAX_SIDE_PX) scale *= MAX_SIDE_PX / side
      const area = base.width * base.height * scale * scale
      if (area > MAX_AREA_PX) scale *= Math.sqrt(MAX_AREA_PX / area)
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
