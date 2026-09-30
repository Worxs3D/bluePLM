import { describe, expect, it, vi } from 'vitest'
import { CONTEXT_MENU_CLOSE_EVENT, CONTEXT_MENU_OPEN_EVENT, createNativePreviewVisibilityController, notifyNativePreviewContextMenu } from './nativePreviewOverlay'

describe('native preview context-menu seam', () => {
  it('emits a hide event before the menu and a restore event after it closes', () => {
    vi.stubGlobal('window', new EventTarget())
    const events: string[] = []
    const onOpen = () => events.push('open')
    const onClose = () => events.push('close')
    window.addEventListener(CONTEXT_MENU_OPEN_EVENT, onOpen)
    window.addEventListener(CONTEXT_MENU_CLOSE_EVENT, onClose)

    notifyNativePreviewContextMenu(true)
    notifyNativePreviewContextMenu(false)

    expect(events).toEqual(['open', 'close'])
    window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onOpen)
    window.removeEventListener(CONTEXT_MENU_CLOSE_EVENT, onClose)
    vi.restoreAllMocks()
  })

  it('hides and restores the native preview for actual menu state transitions', () => {
    const hide = vi.fn()
    const show = vi.fn()
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setContextMenuOpen(true)
    controller.setReady(true)
    expect(hide).toHaveBeenCalledTimes(1)
    expect(show).not.toHaveBeenCalled()

    controller.setContextMenuOpen(false)
    expect(show).toHaveBeenCalledTimes(1)
    controller.setContextMenuOpen(true)
    controller.setContextMenuOpen(false)
    expect(hide).toHaveBeenCalledTimes(2)
    expect(show).toHaveBeenCalledTimes(2)
  })
})
