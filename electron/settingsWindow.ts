// Settings in a window of its own (the renderer's SettingsWindow): the main window opens an empty
// same-origin page with `window.open('', SETTINGS_WINDOW_FRAME)` and renders Settings into it, so
// the window shares the main window's renderer and store. This module lets that one window open,
// gives it the bounds it was last closed with (on a display that is still attached), and keeps it
// from navigating or opening anything itself.
import {
  BrowserWindow,
  screen,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from 'electron'
import fs from 'fs'
import path from 'path'

import { installNavigationGuard, openExternalSafely } from './navigationGuard'

/** Must equal `SETTINGS_WINDOW_FRAME` in src/features/settings/components/settingsWindowLayout.ts. */
export const SETTINGS_WINDOW_FRAME = 'blueplm-settings'

const MIN_WIDTH = 640
const MIN_HEIGHT = 420

interface SettingsWindowState extends Rectangle {
  isMaximized: boolean
}

function stateFile(userData: string): string {
  return path.join(userData, 'settings-window-state.json')
}

export function isSettingsWindowRequest(url: string, frameName: string): boolean {
  return frameName === SETTINGS_WINDOW_FRAME && (url === '' || url === 'about:blank')
}

function isState(value: unknown): value is SettingsWindowState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k]))
}

function loadState(userData: string): SettingsWindowState | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFile(userData), 'utf-8'))
    return isState(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Saved bounds when at least the top strip of the window (where it is grabbed) lies on an attached
 * display; else null, and the window opens centred on the main window's display.
 */
export function restorableBounds(
  saved: Rectangle | null,
  workAreas: readonly Rectangle[],
): Rectangle | null {
  if (!saved) return null
  const width = Math.max(MIN_WIDTH, Math.round(saved.width))
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height))
  const grab = { x: saved.x, y: saved.y, width, height: 40 }
  const visible = workAreas.some((a) => {
    const overlapX = Math.min(grab.x + grab.width, a.x + a.width) - Math.max(grab.x, a.x)
    const overlapY = Math.min(grab.y + grab.height, a.y + a.height) - Math.max(grab.y, a.y)
    return overlapX >= 100 && overlapY >= 20
  })
  return visible ? { x: Math.round(saved.x), y: Math.round(saved.y), width, height } : null
}

/** Options for the settings window, answered from the main window's `setWindowOpenHandler`. */
export function settingsWindowOptions(
  owner: BrowserWindow,
  userData: string,
): BrowserWindowConstructorOptions {
  const saved = loadState(userData)
  const bounds = restorableBounds(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
  )
  const options: BrowserWindowConstructorOptions = {
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    autoHideMenuBar: true,
    backgroundColor: '#181818',
    show: true,
  }
  if (bounds) return { ...options, ...bounds }
  // First open, or its display is gone: the old modal's size, centred over the main window.
  const area = screen.getDisplayMatching(owner.getBounds()).workArea
  const width = Math.max(MIN_WIDTH, Math.min(1200, area.width - 32))
  const height = Math.max(MIN_HEIGHT, Math.min(880, area.height - 32))
  return {
    ...options,
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  }
}

/** Wires up a settings window the main window just opened (`did-create-window`). */
export function adoptSettingsWindow(
  win: BrowserWindow,
  owner: BrowserWindow,
  options: { userData: string; allowDevServer: boolean; log: (message: string) => void },
): void {
  win.setMenu(null)
  if (loadState(options.userData)?.isMaximized) win.maximize()

  installNavigationGuard(win.webContents, {
    allowDevServer: options.allowDevServer,
    log: options.log,
  })
  // Links in a settings page open in the browser, as they do from the main window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url, options.log)
    return { action: 'deny' }
  })

  win.on('close', () => {
    try {
      const state: SettingsWindowState = {
        ...(win.isMaximized() ? win.getNormalBounds() : win.getBounds()),
        isMaximized: win.isMaximized(),
      }
      fs.writeFileSync(stateFile(options.userData), JSON.stringify(state, null, 2))
    } catch (error) {
      options.log('[SettingsWindow] Could not save its bounds: ' + String(error))
    }
  })

  // The renderer closes it when the main page goes; this covers the main window closing first.
  const closeWithOwner = () => {
    if (!win.isDestroyed()) win.close()
  }
  owner.once('closed', closeWithOwner)
  win.on('closed', () => {
    if (!owner.isDestroyed()) owner.removeListener('closed', closeWithOwner)
  })
  options.log('[SettingsWindow] Opened')
}
