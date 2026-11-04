/**
 * Pieces of `PdfAnnotationViewer`: the comment box drawn over a page (with its pin number), and the
 * viewer toolbar (comment toggle, pages, zoom, fit). Split out so the viewer stays under the
 * file-size limit.
 */

import { useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Columns,
  Maximize,
  MessageSquarePlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { IconButton } from '@/components/core/ui'
import { t } from '@/lib/i18n'

export type FitMode = 'width' | 'page' | null

export interface OverlayPosition {
  x: number
  y: number
  width: number
  height: number
  pageWidth: number
  pageHeight: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 5

/** The comment colour on the (always white) page: the app's accent token, mixed for tints. */
const rgba = (a: number) =>
  a >= 1
    ? 'var(--ui-accent)'
    : `color-mix(in srgb, var(--ui-accent) ${Math.round(a * 100)}%, transparent)`

/** One comment's box on a page, percentage-positioned so it follows every zoom level. */
export function AnnotationBoxOverlay({
  id,
  position,
  color,
  label,
  isHovered = false,
  isActive = false,
  isPending = false,
  isFlashing = false,
  resolved = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  id?: string
  position: OverlayPosition
  color?: string
  /** The thread's number, drawn as a pin at the box's top-left corner. */
  label?: number
  isHovered?: boolean
  isActive?: boolean
  isPending?: boolean
  /** Just scrolled to from the comment list. */
  isFlashing?: boolean
  resolved?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const interactive = !isPending
  const edge = color ?? rgba(resolved ? 0.45 : 0.85)
  const strong = isActive || isHovered || isFlashing
  return (
    <div
      data-annotation-overlay
      data-annotation-id={id}
      role={interactive && label ? 'button' : undefined}
      aria-label={interactive && label ? t('markups.pin', { number: label }) : undefined}
      style={{
        position: 'absolute',
        left: `${(position.x / position.pageWidth) * 100}%`,
        top: `${(position.y / position.pageHeight) * 100}%`,
        width: `${(position.width / position.pageWidth) * 100}%`,
        height: `${(position.height / position.pageHeight) * 100}%`,
        border: `2px ${isPending ? 'dashed' : 'solid'} ${strong ? rgba(1) : edge}`,
        borderRadius: 3,
        background: resolved ? 'transparent' : rgba(strong ? 0.16 : 0.08),
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: interactive ? 'pointer' : 'default',
        zIndex: strong ? 6 : 4,
        boxShadow: isFlashing
          ? `0 0 0 4px ${rgba(0.35)}, 0 0 18px ${rgba(0.55)}`
          : isActive
            ? `0 0 0 3px ${rgba(0.25)}`
            : undefined,
        transition: 'box-shadow 0.2s, border-color 0.15s, background 0.15s',
      }}
      onClick={interactive ? onClick : undefined}
      onMouseEnter={interactive ? onMouseEnter : undefined}
      onMouseLeave={interactive ? onMouseLeave : undefined}
    >
      {label !== undefined && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -11,
            top: -11,
            minWidth: 20,
            height: 20,
            padding: '0 5px',
            borderRadius: 10,
            background: resolved ? 'var(--ui-fg-tertiary)' : rgba(1),
            color: 'white',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '20px',
            textAlign: 'center',
            boxShadow: '0 1px 3px color-mix(in srgb, black 35%, transparent)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

/** Comment toggle, page navigation, zoom and fit, above or below the pages. */
export function ZoomToolbar({
  scale,
  fitMode,
  onScaleChange,
  onFitWidth,
  onFitPage,
  areaSelectActive,
  onAreaSelectToggle,
  commentKey,
  page,
  pageCount,
  onPage,
  position = 'bottom',
}: {
  scale: number
  fitMode: FitMode
  onScaleChange: (scale: number) => void
  onFitWidth: () => void
  onFitPage: () => void
  areaSelectActive: boolean
  /** Absent when the viewer cannot create comments: no Comment toggle. */
  onAreaSelectToggle?: () => void
  /** The Comment toggle's shortcut, shown inside it. */
  commentKey?: string | null
  page: number
  pageCount: number
  onPage: (page: number) => void
  position?: 'top' | 'bottom'
}) {
  const displayPercent = useMemo(() => {
    if (fitMode === 'width') return t('source.pdfViewer.widthLabel')
    if (fitMode === 'page') return t('source.pdfViewer.fitLabel')
    return `${Math.round(scale * 100)}%`
  }, [scale, fitMode])

  const divider = <div className="mx-1 h-4 w-px bg-ui-border" aria-hidden />

  return (
    <div
      className={`flex h-10 flex-shrink-0 items-center gap-1 bg-ui-bg px-2 ${
        position === 'top'
          ? 'border-b border-ui-border'
          : 'justify-center border-t border-ui-border'
      }`}
    >
      {onAreaSelectToggle && (
        <>
          <button
            type="button"
            onClick={onAreaSelectToggle}
            aria-pressed={areaSelectActive}
            title={
              areaSelectActive
                ? t('source.pdfViewer.disableAreaSelection')
                : t('source.pdfViewer.enableAreaSelection')
            }
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ui-accent/50 ${
              areaSelectActive
                ? 'border-ui-selected-border bg-ui-selected text-ui-fg'
                : 'border-ui-field-border bg-ui-field text-ui-fg hover:bg-ui-selected'
            }`}
          >
            <MessageSquarePlus
              size={14}
              className={areaSelectActive ? 'text-ui-accent' : 'text-ui-fg-secondary'}
            />
            {t('markups.add')}
            {commentKey && (
              <span className="text-[12px] font-normal text-ui-fg-tertiary">{commentKey}</span>
            )}
          </button>
          {divider}
        </>
      )}

      {position === 'top' && <div className="flex-1" />}

      {pageCount > 1 && (
        <>
          <IconButton
            label={t('source.outputs.previewPrevPage')}
            icon={<ChevronLeft size={15} />}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          />
          <span className="min-w-[4.5rem] select-none text-center text-[13px] tabular-nums text-ui-fg-secondary">
            {t('source.outputs.previewPageOf', { page, count: pageCount })}
          </span>
          <IconButton
            label={t('source.outputs.previewNextPage')}
            icon={<ChevronRight size={15} />}
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          />
          {divider}
        </>
      )}

      <IconButton
        label={t('source.pdfViewer.zoomOut')}
        icon={<ZoomOut size={15} />}
        disabled={scale <= MIN_SCALE}
        onClick={() => onScaleChange(Math.max(scale - 0.25, MIN_SCALE))}
      />
      <span className="w-12 select-none text-center text-[13px] tabular-nums text-ui-fg-secondary">
        {displayPercent}
      </span>
      <IconButton
        label={t('source.pdfViewer.zoomIn')}
        icon={<ZoomIn size={15} />}
        disabled={scale >= MAX_SCALE}
        onClick={() => onScaleChange(Math.min(scale + 0.25, MAX_SCALE))}
      />
      {divider}
      <IconButton
        label={t('source.pdfViewer.fitToWidth')}
        icon={<Columns size={15} />}
        pressed={fitMode === 'width'}
        onClick={onFitWidth}
      />
      <IconButton
        label={t('source.pdfViewer.fitToPage')}
        icon={<Maximize size={15} />}
        pressed={fitMode === 'page'}
        onClick={onFitPage}
      />
    </div>
  )
}
