/**
 * Native extension loader.
 *
 * At startup (and on `POST /admin/extensions/reload`) reads every enabled
 * native install with a `serverMain`, takes the latest install per extension
 * id, downloads the package with the service-role client, verifies its
 * sha256, extracts it to `<root>/<sha256>`, imports the server entry and calls
 * `register(app)`. A failing extension is logged and skipped; nothing here
 * throws out to the server.
 *
 * Unloading drops the extension's route table. Node cannot unload an ES
 * module, so a module imported once stays in memory for the life of the
 * process; keying the directory by sha256 makes a new version a new file URL
 * rather than a cached copy of the old one.
 */

import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { ExtensionRouteTable } from './matcher.js'
import { normalizeSha256, verifyAndExtractPackage } from './package.js'
import { createExtensionServices } from './services.js'
import { pickLatestInstalls, type NativeExtensionStore, type NativeInstallRow } from './store.js'
import {
  EXTENSION_HTTP_METHODS,
  type ExtensionRoute,
  type ExtensionServerApp,
  type NativeExtensionServerModule,
} from './types.js'

const PERMISSION_ACTIONS = new Set(['view', 'create', 'edit', 'delete', 'admin'])

/** How long `register(app)` may take before the extension is treated as failed. */
const REGISTER_TIMEOUT_MS = 30_000

export const DEFAULT_EXTRACT_ROOT = path.join(os.tmpdir(), 'blueplm-native-extensions')

export interface LoadedNativeExtension {
  extensionId: string
  sha256: string
  version: string | null
  routes: ExtensionRouteTable
  log: Logger
}

export interface ReloadReport {
  loaded: Array<{ extensionId: string; sha256: string; version: string | null; routes: number; reused: boolean }>
  failed: Array<{ extensionId: string; sha256: string | null; error: string }>
  unloaded: string[]
  /** Set when the install list itself could not be read; the loaded set is then unchanged. */
  error?: string
}

export interface NativeExtensionRuntimeOptions {
  store: NativeExtensionStore
  supabaseAdmin: SupabaseClient
  logger: Logger
  extractRoot?: string
  /** Imports the server entry. Defaults to a dynamic `import()` of the file URL. */
  importModule?: (url: string) => Promise<unknown>
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isServerModule(value: unknown): value is NativeExtensionServerModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { register?: unknown }).register === 'function'
  )
}

/** Check a route an extension registers, or throw with the reason. */
export function validateRoute(route: ExtensionRoute): void {
  if (!route || typeof route !== 'object') throw new Error('route() needs a route object')
  if (!(EXTENSION_HTTP_METHODS as readonly string[]).includes(route.method)) {
    throw new Error(`Unsupported method: ${String(route.method)}`)
  }
  if (typeof route.handler !== 'function') throw new Error(`Route ${route.method} ${route.url} has no handler`)
  if (route.permission !== undefined) {
    const [resource, action] = Array.isArray(route.permission) ? route.permission : []
    if (typeof resource !== 'string' || resource.length === 0 || !PERMISSION_ACTIONS.has(String(action))) {
      throw new Error(`Route ${route.method} ${route.url} has an invalid permission`)
    }
  }
  if (route.timeoutMs !== undefined && !(Number.isFinite(route.timeoutMs) && route.timeoutMs > 0)) {
    throw new Error(`Route ${route.method} ${route.url} has an invalid timeoutMs`)
  }
}

export class NativeExtensionRuntime {
  private loaded = new Map<string, LoadedNativeExtension>()
  private queue: Promise<unknown> = Promise.resolve()
  private initial: Promise<void> | null = null
  private readonly store: NativeExtensionStore
  private readonly admin: SupabaseClient
  private readonly log: Logger
  private readonly extractRoot: string
  private readonly importModule: (url: string) => Promise<unknown>

  constructor(options: NativeExtensionRuntimeOptions) {
    this.store = options.store
    this.admin = options.supabaseAdmin
    this.log = options.logger
    this.extractRoot = options.extractRoot ?? DEFAULT_EXTRACT_ROOT
    this.importModule = options.importModule ?? ((url) => import(url))
  }

  get(extensionId: string): LoadedNativeExtension | undefined {
    return this.loaded.get(extensionId)
  }

  list(): LoadedNativeExtension[] {
    return [...this.loaded.values()]
  }

  getOrgInstall(orgId: string, extensionId: string) {
    return this.store.getOrgInstall(orgId, extensionId)
  }

  /** Start the first load. Requests to /ext wait for it through `whenReady()`. */
  start(): Promise<void> {
    this.initial ??= this.reload().then(() => undefined)
    return this.initial
  }

  /** Resolves once the first load has finished (immediately if none was started). */
  whenReady(): Promise<void> {
    return this.initial ?? Promise.resolve()
  }

  /** Reload every native extension. Serialised: a second call waits for the first. */
  reload(): Promise<ReloadReport> {
    const next = this.queue.then(() => this.doReload())
    this.queue = next.catch(() => undefined)
    return next
  }

  private async doReload(): Promise<ReloadReport> {
    const report: ReloadReport = { loaded: [], failed: [], unloaded: [] }

    let rows: NativeInstallRow[]
    try {
      rows = pickLatestInstalls(await this.store.listNativeInstalls())
    } catch (err) {
      report.error = errorMessage(err)
      this.log.error({ err }, '[NativeExtensions] Could not list native installs; keeping the loaded set')
      return report
    }

    const next = new Map<string, LoadedNativeExtension>()
    for (const row of rows) {
      const extensionId = row.extension_id
      let sha: string | null = null
      try {
        sha = normalizeSha256(row.package_sha256)
        const current = this.loaded.get(extensionId)
        if (current && current.sha256 === sha) {
          next.set(extensionId, current)
          report.loaded.push({
            extensionId,
            sha256: sha,
            version: current.version,
            routes: current.routes.size,
            reused: true,
          })
          continue
        }
        const loaded = await this.loadOne(row, sha)
        next.set(extensionId, loaded)
        report.loaded.push({ extensionId, sha256: sha, version: loaded.version, routes: loaded.routes.size, reused: false })
        this.log.info({ extensionId, sha256: sha, routes: loaded.routes.size }, '[NativeExtensions] Loaded')
      } catch (err) {
        report.failed.push({ extensionId, sha256: sha, error: errorMessage(err) })
        this.log.error({ err, extensionId, sha256: sha }, '[NativeExtensions] Failed to load; skipped')
      }
    }

    for (const id of this.loaded.keys()) {
      if (!next.has(id)) report.unloaded.push(id)
    }
    this.loaded = next
    return report
  }

  private async loadOne(row: NativeInstallRow, sha: string): Promise<LoadedNativeExtension> {
    const extensionId = row.extension_id
    if (!row.package_path) throw new Error('Install has no package_path')

    const bytes = await this.store.downloadPackage(row.package_path)
    const extracted = await verifyAndExtractPackage(bytes, sha, extensionId, this.extractRoot)

    const mod = await this.importModule(pathToFileURL(extracted.serverEntry).href)
    if (!isServerModule(mod)) {
      throw new Error(`${extracted.manifest.serverMain} does not export register(app)`)
    }

    const routes = new ExtensionRouteTable()
    const log = this.log.child({ extensionId })
    let registering = true
    const app: ExtensionServerApp = {
      route(route) {
        if (!registering) throw new Error('app.route() is only valid while register(app) runs')
        validateRoute(route)
        routes.add(route)
      },
      services: createExtensionServices(this.admin, log),
    }

    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.resolve(mod.register(app)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`register(app) did not finish within ${REGISTER_TIMEOUT_MS} ms`)),
            REGISTER_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
      registering = false
    }

    return { extensionId, sha256: sha, version: extracted.manifest.version ?? null, routes, log }
  }
}
