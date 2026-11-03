// System handlers for Electron main process
import { app, ipcMain, BrowserWindow, clipboard } from 'electron'
import { installNavigationGuard, openExternalSafely } from '../navigationGuard'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// Module state
let mainWindow: BrowserWindow | null = null
let log: (message: string, data?: unknown) => void = console.log

// Analytics settings
function getAnalyticsSettingsPath(): string {
  return path.join(app.getPath('userData'), 'analytics-settings.json')
}

function writeAnalyticsEnabled(enabled: boolean): void {
  try {
    const settingsPath = getAnalyticsSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({ enabled }), 'utf8')
  } catch (error) {
    console.error('[Analytics] Failed to write settings:', error)
  }
}

/** Popped-out tab windows by key (one per key). */
const tabWindows = new Map<string, BrowserWindow>()

interface TabWindowRequest {
  key: string
  view: string
  title: string
  customData: Record<string, unknown> | null
  width: number
  height: number
}

const TAB_WINDOW_ID = /^[a-z0-9:_-]{1,64}$/i

/** Validate the renderer's request; null when anything is off. */
function parseTabWindowRequest(request: unknown): TabWindowRequest | null {
  if (!request || typeof request !== 'object') return null
  const r = request as Record<string, unknown>
  if (typeof r.key !== 'string' || !TAB_WINDOW_ID.test(r.key)) return null
  if (typeof r.view !== 'string' || !TAB_WINDOW_ID.test(r.view)) return null
  const title = typeof r.title === 'string' ? r.title.slice(0, 200) : 'BluePLM'
  let customData: Record<string, unknown> | null = null
  if (r.customData !== undefined && r.customData !== null) {
    if (typeof r.customData !== 'object' || Array.isArray(r.customData)) return null
    if (JSON.stringify(r.customData).length > 4096) return null
    customData = r.customData as Record<string, unknown>
  }
  const size = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(4000, Math.max(300, Math.round(value)))
      : fallback
  return {
    key: r.key,
    view: r.view,
    title,
    customData,
    width: size(r.width, 1000),
    height: size(r.height, 700),
  }
}

export interface SystemHandlerDependencies {
  log: (message: string, data?: unknown) => void
}

export function registerSystemHandlers(
  window: BrowserWindow,
  deps: SystemHandlerDependencies,
): void {
  mainWindow = window
  log = deps.log

  // App info handlers
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-platform', () => process.platform)
  ipcMain.handle('app:get-app-version', () => app.getVersion())

  // Analytics handlers
  ipcMain.handle('analytics:set-enabled', (_, enabled: boolean) => {
    writeAnalyticsEnabled(enabled)
    return { success: true }
  })

  // Machine identification
  ipcMain.handle('app:get-machine-id', () => {
    try {
      const hostname = require('os').hostname()
      const cpus = require('os').cpus()
      const cpuInfo = cpus[0]?.model || 'unknown'
      const raw = `${hostname}-${cpuInfo}-${process.platform}`
      const hash = crypto.createHash('sha256').update(raw).digest('hex')
      return hash.substring(0, 16)
    } catch {
      return 'unknown'
    }
  })

  ipcMain.handle('app:get-machine-name', () => {
    return require('os').hostname()
  })

  // Clipboard handlers
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('clipboard:read-text', () => {
    try {
      return { success: true, text: clipboard.readText() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Read file paths from clipboard (for Ctrl+V paste from Explorer)
  ipcMain.handle('clipboard:read-file-paths', () => {
    try {
      const formats = clipboard.availableFormats()

      // On Windows, copied files appear as 'FileNameW' or file URI
      // Check for file-related formats
      const hasFiles = formats.some(
        (f) => f.includes('FileNameW') || f.includes('text/uri-list') || f.includes('CF_HDROP'),
      )

      if (!hasFiles) {
        return { success: true, filePaths: [] }
      }

      // Try to read file paths based on platform
      if (process.platform === 'win32') {
        // On Windows, read the raw buffer and parse file paths
        const buffer = clipboard.readBuffer('FileNameW')
        if (buffer && buffer.length > 0) {
          // FileNameW is null-terminated UTF-16LE strings, double-null terminated
          const paths: string[] = []
          let start = 0

          for (let i = 0; i < buffer.length - 1; i += 2) {
            // Check for null character (0x00 0x00 in UTF-16LE)
            if (buffer[i] === 0 && buffer[i + 1] === 0) {
              if (i > start) {
                const pathStr = buffer.slice(start, i).toString('utf16le')
                if (pathStr && pathStr.length > 0) {
                  paths.push(pathStr)
                }
              }
              start = i + 2

              // Check for double-null (end of list)
              if (i + 3 < buffer.length && buffer[i + 2] === 0 && buffer[i + 3] === 0) {
                break
              }
            }
          }

          // Filter to only valid file paths and verify they exist
          const validPaths = paths.filter((p) => {
            try {
              return p && p.length > 2 && fs.existsSync(p)
            } catch {
              return false
            }
          })

          if (validPaths.length > 0) {
            log('[Clipboard] Read file paths from clipboard: ' + validPaths.length + ' files')
            return { success: true, filePaths: validPaths }
          }
        }
      }

      // Fallback: try text/uri-list format (works on some systems)
      const uriList = clipboard.read('text/uri-list')
      if (uriList) {
        const paths = uriList
          .split('\n')
          .map((uri) => uri.trim())
          .filter((uri) => uri.startsWith('file://'))
          .map((uri) => {
            // Convert file:// URI to path
            let filePath = decodeURIComponent(uri.replace('file://', ''))
            // On Windows, remove leading slash from /C:/path
            if (process.platform === 'win32' && filePath.startsWith('/')) {
              filePath = filePath.substring(1)
            }
            return filePath
          })
          .filter((p) => {
            try {
              return fs.existsSync(p)
            } catch {
              return false
            }
          })

        if (paths.length > 0) {
          log('[Clipboard] Read file paths from URI list: ' + paths.length + ' files')
          return { success: true, filePaths: paths }
        }
      }

      return { success: true, filePaths: [] }
    } catch (error) {
      log('[Clipboard] Error reading file paths: ' + String(error))
      return { success: false, filePaths: [], error: String(error) }
    }
  })

  // Titlebar handlers
  ipcMain.handle('app:get-titlebar-overlay-rect', () => {
    if (!mainWindow) return { x: 0, y: 0, width: 138, height: 38 }
    // getTitleBarOverlayRect may not exist on all Electron versions
    const win = mainWindow as BrowserWindow & {
      getTitleBarOverlayRect?: () => { x: number; y: number; width: number; height: number }
    }
    return win.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
  })

  ipcMain.handle(
    'app:set-titlebar-overlay',
    (_event, options: { color: string; symbolColor: string }) => {
      if (!mainWindow) return { success: false }
      try {
        if (mainWindow.setTitleBarOverlay) {
          mainWindow.setTitleBarOverlay({
            color: options.color,
            symbolColor: options.symbolColor,
            height: 36,
          })
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  )

  // App control
  ipcMain.handle('app:reload', () => {
    if (mainWindow) {
      mainWindow.webContents.reload()
      return { success: true }
    }
    return { success: false, error: 'No window' }
  })

  ipcMain.handle('app:request-focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const allWindows = BrowserWindow.getAllWindows()
      for (const win of allWindows) {
        if (win !== mainWindow && !win.isDestroyed()) {
          log('[Window] Closing child window: ' + win.getTitle())
          win.close()
        }
      }

      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()

      if (process.platform === 'darwin') {
        app.dock?.show()
      }

      return { success: true }
    }
    return { success: false, error: 'No window' }
  })

  // Performance window
  ipcMain.handle('app:open-performance-window', () => {
    const perfWindow = new BrowserWindow({
      width: 600,
      height: 500,
      title: 'Performance Monitor',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
    installNavigationGuard(perfWindow.webContents, { allowDevServer: isDev })
    perfWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
    if (isDev) {
      perfWindow.loadURL('http://localhost:5173/#/performance')
    } else {
      perfWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'), {
        hash: '/performance',
      })
    }

    return { success: true }
  })

  // A tab popped out into its own window (the renderer's TabWindow, `?mode=tab`). One window per
  // `key`: asking again focuses it. Popped-out windows close with the main window.
  ipcMain.handle('app:open-tab-window', (_event, request: unknown) => {
    const parsed = parseTabWindowRequest(request)
    if (!parsed) return { success: false, error: 'Invalid tab window request' }
    const existing = tabWindows.get(parsed.key)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return { success: true }
    }

    const win = new BrowserWindow({
      width: parsed.width,
      height: parsed.height,
      minWidth: 420,
      minHeight: 300,
      title: parsed.title,
      backgroundColor: '#0a1929',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Its timers (autosave, Auto inspection debounce) must run while it is not focused.
        backgroundThrottling: false,
      },
    })
    tabWindows.set(parsed.key, win)
    // The pop-out closes with the main window; the listener goes when the pop-out closes first,
    // so reopening it for weeks does not pile listeners onto the main window.
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const closeWithOwner = () => {
      if (!win.isDestroyed()) win.close()
    }
    owner?.once('closed', closeWithOwner)
    win.on('closed', () => {
      if (tabWindows.get(parsed.key) === win) tabWindows.delete(parsed.key)
      if (owner && !owner.isDestroyed()) owner.removeListener('closed', closeWithOwner)
    })

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
    installNavigationGuard(win.webContents, { allowDevServer: isDev, log })
    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
    const query: Record<string, string> = {
      mode: 'tab',
      view: parsed.view,
      title: parsed.title,
    }
    if (parsed.customData) {
      query.customData = Buffer.from(JSON.stringify(parsed.customData), 'utf8').toString('base64')
    }
    if (isDev) {
      void win.loadURL(`http://localhost:5173/?${new URLSearchParams(query).toString()}`)
    } else {
      win
        .loadFile(path.join(__dirname, '../dist/index.html'), { query })
        .catch((error) => log('[TabWindow] Load failed: ' + String(error)))
    }
    log('[TabWindow] Opened', { key: parsed.key, view: parsed.view })
    return { success: true }
  })

  // Last-resort repair for a corrupt Chromium IndexedDB backing store ("Internal error opening
  // backing store for indexedDB.open"). The renderer asks only after its own deleteDatabase
  // attempt failed. This drops every IndexedDB database of the app's session - the vault file
  // cache and the local sync index both live there and are rebuilt from the server and disk.
  ipcMain.handle('diagnostics:clear-indexeddb', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'No window' }
    }
    try {
      await mainWindow.webContents.session.clearStorageData({ storages: ['indexdb'] })
      log('[Main] Cleared IndexedDB storage on renderer request')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('[Main] Failed to clear IndexedDB storage', { error: message })
      return { success: false, error: message }
    }
  })

  // Zoom handlers
  ipcMain.handle('app:get-zoom-factor', () => {
    if (!mainWindow) return 1
    return mainWindow.webContents.getZoomFactor()
  })

  ipcMain.handle('app:set-zoom-factor', (_event, factor: number) => {
    if (!mainWindow) return { success: false }
    mainWindow.webContents.setZoomFactor(factor)
    mainWindow.webContents.send('zoom-changed', factor)
    return { success: true }
  })

  // Window size handlers
  ipcMain.handle('app:get-window-size', () => {
    if (!mainWindow) return { width: 1400, height: 900 }
    const bounds = mainWindow.getBounds()
    return { width: bounds.width, height: bounds.height }
  })

  ipcMain.handle('app:set-window-size', (_event, width: number, height: number) => {
    if (!mainWindow) return { success: false }
    mainWindow.setSize(width, height)
    return { success: true }
  })

  ipcMain.handle('app:reset-window-size', () => {
    if (!mainWindow) return { success: false }
    mainWindow.setSize(1400, 900)
    mainWindow.center()
    mainWindow.webContents.setZoomFactor(1)
    mainWindow.webContents.send('zoom-changed', 1)
    return { success: true }
  })

  ipcMain.on('window:close', () => mainWindow?.close())
}

export function unregisterSystemHandlers(): void {
  const handlers = [
    'app:get-version',
    'app:get-platform',
    'app:get-app-version',
    'analytics:set-enabled',
    'app:get-machine-id',
    'app:get-machine-name',
    'clipboard:write-text',
    'clipboard:read-text',
    'clipboard:read-file-paths',
    'app:get-titlebar-overlay-rect',
    'app:set-titlebar-overlay',
    'app:reload',
    'app:request-focus',
    'app:open-performance-window',
    'app:open-tab-window',
    'diagnostics:clear-indexeddb',
    'app:get-zoom-factor',
    'app:set-zoom-factor',
    'app:get-window-size',
    'app:set-window-size',
    'app:reset-window-size',
  ]

  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }

  ipcMain.removeAllListeners('window:close')
}
