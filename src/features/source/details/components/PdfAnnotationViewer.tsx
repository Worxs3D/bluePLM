/**
 * PdfAnnotationViewer — Direct pdf.js rendering with annotation support.
 *
 * Renders each page as canvas + TextLayer using pdfjs-dist directly.
 * No wrapper library, no patches. Chrome-level rendering quality via
 * HiDPI-aware canvas sizing and pdf.js TextLayer for crisp text selection.
 */

import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, memo } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import { useShortcuts } from '@/lib/keybindings'
import { Loader2, Eye, ExternalLink } from 'lucide-react'

import {
  AnnotationBoxOverlay,
  MAX_SCALE,
  MIN_SCALE,
  ZoomToolbar,
  type FitMode,
} from './PdfViewerParts'

// The worker ships with the app (Vite emits it as an asset) so PDFs render offline and behind
// firewalls; it used to load from unpkg at runtime (audit M7). Same pdfjs-dist version by construction.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// ============================================================================
// Types (public API — unchanged from previous implementation)
// ============================================================================

export type PdfScaleValue = number | 'page-width' | 'page-fit' | 'auto'

export interface NewAnnotationData {
  pageNumber: number
  position: {
    x: number
    y: number
    width: number
    height: number
    pageWidth: number
    pageHeight: number
  }
  selectedText?: string
  annotationType: 'area' | 'text' | 'highlight'
}

export interface AnnotationOverlay {
  id: string
  pageNumber: number
  position: {
    x: number
    y: number
    width: number
    height: number
    pageWidth: number
    pageHeight: number
  }
  color?: string
  resolved?: boolean
  /** The thread's number, drawn as a pin on the box. */
  label?: number
}

export interface PdfAnnotationViewerProps {
  filePath: string
  fileName: string
  fileVersion?: number
  onAnnotationCreate?: (annotation: NewAnnotationData) => void
  onAnnotationClick?: (annotationId: string) => void
  onAnnotationHover?: (annotationId: string | null) => void
  annotations?: AnnotationOverlay[]
  pendingAnnotation?: NewAnnotationData | null
  hoveredAnnotationId?: string | null
  activeAnnotationId?: string | null
  initialScale?: PdfScaleValue
  /**
   * Read the bytes (base64) from somewhere other than the vault. The default, `readFile`, is
   * confined to the vault working folder; the review viewer passes the review PDF cache reader.
   */
  readData?: (
    filePath: string,
  ) => Promise<{ success: boolean; data?: string; bytes?: Uint8Array } | undefined>
  /** What the error state's "Open externally" does; default opens `filePath` in the default app. */
  onOpenExternally?: () => void
  /** Where the toolbar sits (default bottom). Reviews put it on top, beside the title block. */
  toolbarPosition?: 'top' | 'bottom'
  /**
   * Comment mode (drag draws a box), controlled by the parent when given; otherwise the viewer
   * keeps it and starts with it on whenever comments can be created.
   */
  areaSelectActive?: boolean
  onAreaSelectChange?: (active: boolean) => void
  /** The Comment toggle's shortcut, shown inside it. */
  commentKey?: string | null
  /**
   * Scroll to a comment's box and flash it: a new `tick` (the comment list was clicked) moves the
   * view even when the id is the same as last time.
   */
  focusRequest?: { id: string; tick: number } | null
}

const readVaultFile: NonNullable<PdfAnnotationViewerProps['readData']> = (filePath) =>
  window.electronAPI ? window.electronAPI.readFile(filePath) : Promise.resolve(undefined)

// ============================================================================
// Constants
// ============================================================================

const SCROLLBAR_WIDTH = 15
const PAGE_GAP = 8

// ============================================================================
// Helpers
// ============================================================================

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ============================================================================
// PdfPage — canvas + text layer + annotation overlays + area selection
// ============================================================================

interface PdfPageProps {
  page: PDFPageProxy
  scale: number
  annotations: AnnotationOverlay[]
  pendingAnnotation?: NewAnnotationData | null
  hoveredAnnotationId?: string | null
  activeAnnotationId?: string | null
  flashingAnnotationId?: string | null
  areaSelectActive: boolean
  onAnnotationCreate?: (annotation: NewAnnotationData) => void
  onAnnotationClick?: (annotationId: string) => void
  onAnnotationHover?: (annotationId: string | null) => void
}

const PdfPage = memo(function PdfPage({
  page,
  scale,
  annotations,
  pendingAnnotation,
  hoveredAnnotationId,
  activeAnnotationId,
  flashingAnnotationId,
  areaSelectActive,
  onAnnotationCreate,
  onAnnotationClick,
  onAnnotationHover,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textDivRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const textLayerRef = useRef<InstanceType<typeof TextLayer> | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  )

  const pageNumber = page.pageNumber
  const unscaledVp = useMemo(() => page.getViewport({ scale: 1 }), [page])
  const viewport = useMemo(() => page.getViewport({ scale }), [page, scale])

  // Lazy rendering via IntersectionObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      rootMargin: '500px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Canvas rendering — HiDPI aware
  useEffect(() => {
    if (!isVisible || !canvasRef.current) return

    renderTaskRef.current?.cancel()

    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1

    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const task = page.render({ canvasContext: ctx, viewport })
    renderTaskRef.current = task
    task.promise.catch(() => {})

    return () => {
      task.cancel()
    }
  }, [isVisible, viewport, page])

  // Text layer rendering
  useEffect(() => {
    if (!isVisible || !textDivRef.current) return

    textLayerRef.current?.cancel()
    const container = textDivRef.current
    container.replaceChildren()

    let cancelled = false

    page.getTextContent().then((textContent) => {
      if (cancelled || !textDivRef.current) return
      const tl = new TextLayer({
        textContentSource: textContent,
        container: textDivRef.current,
        viewport,
      })
      textLayerRef.current = tl
      tl.render().catch(() => {})
    })

    return () => {
      cancelled = true
      textLayerRef.current?.cancel()
    }
  }, [isVisible, viewport, page])

  // Area selection via capture-phase listener (works for both Alt+drag and area-select mode)
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onAnnotationCreate) return

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      if (!areaSelectActive && !e.altKey) return
      if ((e.target as HTMLElement).closest('[data-annotation-overlay]')) return

      e.preventDefault()
      e.stopPropagation()

      const rect = el.getBoundingClientRect()
      const startX = e.clientX - rect.left
      const startY = e.clientY - rect.top

      const handleMove = (ev: MouseEvent) => {
        const mx = Math.max(0, Math.min(ev.clientX - rect.left, viewport.width))
        const my = Math.max(0, Math.min(ev.clientY - rect.top, viewport.height))
        setSelRect({
          x: Math.min(startX, mx),
          y: Math.min(startY, my),
          w: Math.abs(mx - startX),
          h: Math.abs(my - startY),
        })
      }

      const handleUp = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', handleMove)
        document.removeEventListener('mouseup', handleUp)
        setSelRect(null)

        const mx = Math.max(0, Math.min(ev.clientX - rect.left, viewport.width))
        const my = Math.max(0, Math.min(ev.clientY - rect.top, viewport.height))
        const x1 = Math.min(startX, mx)
        const y1 = Math.min(startY, my)
        const w = Math.abs(mx - startX)
        const h = Math.abs(my - startY)

        if (w < 5 || h < 5) return

        onAnnotationCreate({
          pageNumber,
          position: {
            x: x1 / scale,
            y: y1 / scale,
            width: w / scale,
            height: h / scale,
            pageWidth: unscaledVp.width,
            pageHeight: unscaledVp.height,
          },
          annotationType: 'area',
        })
      }

      document.addEventListener('mousemove', handleMove)
      document.addEventListener('mouseup', handleUp)
    }

    el.addEventListener('mousedown', handleMouseDown, { capture: true })
    return () => el.removeEventListener('mousedown', handleMouseDown, { capture: true })
  }, [
    areaSelectActive,
    onAnnotationCreate,
    pageNumber,
    scale,
    viewport.width,
    viewport.height,
    unscaledVp.width,
    unscaledVp.height,
  ])

  const pageAnnotations = useMemo(
    () => annotations.filter((a) => a.pageNumber === pageNumber),
    [annotations, pageNumber],
  )

  const pagePending = pendingAnnotation?.pageNumber === pageNumber ? pendingAnnotation : null

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      className="pdf-page"
      style={{
        width: Math.floor(viewport.width),
        height: Math.floor(viewport.height),
        position: 'relative',
        marginBottom: PAGE_GAP,
        background: 'white',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        cursor: areaSelectActive ? 'crosshair' : undefined,
      }}
    >
      {isVisible && (
        <>
          <canvas ref={canvasRef} style={{ display: 'block', position: 'absolute', inset: 0 }} />
          <div ref={textDivRef} className="pdf-text-layer" />

          {pageAnnotations.map((ann) => (
            <AnnotationBoxOverlay
              key={ann.id}
              id={ann.id}
              position={ann.position}
              color={ann.color}
              label={ann.label}
              resolved={ann.resolved}
              isHovered={hoveredAnnotationId === ann.id}
              isActive={activeAnnotationId === ann.id}
              isFlashing={flashingAnnotationId === ann.id}
              onClick={() => onAnnotationClick?.(ann.id)}
              onMouseEnter={() => onAnnotationHover?.(ann.id)}
              onMouseLeave={() => onAnnotationHover?.(null)}
            />
          ))}

          {pagePending && <AnnotationBoxOverlay position={pagePending.position} isPending />}

          {selRect && selRect.w > 0 && selRect.h > 0 && (
            <div
              style={{
                position: 'absolute',
                left: selRect.x,
                top: selRect.y,
                width: selRect.w,
                height: selRect.h,
                border: '2px dashed rgba(59, 130, 246, 0.8)',
                background: 'rgba(59, 130, 246, 0.1)',
                pointerEvents: 'none',
                zIndex: 11,
              }}
            />
          )}
        </>
      )}
    </div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export function PdfAnnotationViewer({
  readData = readVaultFile,
  filePath,
  fileName: _fileName,
  fileVersion,
  onAnnotationCreate,
  onAnnotationClick,
  onAnnotationHover,
  annotations = [],
  pendingAnnotation,
  hoveredAnnotationId,
  activeAnnotationId,
  initialScale,
  onOpenExternally,
  toolbarPosition = 'bottom',
  areaSelectActive: areaSelectProp,
  onAreaSelectChange,
  commentKey,
  focusRequest,
}: PdfAnnotationViewerProps) {
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<PDFPageProxy[]>([])
  const [scale, setScale] = useState(1)
  const [fitMode, setFitMode] = useState<FitMode>(initialScale === 'page-fit' ? 'page' : 'width')
  const [areaSelectOwn, setAreaSelectOwn] = useState(!!onAnnotationCreate)
  const areaSelectActive = areaSelectProp ?? areaSelectOwn
  const toggleAreaSelect = useCallback(() => {
    const next = !areaSelectActive
    if (areaSelectProp === undefined) setAreaSelectOwn(next)
    onAreaSelectChange?.(next)
  }, [areaSelectActive, areaSelectProp, onAreaSelectChange])
  const [flashingId, setFlashingId] = useState<string | null>(null)
  const [localPending, setLocalPending] = useState<NewAnnotationData | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pdfAreaRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null)

  // ── Load PDF bytes and create document ──────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof getDocument> | null = null

    setLoading(true)
    setError(null)
    setPages([])

    const load = async () => {
      const result = await readData(filePath)
      if (cancelled) return

      if (!result?.success || (!result.data && !result.bytes)) {
        setError(t('source.pdfViewer.failedToReadPdf'))
        log.error('[PdfViewer]', 'readFile failed', { filePath, success: result?.success })
        setLoading(false)
        return
      }

      // pdf.js transfers the buffer it is given to its worker, so cached bytes go in as a copy.
      task = getDocument({
        data: result.bytes ? result.bytes.slice() : base64ToUint8Array(result.data ?? ''),
      })
      const doc = await task.promise
      if (cancelled) {
        doc.destroy()
        return
      }

      const ps = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
      )
      if (cancelled) {
        doc.destroy()
        return
      }

      docRef.current?.destroy()
      docRef.current = doc
      setPages(ps)
      setLoading(false)
    }

    load().catch((err) => {
      if (cancelled) return
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Failed to load PDF: ${msg}`)
      log.error('[PdfViewer]', 'PDF load error', { filePath, error: err })
      setLoading(false)
    })

    return () => {
      cancelled = true
      task?.destroy()
    }
  }, [filePath, fileVersion, readData])

  // Cleanup document on unmount
  useEffect(
    () => () => {
      docRef.current?.destroy()
    },
    [],
  )

  // ── Compute fit scale ──────────────────────────────────────────────────
  const computeFitScale = useCallback(
    (mode: 'width' | 'page'): number | null => {
      if (pages.length === 0) return null
      const container = pdfAreaRef.current
      if (!container || container.clientWidth < 10 || container.clientHeight < 10) return null

      const uv = pages[0].getViewport({ scale: 1 })
      const availW = container.clientWidth - SCROLLBAR_WIDTH
      const availH = container.clientHeight

      const s =
        mode === 'width' ? availW / uv.width : Math.min(availW / uv.width, availH / uv.height)

      return Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)) * 100) / 100
    },
    [pages],
  )

  // ── Initial fit scale (once pages are ready) ──────────────────────────
  useEffect(() => {
    if (pages.length === 0) return

    if (typeof initialScale === 'number') {
      setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialScale)))
      setFitMode(null)
      return
    }

    const mode: 'width' | 'page' = initialScale === 'page-fit' ? 'page' : 'width'
    const s = computeFitScale(mode)
    if (s) {
      setScale(s)
      setFitMode(mode)
    }
  }, [pages, initialScale, computeFitScale])

  // ── Auto-refit on container resize ─────────────────────────────────────
  useEffect(() => {
    const container = pdfAreaRef.current
    if (!container || pages.length === 0) return

    let lastW = container.clientWidth
    let lastH = container.clientHeight

    const observer = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (Math.abs(w - lastW) < 5 && Math.abs(h - lastH) < 5) return
      lastW = w
      lastH = h

      const fm = fitMode
      if (!fm) return
      const s = computeFitScale(fm)
      if (s) setScale(s)
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [pages, fitMode, computeFitScale])

  // ── Apply pending scroll correction after scale change ─────────────────
  useLayoutEffect(() => {
    const target = pendingScrollRef.current
    const scrollEl = scrollRef.current
    if (!target || !scrollEl) return
    pendingScrollRef.current = null
    scrollEl.scrollLeft = Math.max(0, target.left)
    scrollEl.scrollTop = Math.max(0, target.top)
  }, [scale])

  // ── Keyboard zoom (viewport-centered): the registry's pdfViewer.* shortcuts ──
  const zoomAroundCenter = (delta: number) => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const cx = scrollEl.clientWidth / 2
    const cy = scrollEl.clientHeight / 2
    const contentX = scrollEl.scrollLeft + cx
    const contentY = scrollEl.scrollTop + cy
    const oldScale = scaleRef.current
    const newScale =
      Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + delta)) * 100) / 100
    if (newScale === oldScale) return
    const ratio = newScale / oldScale
    pendingScrollRef.current = { left: contentX * ratio - cx, top: contentY * ratio - cy }
    setFitMode(null)
    setScale(newScale)
  }

  useShortcuts('pdfViewer', {
    'pdfViewer.zoomIn': () => zoomAroundCenter(0.25),
    'pdfViewer.zoomOut': () => zoomAroundCenter(-0.25),
    'pdfViewer.fitPage': () => {
      const s = computeFitScale('page')
      if (s) {
        setScale(s)
        setFitMode('page')
      }
    },
  })

  // ── Ctrl+wheel zoom (cursor-centered) ──────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()

      const scrollEl = scrollRef.current
      if (!scrollEl) return

      const rect = scrollEl.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const contentX = scrollEl.scrollLeft + cursorX
      const contentY = scrollEl.scrollTop + cursorY

      const oldScale = scaleRef.current
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const newScale =
        Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + delta)) * 100) / 100
      if (newScale === oldScale) return

      const ratio = newScale / oldScale
      pendingScrollRef.current = {
        left: contentX * ratio - cursorX,
        top: contentY * ratio - cursorY,
      }

      setFitMode(null)
      setScale(newScale)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
    // Re-run once the viewer container actually mounts: on first render the component is still
    // in its loading state and returns a different tree with no containerRef, so without these
    // deps the listener would never attach to the real container (Ctrl+wheel zoom would be dead).
  }, [loading, error, pages.length])

  // ── Page navigation: the page at the top third of the view is the current one ──
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl || pages.length < 2) return
    let frame = 0
    const update = () => {
      frame = 0
      const mark = scrollEl.scrollTop + scrollEl.clientHeight / 3
      let page = 1
      for (const el of scrollEl.querySelectorAll<HTMLElement>('[data-page-number]')) {
        if (el.offsetTop <= mark) page = Number(el.dataset.pageNumber) || page
      }
      setCurrentPage(page)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [loading, error, pages.length, scale])

  const goToPage = useCallback(
    (page: number) => {
      const scrollEl = scrollRef.current
      const target = Math.max(1, Math.min(pages.length, page))
      const el = scrollEl?.querySelector<HTMLElement>(`[data-page-number="${target}"]`)
      if (!scrollEl || !el) return
      scrollEl.scrollTop = Math.max(0, el.offsetTop - PAGE_GAP)
      setCurrentPage(target)
    },
    [pages.length],
  )

  // ── Scroll to a comment chosen in the list, and flash its box ──────────
  const focusId = focusRequest?.id ?? null
  const focusTick = focusRequest?.tick ?? 0
  useEffect(() => {
    if (!focusId) return
    const target = annotations.find((a) => a.id === focusId)
    const scrollEl = scrollRef.current
    const pageEl = target
      ? scrollEl?.querySelector<HTMLElement>(`[data-page-number="${target.pageNumber}"]`)
      : null
    if (!target || !scrollEl || !pageEl) return
    const fraction = target.position.y / target.position.pageHeight
    const boxTop = pageEl.offsetTop + fraction * pageEl.offsetHeight
    const boxHeight = (target.position.height / target.position.pageHeight) * pageEl.offsetHeight
    const visibleTop = scrollEl.scrollTop
    const visibleBottom = visibleTop + scrollEl.clientHeight
    if (boxTop < visibleTop + 24 || boxTop + boxHeight > visibleBottom - 24) {
      scrollEl.scrollTo({
        top: Math.max(0, boxTop - scrollEl.clientHeight / 3),
        behavior: 'smooth',
      })
    }
    const leftFraction = target.position.x / target.position.pageWidth
    const boxLeft = pageEl.offsetLeft + leftFraction * pageEl.offsetWidth
    if (
      boxLeft < scrollEl.scrollLeft ||
      boxLeft > scrollEl.scrollLeft + scrollEl.clientWidth - 40
    ) {
      scrollEl.scrollTo({ left: Math.max(0, boxLeft - 40), behavior: 'smooth' })
    }
    setFlashingId(focusId)
    const handle = setTimeout(() => setFlashingId(null), 1200)
    return () => clearTimeout(handle)
    // A new tick is a new request; the annotation list changing alone is not.
  }, [focusId, focusTick, pages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit-to-width / Fit-to-page handlers ────────────────────────────────
  const handleFitWidth = useCallback(() => {
    const s = computeFitScale('width')
    if (s) {
      setScale(s)
      setFitMode('width')
    }
  }, [computeFitScale])

  const handleFitPage = useCallback(() => {
    const s = computeFitScale('page')
    if (s) {
      setScale(s)
      setFitMode('page')
    }
  }, [computeFitScale])

  // ── Annotation creation wrapper (local pending for immediate feedback) ──
  const handleAnnotationCreate = useCallback(
    (data: NewAnnotationData) => {
      setLocalPending(data)
      onAnnotationCreate?.(data)
    },
    [onAnnotationCreate],
  )

  useEffect(() => {
    if (!pendingAnnotation) setLocalPending(null)
  }, [pendingAnnotation])

  const effectivePending = localPending ?? pendingAnnotation

  // ── Text selection → annotation creation ───────────────────────────────
  useEffect(() => {
    if (!onAnnotationCreate || areaSelectActive) return
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const handleMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return

      const range = sel.getRangeAt(0)
      const startNode =
        range.startContainer instanceof HTMLElement
          ? range.startContainer
          : range.startContainer.parentElement
      if (!startNode) return

      const pageEl = startNode.closest('[data-page-number]') as HTMLElement | null
      if (!pageEl || !scrollEl.contains(pageEl)) return

      const pageNum = parseInt(pageEl.dataset.pageNumber || '0', 10)
      if (!pageNum || pageNum < 1 || pageNum > pages.length) return

      const rangeRect = range.getBoundingClientRect()
      const pageRect = pageEl.getBoundingClientRect()
      const currentScale = scaleRef.current

      const uv = pages[pageNum - 1].getViewport({ scale: 1 })
      const x = (rangeRect.left - pageRect.left) / currentScale
      const y = (rangeRect.top - pageRect.top) / currentScale
      const w = rangeRect.width / currentScale
      const h = rangeRect.height / currentScale

      if (w < 2 || h < 2) return

      const data: NewAnnotationData = {
        pageNumber: pageNum,
        position: { x, y, width: w, height: h, pageWidth: uv.width, pageHeight: uv.height },
        selectedText: sel.toString(),
        annotationType: 'text',
      }

      setLocalPending(data)
      onAnnotationCreate(data)
      sel.removeAllRanges()
    }

    scrollEl.addEventListener('mouseup', handleMouseUp)
    return () => scrollEl.removeEventListener('mouseup', handleMouseUp)
  }, [onAnnotationCreate, areaSelectActive, pages])

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-plm-fg-muted">
          <Loader2 className="animate-spin" size={20} />
          <span>{t('source.pdfViewer.loadingPdf')}</span>
        </div>
      </div>
    )
  }

  if (error || pages.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-sm text-plm-fg-muted text-center">
          <Eye size={48} className="mx-auto mb-4 opacity-30" />
          <div>{error || t('source.pdfViewer.failedToLoadPdf')}</div>
          <button
            onClick={() =>
              onOpenExternally ? onOpenExternally() : window.electronAPI?.openFile(filePath)
            }
            className="btn btn-secondary gap-2 mt-4"
          >
            <ExternalLink size={14} />
            {t('source.pdfViewer.openExternally')}
          </button>
        </div>
      </div>
    )
  }

  const toolbar = (
    <ZoomToolbar
      position={toolbarPosition}
      scale={scale}
      fitMode={fitMode}
      onScaleChange={(s) => {
        setFitMode(null)
        setScale(s)
      }}
      onFitWidth={handleFitWidth}
      onFitPage={handleFitPage}
      areaSelectActive={areaSelectActive}
      onAreaSelectToggle={onAnnotationCreate ? toggleAreaSelect : undefined}
      commentKey={commentKey}
      page={currentPage}
      pageCount={pages.length}
      onPage={goToPage}
    />
  )

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col min-h-0">
      {toolbarPosition === 'top' && toolbar}
      <div ref={pdfAreaRef} className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto"
          style={{
            background: toolbarPosition === 'top' ? 'var(--ui-nav)' : 'var(--plm-bg-light)',
          }}
        >
          <div
            // 'safe center' keeps pages centered when they fit, but left-aligns (and stays
            // scrollable) when a page is wider than the viewport. Plain 'items-center' makes the
            // left overflow unreachable once zoomed past the viewport width. Tailwind 3.4 has no
            // built-in 'safe' utility, so this uses an arbitrary property.
            className="flex flex-col py-3 [align-items:safe_center]"
          >
            {pages.map((page) => (
              <PdfPage
                key={page.pageNumber}
                page={page}
                scale={scale}
                annotations={annotations}
                pendingAnnotation={effectivePending}
                hoveredAnnotationId={hoveredAnnotationId}
                activeAnnotationId={activeAnnotationId}
                flashingAnnotationId={flashingId}
                areaSelectActive={areaSelectActive}
                onAnnotationCreate={onAnnotationCreate ? handleAnnotationCreate : undefined}
                onAnnotationClick={onAnnotationClick}
                onAnnotationHover={onAnnotationHover}
              />
            ))}
          </div>
        </div>
      </div>
      {toolbarPosition === 'bottom' && toolbar}
    </div>
  )
}
