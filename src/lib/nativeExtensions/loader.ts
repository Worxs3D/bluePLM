/**
 * Activates and deactivates the organization's native extensions in the renderer.
 *
 * For each enabled native row: main downloads (or reuses) the package, verifies it
 * against the row's SHA-256 and extracts it (extensions:native-prepare); the
 * renderer then imports `blueplm-ext://<sha256>/<main>` and calls `activate(host)`.
 * A failure is logged and recorded on the extension's state; it never breaks the app.
 *
 * Deactivation (disable, uninstall, a new version, org switch, sign-out) calls the
 * extension's `deactivate()` and then disposes everything the host handed out, so
 * a workspace never outlives its extension.
 */

import { log } from '@/lib/logger'
import type {
  Disposable,
  NativeExtensionClientModule,
  NativeExtensionHost,
  NativeExtensionManifest,
  NativeExtensionRuntimeState,
  OrgNativeExtensionRow,
} from '@/types/nativeExtensions'
import type { HostContext } from './host'

/** activate() and deactivate() each get this long. */
export const ACTIVATION_TIMEOUT_MS = 15_000

export interface PreparedPackage {
  clientEntryUrl: string
  manifest: NativeExtensionManifest
}

/** What the loader needs from the outside; injectable for tests. */
export interface LoaderDeps {
  prepare(row: OrgNativeExtensionRow): Promise<PreparedPackage>
  importModule(url: string): Promise<unknown>
  createHost(context: HostContext): NativeExtensionHost
  setState(state: NativeExtensionRuntimeState): void
  removeState(extensionId: string): void
  /** Dispose any workspace still registered by the extension (belt and braces). */
  clearRegistrations(extensionId: string): void
  prune(keepShas: string[]): Promise<void>
}

interface ActiveExtension {
  row: OrgNativeExtensionRow
  module: NativeExtensionClientModule | null
  disposables: Disposable[]
}

const LOG = '[NativeExt]'

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isClientModule(value: unknown): value is NativeExtensionClientModule {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { activate?: unknown }).activate === 'function'
  )
}

export class NativeExtensionLoader {
  private readonly active = new Map<string, ActiveExtension>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: LoaderDeps) {}

  /** Extension ids currently activated. */
  activeIds(): string[] {
    return [...this.active.keys()]
  }

  /**
   * Bring the running set in line with the organization's rows. Calls are
   * serialized, so overlapping syncs (org reload, settings changes) cannot race.
   */
  sync(rows: readonly OrgNativeExtensionRow[]): Promise<void> {
    const run = this.queue.then(() => this.doSync(rows))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Deactivate everything (org switch, sign-out). */
  deactivateAll(): Promise<void> {
    return this.sync([])
  }

  private async doSync(rows: readonly OrgNativeExtensionRow[]): Promise<void> {
    const wanted = new Map<string, OrgNativeExtensionRow>()
    for (const row of rows) if (row.enabled) wanted.set(row.extensionId, row)

    // Stop what is no longer wanted, or wanted at another package.
    for (const [id, current] of [...this.active]) {
      const next = wanted.get(id)
      if (!next || next.sha256 !== current.row.sha256) await this.deactivate(id)
    }

    // States for rows that are installed but disabled; forget rows that are gone.
    const rowIds = new Set(rows.map((r) => r.extensionId))
    for (const row of rows) {
      if (!row.enabled) {
        this.deps.setState({
          extensionId: row.extensionId,
          version: row.version,
          sha256: row.sha256,
          status: 'disabled',
        })
      }
    }
    for (const id of this.knownIds) {
      if (!rowIds.has(id)) this.deps.removeState(id)
    }
    this.knownIds = rowIds

    for (const row of wanted.values()) {
      if (!this.active.has(row.extensionId)) await this.activate(row)
    }

    try {
      await this.deps.prune(rows.map((r) => r.sha256))
    } catch (error) {
      log.warn(LOG, 'Pruning the package cache failed', { error: messageOf(error) })
    }
  }

  private knownIds = new Set<string>()

  private async activate(row: OrgNativeExtensionRow): Promise<void> {
    const base = { extensionId: row.extensionId, version: row.version, sha256: row.sha256 }
    this.deps.setState({ ...base, status: 'loading' })
    const entry: ActiveExtension = { row, module: null, disposables: [] }
    this.active.set(row.extensionId, entry)
    try {
      const prepared = await this.deps.prepare(row)
      const loaded = await this.deps.importModule(prepared.clientEntryUrl)
      if (!isClientModule(loaded)) {
        throw new Error('client entry does not export activate(host)')
      }
      entry.module = loaded
      const host = this.deps.createHost({
        extensionId: row.extensionId,
        version: row.version,
        manifest: prepared.manifest,
        track: (d) => entry.disposables.push(d),
      })
      await withTimeout(Promise.resolve(loaded.activate(host)), ACTIVATION_TIMEOUT_MS, 'activate()')
      this.deps.setState({ ...base, status: 'active' })
      log.info(LOG, 'Activated native extension', base)
    } catch (error) {
      const message = messageOf(error)
      log.error(LOG, 'Native extension failed to activate', { ...base, error: message })
      await this.teardown(entry)
      this.active.delete(row.extensionId)
      this.deps.setState({ ...base, status: 'error', error: message })
    }
  }

  private async deactivate(extensionId: string): Promise<void> {
    const entry = this.active.get(extensionId)
    if (!entry) return
    this.active.delete(extensionId)
    await this.teardown(entry)
    this.deps.removeState(extensionId)
    log.info(LOG, 'Deactivated native extension', { extensionId })
  }

  private async teardown(entry: ActiveExtension): Promise<void> {
    const id = entry.row.extensionId
    if (entry.module?.deactivate) {
      try {
        await withTimeout(
          Promise.resolve(entry.module.deactivate()),
          ACTIVATION_TIMEOUT_MS,
          'deactivate()',
        )
      } catch (error) {
        log.warn(LOG, 'deactivate() failed', { extensionId: id, error: messageOf(error) })
      }
    }
    for (const disposable of entry.disposables.splice(0).reverse()) {
      try {
        disposable.dispose()
      } catch (error) {
        log.warn(LOG, 'dispose() failed', { extensionId: id, error: messageOf(error) })
      }
    }
    this.deps.clearRegistrations(id)
  }
}

