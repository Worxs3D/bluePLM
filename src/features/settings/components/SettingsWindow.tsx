import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { Toast } from '@/components/core'
import { CommandConfirmContainer } from '@/components/shared/Dialogs/CommandConfirmContainer'
import { HostWindowProvider, registerChildHost } from '@/hooks/useHostWindow'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { SettingsPanel } from './SettingsPanel'
import { hasLayerAboveSettings, SETTINGS_MODAL_LAYER_ATTR } from './settingsModalLayers'
import {
  mirrorDocumentStyles,
  SETTINGS_WINDOW_ATTR,
  SETTINGS_WINDOW_FRAME,
  settingsWindowFeatures,
} from './settingsWindowLayout'

/** How often the window is checked for having been closed, in case its `pagehide` was missed. */
const CLOSED_POLL_MS = 1000

/**
 * The window this module opened, kept across a remount: React's development double mount (and a
 * quick close-and-reopen) would otherwise close the window and open another in its place.
 */
let current: { child: Window; closeTimer: ReturnType<typeof setTimeout> | null } | null = null

function acquireWindow(): Window | null {
  if (current && !current.child.closed) {
    if (current.closeTimer) clearTimeout(current.closeTimer)
    current.closeTimer = null
    return current.child
  }
  const child = window.open(
    '',
    SETTINGS_WINDOW_FRAME,
    settingsWindowFeatures(window.screen.availWidth, window.screen.availHeight),
  )
  // A cross-origin or blocked window cannot be rendered into.
  if (!child || !canRenderInto(child)) {
    child?.close()
    return null
  }
  current = { child, closeTimer: null }
  return child
}

function releaseWindow(child: Window): void {
  if (current?.child !== child) return
  const entry = current
  entry.closeTimer = setTimeout(() => {
    if (current === entry) current = null
    if (!child.closed) child.close()
  }, 0)
}

function canRenderInto(child: Window): boolean {
  try {
    return !!child.document.body
  } catch {
    return false
  }
}

/**
 * Settings in a window of its own (desktop): it moves, resizes, goes to another screen, and the
 * main window stays usable behind it. The window is an empty same-origin page that the main
 * window renders into through a portal, so Settings runs on the main window's store as before;
 * only the document differs, which is why components under it use `useHostWindow()` for their
 * listeners. Electron opens it with the saved bounds (`electron/settingsWindow.ts`).
 *
 * `onUnavailable` is called when no window could be opened (the caller shows the floating panel).
 */
export function SettingsWindow({ onUnavailable }: { onUnavailable: () => void }) {
  const [host, setHost] = useState<{ child: Window; root: HTMLElement } | null>(null)
  const openRequest = usePDMStore((s) => s.settingsOpenRequest)

  useLayoutEffect(() => {
    const child = acquireWindow()
    if (!child) {
      log.warn('[Settings]', 'Could not open the settings window; showing the floating panel')
      onUnavailable()
      return
    }
    const doc = child.document
    doc.title = t('settings.title')
    const stopStyles = mirrorDocumentStyles(document, doc)
    doc.body.className = document.body.className
    const root = doc.createElement('div')
    root.setAttribute(SETTINGS_WINDOW_ATTR, '')
    root.setAttribute(SETTINGS_MODAL_LAYER_ATTR, '')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', t('settings.title'))
    root.className =
      'fixed inset-0 flex flex-col overflow-hidden bg-ui-bg font-ui text-ui-fg antialiased'
    doc.body.appendChild(root)
    const unregister = registerChildHost(child)
    setHost({ child, root })

    const closeSettings = () => usePDMStore.getState().closeSettings()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (hasLayerAboveSettings(doc)) return
      e.preventDefault()
      closeSettings()
    }
    // The user closed the window.
    const onChildHide = () => closeSettings()
    const poll = setInterval(() => {
      if (child.closed) closeSettings()
    }, CLOSED_POLL_MS)
    // The main window reloads or closes: its settings window goes with it.
    const onMainHide = () => child.close()

    child.addEventListener('keydown', onKeyDown)
    child.addEventListener('pagehide', onChildHide)
    window.addEventListener('pagehide', onMainHide)
    child.focus()

    return () => {
      clearInterval(poll)
      window.removeEventListener('pagehide', onMainHide)
      // Always stop following the main window's styles, or the observer outlives the window.
      try {
        stopStyles()
        if (!child.closed) {
          child.removeEventListener('keydown', onKeyDown)
          child.removeEventListener('pagehide', onChildHide)
          root.remove()
        }
      } catch (error) {
        log.warn('[Settings]', 'Settings window teardown failed', { error: String(error) })
      }
      unregister()
      setHost(null)
      releaseWindow(child)
    }
  }, [onUnavailable])

  // Asked to open while already open (a shortcut or a link in the main window): come to the front.
  useEffect(() => {
    if (host && !host.child.closed) host.child.focus()
  }, [host, openRequest])

  if (!host) return null
  return createPortal(
    <HostWindowProvider value={host.child}>
      <SettingsPanel showHeader={false} />
      <CommandConfirmContainer />
      <Toast />
    </HostWindowProvider>,
    host.root,
  )
}
