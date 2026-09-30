export const CONTEXT_MENU_OPEN_EVENT = 'blueplm:context-menu-open'
export const CONTEXT_MENU_CLOSE_EVENT = 'blueplm:context-menu-close'

export function notifyNativePreviewContextMenu(open: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(open ? CONTEXT_MENU_OPEN_EVENT : CONTEXT_MENU_CLOSE_EVENT))
}
