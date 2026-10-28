/**
 * Extension IPC handlers (main process).
 *
 * What this does: browse the extension store, install a package from the store or
 * from a file into userData/extensions, list what is installed, and uninstall.
 *
 * What it does not do: run extension code. There is no sandboxed runtime on the
 * desktop. The hidden "Extension Host" window that used to be created here never
 * executed an extension (its page never loaded host.ts and the bundle reader
 * returned an empty string), so it was removed together with its IPC, rather than
 * keep a window alive for weeks that reported extensions as active. The native
 * runtime is described in .cursor/plans/extensions-native-runtime.plan.md.
 */

import { BrowserWindow, ipcMain, app, type IpcMainInvokeEvent } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

import { PACKAGE_SHA256_HEADER, assertPackageIntegrity } from './integrity'
import {
  installPackage,
  readInstalledPackages,
  removeInstalledPackage,
  type ExtensionVerification,
} from './install'
import { isValidExtensionId, isValidExtensionVersion, type ExtensionManifest } from './validation'

// ============================================
// Types
// ============================================

export interface ExtensionHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

interface InstalledExtensionRecord {
  manifest: ExtensionManifest
  state: 'installed'
  verification: ExtensionVerification
  installedAt: Date
}

/** What `extensions:get-all` returns per extension. */
export interface InstalledExtensionInfo {
  manifest: ExtensionManifest
  state: 'installed'
  verification: ExtensionVerification
  installedAt: string
}

/** Payload of `extension:state-change`. Main sends only these two states. */
export interface ExtensionStateChangePayload {
  extensionId: string
  state: 'installed' | 'not-installed'
  timestamp: number
}

export interface ExtensionInstallResponse {
  success: boolean
  extensionId?: string
  version?: string
  error?: string
  warning?: string
  requiresAcknowledgment?: boolean
}

interface StoreListingRow {
  id: string
  publisher_slug: string
  name: string
  display_name: string
  description: string | null
  icon_url: string | null
  category: 'sandboxed' | 'native'
  categories: string[]
  tags: string[]
  verified: boolean
  featured: boolean
  download_count: number
  latest_version: string | null
  created_at: string
}

// ============================================
// Module State
// ============================================

const STORE_API_URL = 'https://extensions.blueplm.io/api'

/** Largest package the store install will download (bytes). */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

let deps: ExtensionHandlerDependencies | null = null
let mainWindow: BrowserWindow | null = null

const installedExtensions = new Map<string, InstalledExtensionRecord>()

const HANDLED_CHANNELS = [
  'extensions:get-all',
  'extensions:get-extension',
  'extensions:fetch-store',
  'extensions:search-store',
  'extensions:get-store-extension',
  'extensions:install',
  'extensions:install-from-file',
  'extensions:uninstall',
] as const

// ============================================
// Helpers
// ============================================

function getExtensionsPath(): string {
  const extensionsPath = path.join(app.getPath('userData'), 'extensions')
  if (!fs.existsSync(extensionsPath)) {
    fs.mkdirSync(extensionsPath, { recursive: true })
  }
  return extensionsPath
}

function loadExtensionsFromDisk(): void {
  installedExtensions.clear()
  try {
    const packages = readInstalledPackages(getExtensionsPath(), (folder, reason) =>
      deps?.log(`Skipping extension folder ${folder}: ${reason}`),
    )
    for (const pkg of packages) {
      installedExtensions.set(pkg.manifest.id, {
        manifest: pkg.manifest,
        state: 'installed',
        verification: pkg.verification,
        installedAt: pkg.installedAt,
      })
    }
    deps?.log(`Loaded ${installedExtensions.size} extensions from disk`)
  } catch (error) {
    deps?.logError('Failed to scan extensions directory', { error: String(error) })
  }
}

function toInfo(record: InstalledExtensionRecord): InstalledExtensionInfo {
  return {
    manifest: record.manifest,
    state: record.state,
    verification: record.verification,
    installedAt: record.installedAt.toISOString(),
  }
}

function notifyStateChange(extensionId: string, state: ExtensionStateChangePayload['state']): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const payload: ExtensionStateChangePayload = { extensionId, state, timestamp: Date.now() }
    mainWindow.webContents.send('extension:state-change', payload)
  }
}

/** Mutating handlers answer only the main window's renderer. */
function isMainWindowSender(event: IpcMainInvokeEvent): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}

function mapStoreListing(ext: StoreListingRow) {
  return {
    id: ext.id,
    extensionId: `${ext.publisher_slug}.${ext.name}`, // Must match manifest ID format
    publisher: {
      id: ext.publisher_slug,
      name: ext.publisher_slug,
      slug: ext.publisher_slug,
      verified: ext.verified,
    },
    name: ext.display_name || ext.name,
    description: ext.description || undefined,
    iconUrl: ext.icon_url || undefined,
    repositoryUrl: '',
    license: 'MIT',
    category: ext.category,
    categories: ext.categories || [],
    tags: ext.tags || [],
    verified: ext.verified,
    featured: ext.featured,
    downloadCount: ext.download_count || 0,
    latestVersion: ext.latest_version || '0.0.0',
    createdAt: ext.created_at,
    updatedAt: ext.created_at,
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Package is larger than ${MAX_DOWNLOAD_BYTES / (1024 * 1024)} MB`)
  }
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Package is larger than ${MAX_DOWNLOAD_BYTES / (1024 * 1024)} MB`)
  }
  return buffer
}

function recordInstall(
  manifest: ExtensionManifest,
  verification: ExtensionVerification,
  installedAt: Date,
): void {
  installedExtensions.set(manifest.id, { manifest, state: 'installed', verification, installedAt })
  notifyStateChange(manifest.id, 'installed')
}

// ============================================
// IPC Handler Registration
// ============================================

export function registerExtensionHandlers(
  window: BrowserWindow,
  dependencies: ExtensionHandlerDependencies,
): void {
  deps = dependencies
  mainWindow = window

  loadExtensionsFromDisk()

  ipcMain.handle('extensions:get-all', async (): Promise<InstalledExtensionInfo[]> => {
    return Array.from(installedExtensions.values()).map(toInfo)
  })

  ipcMain.handle(
    'extensions:get-extension',
    async (_event, extensionId: string): Promise<InstalledExtensionInfo | undefined> => {
      const record = installedExtensions.get(extensionId)
      return record ? toInfo(record) : undefined
    },
  )

  ipcMain.handle('extensions:fetch-store', async () => {
    try {
      const response = await fetch(`${STORE_API_URL}/store/extensions?limit=100`)
      if (!response.ok) {
        throw new Error(`Store API returned ${response.status}: ${response.statusText}`)
      }
      const result = (await response.json()) as { success: boolean; data?: StoreListingRow[] }
      if (!result.success || !result.data) {
        throw new Error('Store API returned unsuccessful response')
      }
      return result.data.map(mapStoreListing)
    } catch (error) {
      deps?.logError('Failed to fetch store extensions', { error: String(error) })
      return []
    }
  })

  ipcMain.handle(
    'extensions:search-store',
    async (
      _event,
      request: {
        query?: string
        category?: string
        verifiedOnly?: boolean
        sort?: string
        page?: number
        pageSize?: number
      },
    ) => {
      try {
        const params = new URLSearchParams()
        if (request.query) params.set('q', request.query)
        if (request.category) params.set('categories', request.category)
        if (request.verifiedOnly) params.set('verified', 'true')
        if (request.sort) params.set('sort', request.sort)
        params.set('page', String(request.page || 1))
        params.set('limit', String(request.pageSize || 50))

        const response = await fetch(`${STORE_API_URL}/store/extensions?${params}`)
        if (!response.ok) {
          throw new Error(`Store API returned ${response.status}`)
        }
        const result = (await response.json()) as {
          success: boolean
          data?: StoreListingRow[]
          pagination?: { page: number; limit: number; total: number; total_pages: number }
        }
        return {
          extensions: (result.data || []).map(mapStoreListing),
          total: result.pagination?.total || 0,
          page: result.pagination?.page || 1,
          hasMore: (result.pagination?.page || 1) < (result.pagination?.total_pages || 1),
        }
      } catch (error) {
        deps?.logError('Failed to search store extensions', { error: String(error) })
        return { extensions: [], total: 0, page: 0, hasMore: false }
      }
    },
  )

  ipcMain.handle('extensions:get-store-extension', async (_event, extensionId: string) => {
    try {
      const response = await fetch(
        `${STORE_API_URL}/store/extensions/${encodeURIComponent(extensionId)}`,
      )
      if (response.status === 404) return undefined
      if (!response.ok) {
        throw new Error(`Store API returned ${response.status}`)
      }
      const result = (await response.json()) as {
        success: boolean
        data?: {
          id: string
          name: string
          display_name: string
          description: string | null
          icon_url: string | null
          category: 'sandboxed' | 'native'
          categories: string[]
          tags: string[]
          verified: boolean
          featured: boolean
          download_count: number
          created_at: string
          updated_at?: string
          repository_url?: string
          license?: string
          publisher: { id: string; name: string; slug: string; verified: boolean }
          latest_version?: { version: string } | null
        }
      }
      if (!result.success || !result.data) return undefined

      const ext = result.data
      const publisherSlug = ext.publisher?.slug || ext.publisher?.name || ''
      return {
        id: ext.id,
        extensionId: `${publisherSlug}.${ext.name}`,
        publisher: {
          id: ext.publisher?.id || '',
          name: ext.publisher?.name || '',
          slug: ext.publisher?.slug || '',
          verified: ext.publisher?.verified || false,
        },
        name: ext.display_name || ext.name,
        description: ext.description || undefined,
        iconUrl: ext.icon_url || undefined,
        repositoryUrl: ext.repository_url || '',
        license: ext.license || 'MIT',
        category: ext.category,
        categories: ext.categories || [],
        tags: ext.tags || [],
        verified: ext.verified,
        featured: ext.featured,
        downloadCount: ext.download_count || 0,
        latestVersion: ext.latest_version?.version || '0.0.0',
        createdAt: ext.created_at,
        updatedAt: ext.updated_at || ext.created_at,
      }
    } catch (error) {
      deps?.logError('Failed to get store extension', { error: String(error) })
      return undefined
    }
  })

  // Install from the store.
  // downloadId: the store's database UUID; manifestId: the publisher.name id the
  // package must carry. The store must state the package's SHA-256; no hash, or a
  // mismatch, refuses the install.
  ipcMain.handle(
    'extensions:install',
    async (
      event,
      downloadId: string,
      version?: string,
      manifestId?: string,
    ): Promise<ExtensionInstallResponse> => {
      if (!isMainWindowSender(event)) {
        return { success: false, error: 'Refused: request did not come from the main window' }
      }
      try {
        if (typeof downloadId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(downloadId)) {
          throw new Error('Invalid store download id')
        }
        if (version !== undefined && !isValidExtensionVersion(version)) {
          throw new Error(`Invalid version: ${JSON.stringify(version)}`)
        }
        if (manifestId !== undefined && !isValidExtensionId(manifestId)) {
          throw new Error(`Invalid extension id: ${JSON.stringify(manifestId)}`)
        }

        const downloadUrl = version
          ? `${STORE_API_URL}/store/extensions/${encodeURIComponent(downloadId)}/download/${encodeURIComponent(version)}`
          : `${STORE_API_URL}/store/extensions/${encodeURIComponent(downloadId)}/download`
        deps?.log(`Downloading extension package from: ${downloadUrl}`)

        const response = await fetch(downloadUrl, { redirect: 'follow' })
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`Extension not found: ${manifestId ?? downloadId}`)
          }
          throw new Error(`Download failed: ${response.status} ${response.statusText}`)
        }

        const data = await readBoundedBody(response)
        const sha256 = assertPackageIntegrity(data, response.headers.get(PACKAGE_SHA256_HEADER))

        const pkg = await installPackage(data, {
          extensionsPath: getExtensionsPath(),
          source: 'store',
          expectedId: manifestId,
          sha256,
        })
        recordInstall(pkg.manifest, pkg.verification, pkg.installedAt)
        deps?.log(`Installed extension ${pkg.manifest.id} v${pkg.manifest.version}`, { sha256 })

        return { success: true, extensionId: pkg.manifest.id, version: pkg.manifest.version }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps?.logError(`Failed to install extension: ${manifestId ?? downloadId}`, {
          error: message,
        })
        return { success: false, error: message }
      }
    },
  )

  // Install from a file (sideload).
  ipcMain.handle(
    'extensions:install-from-file',
    async (
      event,
      bpxPath: string,
      acknowledgeUnsigned?: boolean,
    ): Promise<ExtensionInstallResponse> => {
      if (!isMainWindowSender(event)) {
        return { success: false, error: 'Refused: request did not come from the main window' }
      }
      try {
        if (!acknowledgeUnsigned) {
          return {
            success: false,
            error:
              'Sideloaded extensions are not verified. You must acknowledge the security warning.',
            requiresAcknowledgment: true,
          }
        }
        if (typeof bpxPath !== 'string' || !bpxPath.toLowerCase().endsWith('.bpx')) {
          throw new Error('Extension package must have .bpx extension')
        }
        if (!fs.existsSync(bpxPath)) {
          throw new Error(`File not found: ${bpxPath}`)
        }

        const data = fs.readFileSync(bpxPath)
        const pkg = await installPackage(data, {
          extensionsPath: getExtensionsPath(),
          source: 'file',
          sourcePath: bpxPath,
        })
        recordInstall(pkg.manifest, pkg.verification, pkg.installedAt)
        deps?.log(`Sideloaded extension ${pkg.manifest.id} v${pkg.manifest.version}`)

        return {
          success: true,
          extensionId: pkg.manifest.id,
          version: pkg.manifest.version,
          warning: 'This extension was sideloaded and has not been verified by BluePLM.',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps?.logError(`Failed to sideload extension from: ${bpxPath}`, { error: message })
        return { success: false, error: message }
      }
    },
  )

  // Uninstall: delete the extension's folder, then forget it.
  ipcMain.handle(
    'extensions:uninstall',
    async (event, extensionId: string): Promise<{ success: boolean; error?: string }> => {
      if (!isMainWindowSender(event)) {
        return { success: false, error: 'Refused: request did not come from the main window' }
      }
      try {
        if (!isValidExtensionId(extensionId)) {
          throw new Error(`Invalid extension id: ${JSON.stringify(extensionId)}`)
        }
        removeInstalledPackage(getExtensionsPath(), extensionId)
        installedExtensions.delete(extensionId)
        notifyStateChange(extensionId, 'not-installed')
        deps?.log(`Uninstalled extension: ${extensionId}`)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps?.logError(`Failed to uninstall extension: ${extensionId}`, { error: message })
        return { success: false, error: message }
      }
    },
  )

  deps.log('Extension handlers registered')
}

export function unregisterExtensionHandlers(): void {
  for (const channel of HANDLED_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  mainWindow = null
}
