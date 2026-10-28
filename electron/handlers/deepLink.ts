/**
 * Deep Link Protocol Handler
 *
 * Handles the blueplm:// protocol for deep linking from external sources
 * (e.g., "Install in BluePLM" button on extensions.blueplm.io)
 *
 * Supported URL formats:
 * - blueplm://install/{extension-id} - Install extension from store
 * - blueplm://install/{extension-id}?version={version} - Install specific version
 */

import { BrowserWindow, ipcMain } from 'electron'

import { isValidExtensionId, isValidExtensionVersion } from './extensions/validation'

// ============================================
// Types
// ============================================

export interface DeepLinkHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

export interface ParsedDeepLink {
  action: 'install' | 'unknown'
  extensionId?: string
  version?: string
  /** Set when the link was recognised but refused (invalid id or version). */
  error?: string
  raw: string
}

export interface DeepLinkResult {
  success: boolean
  action?: string
  extensionId?: string
  error?: string
}

// ============================================
// Module State
// ============================================

let deps: DeepLinkHandlerDependencies | null = null
let mainWindow: BrowserWindow | null = null
let pendingDeepLink: string | null = null

// ============================================
// URL Parsing
// ============================================

/**
 * Parse a blueplm:// URL into structured data
 */
export function parseDeepLink(url: string): ParsedDeepLink {
  const result: ParsedDeepLink = {
    action: 'unknown',
    raw: url,
  }

  try {
    // Handle both blueplm:// and blueplm: formats (Windows sometimes drops //)
    const normalizedUrl = url.replace(/^blueplm:(?!\/\/)/, 'blueplm://')
    const parsed = new URL(normalizedUrl)

    // Protocol should be blueplm:
    if (parsed.protocol !== 'blueplm:') {
      return result
    }

    // Get the path (hostname + pathname for custom protocols)
    // For blueplm://install/ext-id, hostname is 'install', pathname is '/ext-id'
    const action = parsed.hostname || parsed.pathname.split('/')[1]
    const pathParts = parsed.pathname.split('/').filter(Boolean)

    if (action === 'install') {
      result.action = 'install'

      // Extension ID is the first path segment after action
      // Could be in pathname (blueplm://install/ext-id) or after hostname.
      // It must be a manifest id (publisher.name, schemas/extension-v1.schema.json);
      // anything else is refused, never passed on to the renderer.
      const extensionId = pathParts[0] || pathParts[1]
      if (extensionId) {
        if (!isValidExtensionId(extensionId)) {
          deps?.logError('Deep link refused: invalid extension ID', { extensionId })
          result.error = 'Invalid extension ID'
          return result
        }
        result.extensionId = extensionId
      }

      // Version from query params
      const version = parsed.searchParams.get('version')
      if (version !== null) {
        if (!isValidExtensionVersion(version)) {
          deps?.logError('Deep link refused: invalid version', { version })
          result.extensionId = undefined
          result.error = 'Invalid version'
          return result
        }
        result.version = version
      }
    }
  } catch (error) {
    deps?.logError('Failed to parse deep link URL', { url, error: String(error) })
  }

  return result
}

// ============================================
// Deep Link Handling
// ============================================

/**
 * Handle a deep link URL
 * Called from main process when app receives a deep link
 */
export async function handleDeepLink(url: string): Promise<DeepLinkResult> {
  deps?.log(`Handling deep link: ${url}`)

  const parsed = parseDeepLink(url)

  if (parsed.action === 'unknown') {
    deps?.logError('Unknown deep link action', { url })
    return {
      success: false,
      error: 'Unknown or malformed deep link URL',
    }
  }

  if (parsed.action === 'install') {
    if (parsed.error) {
      return { success: false, action: 'install', error: parsed.error }
    }
    if (!parsed.extensionId) {
      deps?.logError('Install deep link missing extension ID', { url })
      return {
        success: false,
        action: 'install',
        error: 'Missing extension ID',
      }
    }

    return handleInstallDeepLink(parsed.extensionId, parsed.version)
  }

  return {
    success: false,
    error: `Unhandled action: ${parsed.action}`,
  }
}

/**
 * Handle install action from deep link
 */
async function handleInstallDeepLink(
  extensionId: string,
  version?: string,
): Promise<DeepLinkResult> {
  deps?.log(`Deep link install: ${extensionId}${version ? `@${version}` : ''}`)

  // Ensure window exists and is focused
  if (!mainWindow || mainWindow.isDestroyed()) {
    deps?.logError('Cannot handle deep link: main window not available')
    // Store for later when window is ready
    pendingDeepLink = `blueplm://install/${extensionId}${version ? `?version=${version}` : ''}`
    return {
      success: false,
      action: 'install',
      extensionId,
      error: 'Application window not ready',
    }
  }

  // Focus the window
  focusMainWindow()

  // Send IPC to renderer to trigger installation
  // The renderer will handle showing UI, confirmation dialogs, etc.
  mainWindow.webContents.send('deep-link:install-extension', {
    extensionId,
    version,
    timestamp: Date.now(),
  })

  return {
    success: true,
    action: 'install',
    extensionId,
  }
}

/**
 * Focus the main window
 */
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Process any pending deep link
 * Called after main window is ready
 */
export function processPendingDeepLink(): void {
  if (pendingDeepLink) {
    deps?.log('Processing pending deep link')
    const url = pendingDeepLink
    pendingDeepLink = null
    handleDeepLink(url)
  }
}

/**
 * Check if there's a pending deep link
 */
export function hasPendingDeepLink(): boolean {
  return pendingDeepLink !== null
}

/**
 * Store a deep link for later processing
 */
export function storePendingDeepLink(url: string): void {
  deps?.log(`Storing pending deep link: ${url}`)
  pendingDeepLink = url
}

// ============================================
// IPC Handler Registration
// ============================================

export function registerDeepLinkHandlers(
  window: BrowserWindow,
  dependencies: DeepLinkHandlerDependencies,
): void {
  deps = dependencies
  mainWindow = window

  // Handler for renderer to acknowledge deep link processing
  ipcMain.handle(
    'deep-link:acknowledge',
    (_event, extensionId: string, success: boolean, error?: string) => {
      if (success) {
        deps?.log(`Deep link install acknowledged: ${extensionId}`)
      } else {
        deps?.logError(`Deep link install failed: ${extensionId}`, { error })
      }
      return { success: true }
    },
  )

  deps.log('Deep link handlers registered')

  // Process any pending deep link now that window is ready
  // Small delay to ensure renderer is fully loaded
  setTimeout(() => {
    processPendingDeepLink()
  }, 1000)
}

export function unregisterDeepLinkHandlers(): void {
  ipcMain.removeHandler('deep-link:acknowledge')
  mainWindow = null
}

/**
 * Update the main window reference
 * Called if window is recreated
 */
export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window
}

/**
 * Set dependencies (for initialization before handler registration)
 */
export function setDeepLinkDependencies(dependencies: DeepLinkHandlerDependencies): void {
  deps = dependencies
}
