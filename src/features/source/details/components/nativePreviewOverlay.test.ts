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

  it('never shows while a menu opened during native startup', () => {
    const calls: string[] = []
    const controller = createNativePreviewVisibilityController({
      hide: () => calls.push('hide'),
      show: () => calls.push('show'),
    })

    controller.setContextMenuOpen(true)
    controller.setReady(true)

    expect(calls).toEqual(['hide'])
  })

  it('keeps the native preview hidden until every simultaneous overlay closes', () => {
    const hide = vi.fn()
    const show = vi.fn()
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setOverlayCount(2)
    controller.setReady(true)
    controller.setOverlayCount(1)

    expect(show).not.toHaveBeenCalled()
    expect(hide).toHaveBeenCalledTimes(2)

    controller.setOverlayCount(0)

    expect(show).toHaveBeenCalledTimes(1)
  })

  it('does not issue visibility IPC again when an observed DOM mutation leaves the overlay count unchanged', () => {
    const hide = vi.fn()
    const show = vi.fn()
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setReady(true)
    controller.setOverlayCount(0)
    controller.setOverlayCount(0)
    controller.setOverlayCount(1)
    controller.setOverlayCount(1)

    expect(show).toHaveBeenCalledTimes(1)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('does not show when the menu reopens during asynchronous preparation', async () => {
    let resolvePreparation!: () => void
    const preparation = new Promise<void>((resolve) => { resolvePreparation = resolve })
    const show = vi.fn()
    const hide = vi.fn()
    const controller = createNativePreviewVisibilityController({
      prepareShow: () => preparation,
      hide,
      show,
    })

    controller.setReady(true)
    controller.setContextMenuOpen(true)
    resolvePreparation()
    await Promise.resolve()

    expect(show).not.toHaveBeenCalled()
    expect(hide).toHaveBeenCalled()
  })

  it('invalidates preparation when the preview is disposed', async () => {
    let resolvePreparation!: () => void
    const preparation = new Promise<void>((resolve) => { resolvePreparation = resolve })
    const show = vi.fn()
    const controller = createNativePreviewVisibilityController({
      prepareShow: () => preparation,
      hide: vi.fn(),
      show,
    })

    controller.setReady(true)
    controller.setReady(false)
    resolvePreparation()
    await Promise.resolve()

    expect(show).not.toHaveBeenCalled()
  })

  it('hides after a stale show promise resolves', async () => {
    let resolveShow!: () => void
    const showPromise = new Promise<void>((resolve) => { resolveShow = resolve })
    const show = vi.fn(() => showPromise)
    const hide = vi.fn()
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setReady(true)
    controller.setContextMenuOpen(true)
    resolveShow()
    await Promise.resolve()

    expect(hide).toHaveBeenCalled()
  })

  it('waits for a delayed hide before restoring after a persistent menu and independent overlays close', async () => {
    let resolveHide!: () => void
    const hidden = new Promise<void>((resolve) => { resolveHide = resolve })
    const hide = vi.fn(() => hidden)
    const show = vi.fn()
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setReady(true)
    show.mockClear()
    controller.setContextMenuOpen(true)
    controller.setOverlayCount(2)
    controller.setOverlayCount(1)
    controller.setOverlayCount(0)

    expect(show).not.toHaveBeenCalled()

    controller.setContextMenuOpen(false)

    expect(show).not.toHaveBeenCalled()

    resolveHide()
    await Promise.resolve()

    expect(show).toHaveBeenCalledTimes(1)
  })

  it('does not send duplicate hides while one delayed hide already covers additional overlays', () => {
    const hidden = new Promise<void>(() => undefined)
    const hide = vi.fn(() => hidden)
    const controller = createNativePreviewVisibilityController({ hide, show: vi.fn() })

    controller.setReady(true)
    controller.setOverlayCount(1)
    controller.setOverlayCount(2)

    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('does not start another hide after a resolved hide while the menu remains open', async () => {
    const nextHide = new Promise<void>(() => undefined)
    const hide = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(nextHide)
    const controller = createNativePreviewVisibilityController({ hide, show: vi.fn() })

    controller.setContextMenuOpen(true)
    controller.setReady(true)
    await Promise.resolve()

    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('does not resynchronize visibility after setReady(false) during a delayed hide', async () => {
    let resolveHide!: () => void
    const hidden = new Promise<void>((resolve) => { resolveHide = resolve })
    const hide = vi.fn(() => hidden)
    const show = vi.fn()
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setContextMenuOpen(true)
    controller.setReady(true)
    controller.setReady(false)
    resolveHide()
    await Promise.resolve()

    expect(hide).toHaveBeenCalledTimes(1)
    expect(show).not.toHaveBeenCalled()
  })

  it('keeps the newer preview visible when an older show resolves after the menu closes', async () => {
    let resolveShowA!: () => void
    let resolveShowB!: () => void
    const showA = new Promise<void>((resolve) => { resolveShowA = resolve })
    const showB = new Promise<void>((resolve) => { resolveShowB = resolve })
    let nativeVisible = false
    const show = vi.fn()
      .mockImplementationOnce(() => {
        nativeVisible = true
        return showA
      })
      .mockImplementationOnce(() => {
        nativeVisible = true
        return showB
      })
    const hide = vi.fn(() => { nativeVisible = false })
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setReady(true)
    controller.setContextMenuOpen(true)
    controller.setContextMenuOpen(false)
    resolveShowB()
    await Promise.resolve()
    expect(nativeVisible).toBe(true)

    resolveShowA()
    await Promise.resolve()

    expect(nativeVisible).toBe(true)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('keeps the newer preview visible when an older show rejects after the menu closes', async () => {
    let rejectShowA!: (reason: Error) => void
    const showA = new Promise<void>((_, reject) => { rejectShowA = reject })
    let nativeVisible = false
    const show = vi.fn()
      .mockImplementationOnce(() => {
        nativeVisible = true
        return showA
      })
      .mockImplementationOnce(() => { nativeVisible = true })
    const hide = vi.fn(() => { nativeVisible = false })
    const controller = createNativePreviewVisibilityController({ hide, show })

    controller.setReady(true)
    controller.setContextMenuOpen(true)
    controller.setContextMenuOpen(false)
    rejectShowA(new Error('show A failed'))
    await Promise.resolve()

    expect(nativeVisible).toBe(true)
    expect(hide).toHaveBeenCalledTimes(1)
  })
})
