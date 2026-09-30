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
  hide: () => unknown
  show: () => unknown
}): NativePreviewVisibilityController {
  let ready = false
  let contextMenuOpen = false
  let revision = 0
  const sync = () => {
    if (!ready) return
    const requestedRevision = ++revision
    if (contextMenuOpen) {
      void api.hide()
      return
    }
    const pending = api.show()
    if (pending && typeof (pending as { then?: unknown }).then === 'function') {
      void (pending as PromiseLike<void>).then(() => {
        if (requestedRevision !== revision || contextMenuOpen) void api.hide()
      })
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
  }
}
