/**
 * The `window.electronAPI` the perf boot installs: the synthetic vault as the disk, the test kit's
 * SolidWorks service fake (src/test/fakeElectron.ts), a few window-only calls passed through to the
 * real preload, and an inert answer for everything else.
 *
 * The disk is served from memory rather than written to a temp folder: the measurement is the
 * renderer's, and a 30k-file scan on the runner's disk would add minutes of noise to cold start.
 * Each scan still hands the renderer fresh objects, as the IPC copy does.
 */
import type { FixtureLocalEntry, SyntheticVault } from '@/lib/loadPipelineFixtures'
import { createFakeElectron } from '@/test/fakeElectron'

import type { Misses } from './lenientClient'

type ElectronAPI = NonNullable<Window['electronAPI']>
type Fn = (...args: unknown[]) => unknown

/** Window and log calls with no disk, network or service behind them: answered by the real preload. */
const REAL_PASSTHROUGH = new Set([
  'log',
  'getVersion',
  'getPlatform',
  'close',
  'getZoomFactor',
  'setZoomFactor',
  'onZoomChanged',
  'setTitleBarOverlay',
  'getTitleBarOverlayRect',
  'onTitleBarOverlayRect',
  'requestFocus',
])

/** A member nobody modelled. `onX` returns its unsubscribe; anything else fails like an old preload. */
function inert(name: string, misses: Misses): unknown {
  const target = function inertMember() {}
  const proxy: unknown = new Proxy(target, {
    apply() {
      misses.set(`electron.${name}`, (misses.get(`electron.${name}`) ?? 0) + 1)
      if (/^on[A-Z]/.test(name.slice(name.lastIndexOf('.') + 1))) return () => {}
      return Promise.resolve({ success: false, error: `${name}: not modelled by the perf boot` })
    },
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      return inert(`${name}.${prop}`, misses)
    },
  })
  return proxy
}

function parentOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash < 0 ? '' : relativePath.slice(0, slash)
}

/** Main-process events the soak sends (`onFilesChanged`, ...) and the subscriptions it counts. */
export interface PerfElectronHooks {
  emit(event: string, ...args: unknown[]): number
  /** Subscriptions to main-process events the app holds now (the preload's `ipcRenderer.on`s). */
  listenerCount(): number
  /** The kit's SolidWorks service fake, for the soak's service calls. */
  solidworks: ElectronAPI['solidworks']
  /**
   * Where `downloadUrl` gets bytes for a signed URL (the fake bucket). Set by the boot once the
   * backend exists; review PDFs are downloaded into an in-memory cache folder through it.
   */
  setDownloadSource(source: (url: string) => Promise<Uint8Array | null>): void
}

/** The review PDF cache folder the fake main process reports (`review-package:get-pdf-cache-dir`). */
const REVIEW_PDF_CACHE = 'C:\\BluePLM-perf\\review-pdf-cache'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function createPerfElectron(
  vault: SyntheticVault,
  root: string,
  misses: Misses,
  real: ElectronAPI | undefined,
  hooks?: Partial<PerfElectronHooks>,
): ElectronAPI {
  const kit = createFakeElectron()
  // `onX(callback)` subscriptions, by event: what the preload would hold as ipcRenderer listeners.
  const subscriptions = new Map<string, Set<Fn>>()
  const subscribe = (event: string) => (callback: Fn) => {
    let set = subscriptions.get(event)
    if (!set) subscriptions.set(event, (set = new Set()))
    set.add(callback)
    return () => {
      set.delete(callback)
    }
  }
  if (hooks) {
    hooks.emit = (event, ...args) => {
      const listeners = [...(subscriptions.get(event) ?? [])]
      for (const listener of listeners) listener(...args)
      return listeners.length
    }
    hooks.listenerCount = () => [...subscriptions.values()].reduce((n, set) => n + set.size, 0)
    hooks.solidworks = kit.api.solidworks
  }
  // The kit records every call for test assertions; over a long session that list is a leak.
  const trimKit = () => {
    if (kit.calls.length > 500) kit.calls.splice(0, kit.calls.length - 100)
  }

  // Review PDFs (src/lib/reviewPackage/pdf.ts): downloaded into a cache folder held in memory.
  let downloadSource: ((url: string) => Promise<Uint8Array | null>) | null = null
  const pdfCache = new Map<string, { bytes: Uint8Array; hash: string }>()
  const inPdfCache = (path: string) => /^[\\/]/.test(path.slice(REVIEW_PDF_CACHE.length)) && path.toLowerCase().startsWith(REVIEW_PDF_CACHE.toLowerCase())
  if (hooks) hooks.setDownloadSource = (source) => (downloadSource = source)
  const reviewPackage: Record<string, unknown> = {
    async getPdfCacheDir() {
      return { success: true, path: REVIEW_PDF_CACHE }
    },
    async readCachedPdf(path: string) {
      const cached = pdfCache.get(path.toLowerCase())
      if (!cached) return { success: false, error: 'Not a cached review PDF' }
      return { success: true, data: toBase64(cached.bytes), size: cached.bytes.length }
    },
  }

  const hashByPath = new Map(vault.serverRows.map((row) => [row.file_path, row.content_hash ?? '']))
  const copy = (entries: FixtureLocalEntry[]) => entries.map((entry) => ({ ...entry }))
  const scan = () => ({ success: true, files: copy(vault.localEntries) })

  const own: Record<string, unknown> = {
    async setWorkingDir(path: string) {
      return { success: true, path }
    },
    async listWorkingFiles() {
      return scan()
    },
    async listWorkingFilesDelta() {
      return { ...scan(), wasFullScan: false }
    },
    async invalidateScanCache() {
      return { success: true }
    },
    async listFolderFast(folderRelativePath: string) {
      const folder = folderRelativePath.replace(/\\/g, '/').replace(/\/$/, '')
      return {
        success: true,
        folderPath: folder,
        files: copy(vault.localEntries.filter((e) => parentOf(e.relativePath) === folder)),
      }
    },
    async computeFileHashes(files: Array<{ relativePath: string }>) {
      return {
        success: true,
        results: files.map((f) => ({ relativePath: f.relativePath, hash: hashByPath.get(f.relativePath) ?? '' })),
      }
    },
    // No crash happened: the inert answer is a truthy object, which the startup hook would read as
    // a crash notice and toast about.
    async consumeCrashNotice() {
      return null
    },
    async downloadUrl(url: string, destPath: string, expectedHash?: string) {
      if (!inPdfCache(destPath) || !downloadSource) {
        misses.set('electron.downloadUrl', (misses.get('electron.downloadUrl') ?? 0) + 1)
        return { success: false, error: 'downloadUrl: only review PDFs are modelled by the perf boot' }
      }
      const bytes = await downloadSource(url)
      if (!bytes) return { success: false, error: 'Object not found' }
      pdfCache.set(destPath.toLowerCase(), { bytes, hash: expectedHash ?? '' })
      return { success: true, size: bytes.length, hash: expectedHash }
    },
    async hashFile(path: string) {
      if (inPdfCache(path)) {
        const cached = pdfCache.get(path.toLowerCase())
        return cached ? { success: true, hash: cached.hash, size: cached.bytes.length } : { success: false, error: 'ENOENT' }
      }
      return kit.api.hashFile(path)
    },
    reviewPackage: new Proxy(reviewPackage, {
      get(obj, prop) {
        if (typeof prop === 'symbol') return undefined
        return prop in obj ? obj[prop] : inert(`reviewPackage.${prop}`, misses)
      },
    }),
    async fileExists(path: string) {
      if (inPdfCache(path)) return pdfCache.has(path.toLowerCase())
      const rel = path.slice(root.length + 1).replace(/\\/g, '/')
      return vault.localEntries.some((e) => e.relativePath === rel)
    },
    extensions: new Proxy(
      {} as Record<string, unknown>,
      {
        get(obj, prop) {
          if (typeof prop === 'symbol') return undefined
          return prop in obj ? obj[prop] : inert(`extensions.${prop}`, misses)
        },
      },
    ),
  }

  return new Proxy({} as ElectronAPI, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      if (prop in own) return own[prop]
      if (real && REAL_PASSTHROUGH.has(prop)) {
        const value = (real as unknown as Record<string, unknown>)[prop]
        return typeof value === 'function' ? (value as Fn).bind(real) : value
      }
      if (/^on[A-Z]/.test(prop)) return subscribe(prop)
      const fromKit = (kit.api as unknown as Record<string, unknown>)[prop]
      if (fromKit !== undefined) {
        if (typeof fromKit !== 'function') return fromKit
        return (...args: unknown[]) => {
          trimKit()
          return (fromKit as Fn)(...args)
        }
      }
      return inert(prop, misses)
    },
  })
}
