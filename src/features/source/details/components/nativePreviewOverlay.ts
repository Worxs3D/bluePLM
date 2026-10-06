export const CONTEXT_MENU_OPEN_EVENT = 'blueplm:context-menu-open'
export const CONTEXT_MENU_CLOSE_EVENT = 'blueplm:context-menu-close'

export function notifyNativePreviewContextMenu(open: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(open ? CONTEXT_MENU_OPEN_EVENT : CONTEXT_MENU_CLOSE_EVENT))
}

export interface NativePreviewVisibilityController {
  setReady(ready: boolean): void
  setContextMenuOpen(open: boolean): void
  setOverlayCount(count: number): void
}

/** Keeps native child-window visibility derived from the two actual states. */
export function createNativePreviewVisibilityController(api: {
  prepareShow?: () => unknown
  hide: () => unknown
  show: () => unknown
}): NativePreviewVisibilityController {
  let ready = false
  let contextMenuOpen = false
  let overlayCount = 0
  let revision = 0
  const sync = () => {
    const requestedRevision = ++revision
    if (!ready) return
    if (contextMenuOpen || overlayCount > 0) {
      void api.hide()
      return
    }
    const show = () => {
      if (!ready || contextMenuOpen || overlayCount > 0 || requestedRevision !== revision) return
      const pending = api.show()
      if (pending && typeof (pending as { then?: unknown }).then === 'function') {
        void (pending as PromiseLike<void>).then(() => {
          if (!ready || requestedRevision !== revision || contextMenuOpen || overlayCount > 0) void api.hide()
        })
      }
    }
    const preparation = api.prepareShow?.()
    if (preparation && typeof (preparation as { then?: unknown }).then === 'function') {
      void (preparation as PromiseLike<void>).then(show)
    } else {
      show()
    }
  }
  return {
    setReady(value) {
      ready = value
      sync()
    },
    setContextMenuOpen(value) {
      contextMenuOpen = value
      sync()
    },
    setOverlayCount(count) {
      const nextOverlayCount = Math.max(0, count)
      if (nextOverlayCount === overlayCount) return
      overlayCount = nextOverlayCount
      sync()
    },
  }
}

const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="tooltip"]',
  '[aria-live]',
  '.context-menu',
  '[data-radix-popper-content-wrapper]',
  '[class*="tooltip"]',
  '[class*="dropdown"]',
  '[class*="z-50"]',
  '[class*="z-["]',
].join(', ')

function isVisibleOverlay(element: Element, host: HTMLElement): boolean {
  if (!(element instanceof HTMLElement) || element === host || host.contains(element)) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false
  }
  return element.getClientRects().length > 0
}

export function countVisibleNativePreviewOverlays(host: HTMLElement): number {
  return Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).filter((element) =>
    isVisibleOverlay(element, host),
  ).length
}

/** Observes independent DOM overlays so one closing cannot reveal the native child behind another. */
export function observeNativePreviewOverlays(
  host: HTMLElement,
  onOverlayCountChange: (count: number) => void,
): () => void {
  const report = () => onOverlayCountChange(countVisibleNativePreviewOverlays(host))

  const observer = new MutationObserver(report)
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-hidden', 'class', 'role', 'style'],
    childList: true,
    subtree: true,
  })
  report()
  return () => observer.disconnect()
}
