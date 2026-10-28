/**
 * Native extension IPC and the `blueplm-ext://` protocol (main process).
 *
 *   extensions:native-prepare  download (or reuse) a package, verify its SHA-256,
 *                              extract it, and allow the protocol to serve it
 *   extensions:native-prune    drop cached packages the org no longer uses
 *   extensions:native-inspect  admin upload: pick a .bpx and validate it
 *
 * The renderer imports `blueplm-ext://<sha256>/client/index.js`. The protocol
 * serves only folders prepared (and so verified) in this session.
 */

import { app, BrowserWindow, dialog, ipcMain, protocol, type IpcMainInvokeEvent } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import {
  NATIVE_EXTENSION_SCHEME,
  inspectNativePackage,
  prepareNativePackage,
  pruneNativeCache,
  resolveNativeAsset,
  type InspectedNativePackage,
} from './nativeCache'
import type { ExtensionManifest } from './validation'

export interface NativeExtensionDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

export const NATIVE_EXTENSION_SCHEME_PRIVILEGE: Electron.CustomScheme = {
  scheme: NATIVE_EXTENSION_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}

/** Largest package the desktop will download (bytes). */
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024

/** Content-addressed by SHA-256, so a response never changes. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const CHANNELS = [
  'extensions:native-prepare',
  'extensions:native-prune',
  'extensions:native-inspect',
] as const

let deps: NativeExtensionDependencies | null = null
let mainWindow: BrowserWindow | null = null
/** Hashes prepared (verified and extracted) in this session; the protocol serves only these. */
const verifiedShas = new Set<string>()

export interface NativePrepareRequest {
  extensionId: string
  version: string
  sha256: string
  /** A short-lived signed URL for the package in the org's storage. */
  downloadUrl: string
}

export type NativePrepareResponse =
  | {
      success: true
      sha256: string
      baseUrl: string
      clientEntryUrl: string
      manifest: ExtensionManifest
      cached: boolean
    }
  | { success: false; error: string }

export type NativeInspectResponse =
  | ({ success: true } & InspectedNativePackage)
  | { success: false; canceled?: boolean; error?: string }

export function getNativeCacheDir(): string {
  return path.join(app.getPath('userData'), 'native-extensions')
}

function isMainWindowSender(event: IpcMainInvokeEvent): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}

async function downloadPackage(downloadUrl: string): Promise<Uint8Array> {
  let url: URL
  try {
    url = new URL(downloadUrl)
  } catch {
    throw new Error('Invalid package download URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Package download URL must be http(s)')
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Package download failed: ${response.status} ${response.statusText}`)
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_PACKAGE_BYTES) {
    throw new Error('Package is larger than 100 MB')
  }
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > MAX_PACKAGE_BYTES) throw new Error('Package is larger than 100 MB')
  return data
}

function registerProtocol(): void {
  protocol.handle(NATIVE_EXTENSION_SCHEME, async (request) => {
    const resolved = resolveNativeAsset(getNativeCacheDir(), verifiedShas, request.url)
    const cors = { 'Access-Control-Allow-Origin': '*' }
    if (!resolved.ok) {
      return new Response(null, { status: resolved.status, headers: { ...cors, 'Cache-Control': 'no-store' } })
    }
    try {
      const body = await fs.promises.readFile(resolved.filePath)
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': resolved.mimeType,
          'Content-Length': String(body.length),
          'Cache-Control': IMMUTABLE_CACHE_CONTROL,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      deps?.logError('[NativeExt] Failed to serve asset', { url: request.url, error: String(error) })
      return new Response(null, { status: 404, headers: { ...cors, 'Cache-Control': 'no-store' } })
    }
  })
}

export function registerNativeExtensionHandlers(
  window: BrowserWindow,
  dependencies: NativeExtensionDependencies,
): void {
  deps = dependencies
  mainWindow = window

  try {
    registerProtocol()
  } catch (error) {
    deps.logError('[NativeExt] Failed to register protocol', { error: String(error) })
  }

  ipcMain.handle(
    'extensions:native-prepare',
    async (event, request: NativePrepareRequest): Promise<NativePrepareResponse> => {
      if (!isMainWindowSender(event)) {
        return { success: false, error: 'Refused: request did not come from the main window' }
      }
      try {
        const prepared = await prepareNativePackage(
          getNativeCacheDir(),
          { extensionId: request?.extensionId, version: request?.version, sha256: request?.sha256 },
          () => downloadPackage(request.downloadUrl),
        )
        verifiedShas.add(prepared.sha256)
        deps?.log(`[NativeExt] Prepared ${request.extensionId} ${request.version}`, {
          sha256: prepared.sha256,
          cached: prepared.cached,
        })
        return {
          success: true,
          sha256: prepared.sha256,
          baseUrl: prepared.baseUrl,
          clientEntryUrl: prepared.clientEntryUrl,
          manifest: prepared.manifest,
          cached: prepared.cached,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps?.logError(`[NativeExt] Prepare failed for ${String(request?.extensionId)}`, {
          error: message,
        })
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    'extensions:native-prune',
    async (event, keepShas: string[]): Promise<{ success: boolean; removed: string[]; error?: string }> => {
      if (!isMainWindowSender(event)) {
        return { success: false, removed: [], error: 'Refused: request did not come from the main window' }
      }
      try {
        const keep = Array.isArray(keepShas) ? keepShas.filter((s) => typeof s === 'string') : []
        const removed = pruneNativeCache(getNativeCacheDir(), keep)
        for (const sha of removed) verifiedShas.delete(sha)
        if (removed.length > 0) deps?.log('[NativeExt] Pruned cached packages', { removed })
        return { success: true, removed }
      } catch (error) {
        return { success: false, removed: [], error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle('extensions:native-inspect', async (event): Promise<NativeInspectResponse> => {
    if (!isMainWindowSender(event) || !mainWindow) {
      return { success: false, error: 'Refused: request did not come from the main window' }
    }
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a native extension package',
      filters: [{ name: 'BluePLM extension', extensions: ['bpx'] }],
      properties: ['openFile'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return { success: false, canceled: true }
    try {
      const filePath = picked.filePaths[0]
      const stat = fs.statSync(filePath)
      if (stat.size > MAX_PACKAGE_BYTES) throw new Error('Package is larger than 100 MB')
      const inspected = await inspectNativePackage(fs.readFileSync(filePath), app.getVersion())
      return { success: true, ...inspected }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function unregisterNativeExtensionHandlers(): void {
  for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  try {
    protocol.unhandle(NATIVE_EXTENSION_SCHEME)
  } catch {
    // Not registered.
  }
  mainWindow = null
}
