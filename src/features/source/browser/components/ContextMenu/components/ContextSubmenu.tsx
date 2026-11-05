/**
 * A context menu flyout, placed next to the row it opens from.
 *
 * It stays a DOM child of its row (hover and click bubble as before) but is positioned `fixed`
 * from the row's rectangle, so no ancestor clips it: to the right of the row, flipped to the left
 * when it would leave the window, and moved up when it would run off the bottom. It is placed
 * again whenever its size or its row's size changes (a list that finishes loading), when the
 * window resizes, when the root menu's fade-in ends or it scrolls, and when another flyout moves (a flyout of a
 * flyout follows its parent).
 */
import { useLayoutEffect, useRef, type MouseEventHandler, type ReactNode } from 'react'

interface ContextSubmenuProps {
  children: ReactNode
  className?: string
  minWidth?: number
  onMouseEnter?: MouseEventHandler<HTMLDivElement>
  onMouseLeave?: MouseEventHandler<HTMLDivElement>
}

/** Space between the row and its flyout. */
export const SUBMENU_GAP = 4
/** The least distance a flyout keeps from the window's edges. */
export const SUBMENU_VIEWPORT_PADDING = 8
/** The flyout's first row lines up with the row it opens from (its own top padding). */
const SUBMENU_TOP_OFFSET = -4

/** Fired on `window` after a flyout moved, so flyouts opened from it move along. */
const SUBMENU_MOVED_EVENT = 'blueplm:context-submenu-moved'

export interface SubmenuPlacement {
  left: number
  top: number
  side: 'right' | 'left'
}

interface RectLike {
  left: number
  right: number
  top: number
}

/** Where a flyout of `size` goes next to `row`, in a window of `viewport`. */
export function placeSubmenu(
  row: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): SubmenuPlacement {
  const pad = SUBMENU_VIEWPORT_PADDING
  let left = row.right + SUBMENU_GAP
  let side: SubmenuPlacement['side'] = 'right'
  if (left + size.width > viewport.width - pad) {
    const flipped = row.left - SUBMENU_GAP - size.width
    if (flipped >= pad) {
      left = flipped
      side = 'left'
    } else {
      // No room on either side: as far right as fits, over the menu rather than off screen.
      left = Math.max(pad, viewport.width - pad - size.width)
    }
  }
  let top = row.top + SUBMENU_TOP_OFFSET
  if (top + size.height > viewport.height - pad) top = viewport.height - pad - size.height
  top = Math.max(pad, top)
  return { left, top, side }
}

export function ContextSubmenu({
  children,
  className = '',
  minWidth = 160,
  onMouseEnter,
  onMouseLeave,
}: ContextSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const submenu = submenuRef.current
    const row = submenu?.parentElement
    if (!submenu || !row) return

    let last = ''
    const place = () => {
      // Measured from (0, 0) first: an ancestor with a transform (the root menu's fade-in) makes
      // `fixed` relative to itself, and this origin is the correction for it.
      submenu.style.left = '0px'
      submenu.style.top = '0px'
      const origin = submenu.getBoundingClientRect()
      const placement = placeSubmenu(
        row.getBoundingClientRect(),
        { width: origin.width, height: origin.height },
        { width: window.innerWidth, height: window.innerHeight },
      )
      submenu.style.left = `${placement.left - origin.left}px`
      submenu.style.top = `${placement.top - origin.top}px`
      submenu.dataset.side = placement.side
      const key = `${placement.left},${placement.top}`
      if (key !== last) {
        last = key
        window.dispatchEvent(new Event(SUBMENU_MOVED_EVENT))
      }
    }

    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(submenu)
    observer?.observe(row)
    window.addEventListener('resize', place)
    window.addEventListener(SUBMENU_MOVED_EVENT, place)
    document.addEventListener('animationend', place, true)
    // The root menu (or a flyout) scrolls when it is taller than the window: follow the row.
    document.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('scroll', place, true)
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener(SUBMENU_MOVED_EVENT, place)
      document.removeEventListener('animationend', place, true)
    }
  }, [])

  return (
    <div
      ref={submenuRef}
      data-context-submenu=""
      className={`fixed left-0 top-0 max-h-[calc(100vh-16px)] overflow-y-auto bg-plm-bg-lighter border border-plm-border rounded-md py-1 shadow-lg z-[100] ${className}`}
      style={{ minWidth }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  )
}
