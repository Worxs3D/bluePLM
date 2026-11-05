import { useCallback, useEffect, useRef, useState } from 'react'

import { usePDMStore } from '@/stores/pdmStore'
import { hasDesktop } from '@/lib/platform'
import { logSettings } from '@/lib/userActionLogger'

import { SettingsPanel } from './SettingsPanel'
import { SettingsWindow } from './SettingsWindow'
import { hasLayerAboveSettings, SETTINGS_MODAL_LAYER_ATTR } from './settingsModalLayers'

const LAYER = { [SETTINGS_MODAL_LAYER_ATTR]: '' }

/**
 * Settings, mounted once in the app shell and opened through `openSettings(tab)`. It opens as a
 * fixed modal over the blurred app (`SettingsDialog`). On the desktop its header's pop-out button
 * moves it into a window of its own (`SettingsWindow`) that can be moved, resized and put on
 * another screen; that window's own header puts it back. Closing Settings forgets the choice, so
 * the next open is the modal again. The shortcut that opens and closes it (Ctrl+, by default) is
 * the registry's `global.openSettings`.
 */
export function SettingsModal() {
  const open = usePDMStore((s) => s.settingsOpen)
  const [poppedOut, setPoppedOut] = useState(false)
  const [windowUnavailable, setWindowUnavailable] = useState(false)
  const onWindowUnavailable = useCallback(() => setWindowUnavailable(true), [])
  const popOut = useCallback(() => {
    logSettings('Popped settings out into a window')
    setPoppedOut(true)
  }, [])
  const dockBack = useCallback(() => {
    logSettings('Put settings back in the main window')
    setPoppedOut(false)
  }, [])

  useEffect(() => {
    if (open) logSettings('Opened settings')
    else setPoppedOut(false)
  }, [open])

  if (!open) return null
  const canPopOut = hasDesktop() && !windowUnavailable
  if (canPopOut && poppedOut)
    return <SettingsWindow onUnavailable={onWindowUnavailable} onDockBack={dockBack} />
  return <SettingsDialog onPopOut={canPopOut ? popOut : undefined} />
}

/**
 * Settings as a modal in the app window: centred, a fixed size, over a blurred scrim that closes
 * it when clicked. Escape closes it unless a layer above it is open.
 *
 * It sits at z-[45], under every dialog (z-50 and up), so confirmations and editors opened from
 * a settings page appear above it.
 */
function SettingsDialog({ onPopOut }: { onPopOut?: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeSettings = usePDMStore((s) => s.closeSettings)

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (hasLayerAboveSettings()) return
      e.preventDefault()
      usePDMStore.getState().closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocus?.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      {...LAYER}
      data-native-preview-overlay="modal"
      className="fixed inset-0 z-[45] flex items-center justify-center font-ui antialiased"
    >
      <div
        {...LAYER}
        aria-hidden
        className="absolute inset-0 bg-[var(--ui-scrim)] backdrop-blur-sm animate-fade-in"
        onMouseDown={closeSettings}
      />
      <div
        {...LAYER}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        className="relative flex h-[min(880px,calc(100vh-32px))] w-[min(1200px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-ui-border bg-ui-bg text-ui-fg shadow-[0_24px_64px_rgb(0_0_0/0.45)] outline-none focus-visible:outline-none animate-dialog-in"
      >
        <SettingsPanel variant="dialog" onPopOut={onPopOut} />
      </div>
    </div>
  )
}
