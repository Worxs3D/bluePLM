/**
 * Native extension loader.
 *
 * Loads native extensions ONLY for the organizations the operator listed in
 * NATIVE_EXTENSIONS_ORG_IDS (see config.ts): a native extension runs in-process
 * with the API's service-role access to every org, so an org admin's install is
 * not enough on its own. Nothing is loaded when the list is empty.
 *
 * At startup (all allowed orgs) and on `POST /admin/extensions/reload` (the
 * caller's org only) it reads the org's enabled native installs with a
 * `serverMain`, downloads each package with the service-role client, verifies
 * its sha256, extracts it to `<privateRoot>/<orgId>/<sha256>`, imports the
 * server entry and calls `register(app)`. Loaded extensions are keyed by
 * (org, extension), so orgs never share a module instance or a route table.
 * A failing extension is logged and skipped; nothing here throws out to the
 * server.
 *
 * Unloading drops the extension's route table. Node cannot unload an ES
 * module, so a module imported once stays in memory for the life of the
 * process; keying the directory by sha256 makes a new version a new file URL
 * rather than a cached copy of the old one.
 */

import * as path from 'path'
import { pathToFileURL } from 'url'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { ExtensionRouteTable } from './matcher.js'
import { normalizeSha256, verifyAndExtractPackage } from './package.js'
import { createExtensionServices } from './services.js'
import { createPrivateExtractRoot } from './config.js'
import {
  installKey,
  pickLatestInstalls,
  type NativeExtensionStore,
  type NativeInstallRow,
} from './store.js'
import {
  EXTENSION_HTTP_METHODS,
  type ExtensionRoute,
  type ExtensionServerApp,
  type NativeExtensionServerModule,
} from './types.js'

const PERMISSION_ACTIONS = new Set(['view', 'create', 'edit', 'delete', 'admin'])

/** How long `register(app)` may take before the extension is treated as failed. */
const REGISTER_TIMEOUT_MS = 30_000

export interface LoadedNativeExtension {
  orgId: string
  extensionId: string
  sha256: string
  version: string | null
  routes: ExtensionRouteTable
  log: Logger
}

export interface ReloadReport {
  loaded: Array<{
    orgId: string
    extensionId: string
    sha256: string
    version: string | null
    routes: number
    reused: boolean
  }>
  failed: Array<{ orgId: string; extensionId: string; sha256: string | null; error: string }>
  /** `<orgId>/<extensionId>` of each extension dropped. */
  unloaded: string[]
  /** Set when the install list itself could not be read; the loaded set is then unchanged. */
  error?: string
}

export interface NativeExtensionRuntimeOptions {
  store: NativeExtensionStore
  supabaseAdmin: SupabaseClient
  logger: Logger
  /** NATIVE_EXTENSIONS_ORG_IDS: the only orgs whose native extensions are loaded. */
  allowedOrgIds: readonly string[]
  /** A private directory for extracted packages. Default: a 0700 mkdtemp, made on first load. */
  extractRoot?: string
  /** Where the default private directory is created (NATIVE_EXTENSIONS_DIR). */
  extractBaseDir?: string
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
  private extractRoot: string | null
  private readonly extractBaseDir: string | undefined
  private readonly allowed: ReadonlySet<string>
  private readonly importModule: (url: string) => Promise<unknown>

  constructor(options: NativeExtensionRuntimeOptions) {
    this.store = options.store
    this.admin = options.supabaseAdmin
    this.log = options.logger
    this.allowed = new Set(options.allowedOrgIds.map((id) => id.toLowerCase()))
    this.extractRoot = options.extractRoot ?? null
    this.extractBaseDir = options.extractBaseDir
    this.importModule = options.importModule ?? ((url) => import(url))
  }

  /** False when NATIVE_EXTENSIONS_ORG_IDS is empty: nothing is ever loaded. */
  get enabled(): boolean {
    return this.allowed.size > 0
  }

  isOrgAllowed(orgId: string): boolean {
    return this.allowed.has(orgId.toLowerCase())
  }

  get(orgId: string, extensionId: string): LoadedNativeExtension | undefined {
    return this.loaded.get(installKey(orgId.toLowerCase(), extensionId))
  }

  private privateRoot(): string {
    this.extractRoot ??= createPrivateExtractRoot(this.extractBaseDir)
    return this.extractRoot
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

  /**
   * Reload native extensions: every allowed org, or only `orgId` (which must be
   * allowed). Serialised: a second call waits for the first.
   */
  reload(orgId?: string): Promise<ReloadReport> {
    const next = this.queue.then(() => this.doReload(orgId?.toLowerCase()))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async doReload(orgId: string | undefined): Promise<ReloadReport> {
    const report: ReloadReport = { loaded: [], failed: [], unloaded: [] }
    if (orgId !== undefined && !this.allowed.has(orgId)) {
      report.error = 'Native extensions are not enabled for this organization on this server'
      return report
    }
    const orgIds = orgId !== undefined ? [orgId] : [...this.allowed]
    const inScope = (key: string) => orgIds.some((id) => key.startsWith(`${id}/`))

    let rows: NativeInstallRow[]
    try {
      const listed = orgIds.length === 0 ? [] : await this.store.listNativeInstalls(orgIds)
      // The store filters by org too; check again so nothing outside the allowlist loads.
      rows = pickLatestInstalls(listed.filter((row) => orgIds.includes(row.org_id.toLowerCase())))
    } catch (err) {
      report.error = errorMessage(err)
      this.log.error({ err }, '[NativeExtensions] Could not list native installs; keeping the loaded set')
      return report
    }

    // Entries of orgs outside this reload stay as they are.
    const next = new Map<string, LoadedNativeExtension>(
      [...this.loaded].filter(([key]) => !inScope(key)),
    )
    for (const row of rows) {
      const extensionId = row.extension_id
      const rowOrg = row.org_id.toLowerCase()
      const key = installKey(rowOrg, extensionId)
      let sha: string | null = null
      try {
        sha = normalizeSha256(row.package_sha256)
        const current = this.loaded.get(key)
        if (current && current.sha256 === sha) {
          next.set(key, current)
          report.loaded.push({
            orgId: rowOrg,
            extensionId,
            sha256: sha,
            version: current.version,
            routes: current.routes.size,
            reused: true,
          })
          continue
        }
        const loaded = await this.loadOne(row, rowOrg, sha)
        next.set(key, loaded)
        report.loaded.push({
          orgId: rowOrg,
          extensionId,
          sha256: sha,
          version: loaded.version,
          routes: loaded.routes.size,
          reused: false,
        })
        this.log.info(
          { orgId: rowOrg, extensionId, sha256: sha, routes: loaded.routes.size },
          '[NativeExtensions] Loaded',
        )
      } catch (err) {
        report.failed.push({ orgId: rowOrg, extensionId, sha256: sha, error: errorMessage(err) })
        this.log.error(
          { err, orgId: rowOrg, extensionId, sha256: sha },
          '[NativeExtensions] Failed to load; skipped',
        )
      }
    }

    for (const key of this.loaded.keys()) {
      if (!next.has(key)) report.unloaded.push(key)
    }
    this.loaded = next
    return report
  }

  private async loadOne(
    row: NativeInstallRow,
    orgId: string,
    sha: string,
  ): Promise<LoadedNativeExtension> {
    const extensionId = row.extension_id
    if (!row.package_path) throw new Error('Install has no package_path')

    const bytes = await this.store.downloadPackage(row.package_path)
    // Per-org directory: the same package in two orgs is two module instances.
    const extracted = await verifyAndExtractPackage(
      bytes,
      sha,
      extensionId,
      path.join(this.privateRoot(), orgId),
    )

    const mod = await this.importModule(pathToFileURL(extracted.serverEntry).href)
    if (!isServerModule(mod)) {
      throw new Error(`${extracted.manifest.serverMain} does not export register(app)`)
    }

    const routes = new ExtensionRouteTable()
    const log = this.log.child({ orgId, extensionId })
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

    return { orgId, extensionId, sha256: sha, version: extracted.manifest.version ?? null, routes, log }
  }
}
