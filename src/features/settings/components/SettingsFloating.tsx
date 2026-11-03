import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

import { SettingsPanel } from './SettingsPanel'
import { hasLayerAboveSettings, SETTINGS_MODAL_LAYER_ATTR } from './settingsModalLayers'
import {
  clampRect,
  defaultRect,
  moveRect,
  resizeRect,
  type Edges,
  type Rect,
} from './settingsWindowLayout'

const LAYER = { [SETTINGS_MODAL_LAYER_ATTR]: '' }

/** Where the panel was last left, so reopening it in the same session puts it back there. */
let lastRect: Rect | null = null

const HANDLES: Array<{ edges: Edges; className: string }> = [
  { edges: { top: true }, className: 'left-2 right-2 top-0 h-1.5 cursor-ns-resize' },
  { edges: { bottom: true }, className: 'bottom-0 left-2 right-2 h-1.5 cursor-ns-resize' },
  { edges: { left: true }, className: 'bottom-2 left-0 top-2 w-1.5 cursor-ew-resize' },
  { edges: { right: true }, className: 'bottom-2 right-0 top-2 w-1.5 cursor-ew-resize' },
  { edges: { top: true, left: true }, className: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
  { edges: { top: true, right: true }, className: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
  { edges: { bottom: true, left: true }, className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
  {
    edges: { bottom: true, right: true },
    className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize',
  },
]

/**
 * Settings as a floating panel inside the app window, where it cannot have a window of its own
 * (the web, or a desktop that refused to open one). Drag it by the header, resize it from any
 * edge or corner; there is no backdrop, so the app behind it stays usable. Escape closes it while
 * focus is inside it.
 *
 * It sits at z-[45], under every dialog (z-50 and up), so confirmations and editors opened from
 * a settings page appear above it.
 */
export function SettingsFloating() {
  const panelRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect>(() =>
    clampRect(
      lastRect ?? defaultRect(window.innerWidth, window.innerHeight),
      window.innerWidth,
      window.innerHeight,
    ),
  )

  useEffect(() => {
    lastRect = rect
  }, [rect])

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!(e.target instanceof Node) || !panelRef.current?.contains(e.target)) return
      if (hasLayerAboveSettings()) return
      e.preventDefault()
      usePDMStore.getState().closeSettings()
    }
    const onResize = () => setRect((r) => clampRect(r, window.innerWidth, window.innerHeight))
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
      returnFocus?.focus({ preventScroll: true })
    }
  }, [])

  /** Follows the pointer from `e` until it is released, applying each step through `apply`. */
  const track = (
    e: ReactPointerEvent<HTMLElement>,
    apply: (start: Rect, dx: number, dy: number) => Rect,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    const target = e.currentTarget
    const start = rect
    const x0 = e.clientX
    const y0 = e.clientY
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => setRect(apply(start, ev.clientX - x0, ev.clientY - y0))
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      {...LAYER}
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="settings-modal-title"
      tabIndex={-1}
      data-native-preview-overlay="modal"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      className="fixed z-[45] flex flex-col overflow-hidden rounded-xl border border-ui-border bg-ui-bg font-ui text-ui-fg antialiased shadow-[0_24px_64px_rgb(0_0_0/0.45)] outline-none animate-dialog-in"
    >
      <SettingsPanel
        showHeader
        onHeaderPointerDown={(e) =>
          track(e, (start, dx, dy) =>
            moveRect(start, dx, dy, window.innerWidth, window.innerHeight),
          )
        }
      />
      {HANDLES.map(({ edges, className }) => (
        <div
          key={className}
          aria-hidden
          className={`absolute z-10 ${className}`}
          onPointerDown={(e) =>
            track(e, (start, dx, dy) =>
              resizeRect(start, edges, dx, dy, window.innerWidth, window.innerHeight),
            )
          }
        />
      ))}
    </div>
  )
}
