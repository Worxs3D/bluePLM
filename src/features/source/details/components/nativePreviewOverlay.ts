export const CONTEXT_MENU_OPEN_EVENT = 'blueplm:context-menu-open'
export const CONTEXT_MENU_CLOSE_EVENT = 'blueplm:context-menu-close'

export function notifyNativePreviewContextMenu(open: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(open ? CONTEXT_MENU_OPEN_EVENT : CONTEXT_MENU_CLOSE_EVENT))
}

export interface NativePreviewVisibilityController {
  setReady(ready: boolean): void
  setContextMenuOpen(open: boolean): void
}

/** Keeps native child-window visibility derived from the two actual states. */
export function createNativePreviewVisibilityController(api: {
  hide: () => void | Promise<void>
  show: () => void | Promise<void>
}): NativePreviewVisibilityController {
  let ready = false
  let contextMenuOpen = false
  const sync = () => {
    if (!ready) return
    void (contextMenuOpen ? api.hide() : api.show())
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
  }
}
