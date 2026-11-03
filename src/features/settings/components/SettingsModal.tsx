import { useCallback, useEffect, useState } from 'react'

import { usePDMStore } from '@/stores/pdmStore'
import { hasDesktop } from '@/lib/platform'
import { logSettings } from '@/lib/userActionLogger'

import { SettingsFloating } from './SettingsFloating'
import { SettingsWindow } from './SettingsWindow'

/**
 * Settings, mounted once in the app shell and opened through `openSettings(tab)`. It never blocks
 * the app: on the desktop it is a window of its own (`SettingsWindow`) that can be moved,
 * resized and put on another screen; on the web, or if that window cannot be opened, a floating
 * panel (`SettingsFloating`) that can be dragged and resized over the app. The shortcut that
 * opens and closes it (Ctrl+, by default) is the registry's `global.openSettings`.
 */
export function SettingsModal() {
  const open = usePDMStore((s) => s.settingsOpen)
  const [windowUnavailable, setWindowUnavailable] = useState(false)
  const onWindowUnavailable = useCallback(() => setWindowUnavailable(true), [])

  useEffect(() => {
    if (open) logSettings('Opened settings')
  }, [open])

  if (!open) return null
  if (hasDesktop() && !windowUnavailable)
    return <SettingsWindow onUnavailable={onWindowUnavailable} />
  return <SettingsFloating />
}
