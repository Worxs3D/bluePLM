/**
 * Export an order's files for the supplier: a zip (desktop and web) or a new folder (desktop, and
 * the web where the browser has `showDirectoryPicker`: `./exportWebFolder`).
 *
 * The plan (`planOrderExport`) names every file; content marked damaged or missing (schema 503,
 * `blockedContentHashes`) refuses the whole export, naming the files. A sent order exports the
 * outputs recorded when it was sent (`resolveLineOutputs` reads `sentOutputs`), never newer ones.
 *
 * - Desktop: one signed URL per file, handed with the plan to the main process (`orders:export`),
 *   which asks where to save, downloads and verifies every file and writes the zip or folder.
 * - Web: the renderer fetches each file, checks its SHA-256, builds the zip with JSZip (stored,
 *   not compressed) and saves it through the browser, within `WEB_DOWNLOAD_MAX_FILES` and
 *   `WEB_DOWNLOAD_MAX_BYTES` since the zip is built in memory. A web folder export fetches and
 *   checks each content the same way and writes it into a new subfolder of the picked folder.
 *
 * Any download that does not hash to its recorded hash fails the whole export.
 */

import { saveBlobAs } from '@/lib/browserDownload'
import { processWithConcurrency } from '@/lib/concurrency'
import { log } from '@/lib/logger'
import { orgExportFilenamePattern } from '@/lib/outputs/naming'
import { hasDesktop } from '@/lib/platform'
import { getDownloadUrl } from '@/lib/storage'
import { blockedContentHashes, sha256Hex } from '@/lib/vaultObjectIssues'
import { WEB_DOWNLOAD_MAX_BYTES, WEB_DOWNLOAD_MAX_FILES } from '@/lib/webDownload'
import { usePDMStore } from '@/stores/pdmStore'
import type {
  ExportOrderResult,
  LineOutputState,
  OrderExportErrorCode,
  OrderExportProgress,
  SupplyOrder,
  SupplyOrderLine,
} from '@/types/orders'

import { planOrderExport, type OrderExportPlan } from './exportPlan'
import { exportToWebFolder, pickWebExportFolder, WebFolderExportError, webFolderExportSupported } from './exportWebFolder'
import { resolveLineOutputs } from './outputs'

/** Signed URLs live this long: the main process may download many files one after another. */
export const ORDER_EXPORT_URL_TTL_SECONDS = 3600
const SIGN_CONCURRENCY = 8
const WEB_FETCH_CONCURRENCY = 4

export interface ExportOrderOptions {
  /** Output states already resolved (the open order's); read fresh when omitted. */
  states?: ReadonlyMap<string, readonly LineOutputState[]>
  onProgress?: (progress: OrderExportProgress) => void
  /** The time `{date}` tokens and order.json use; default now. */
  now?: Date
}

class OrderExportFailure extends Error {
  constructor(
    readonly code: OrderExportErrorCode,
    message: string,
    readonly files?: string[],
  ) {
    super(message)
    this.name = 'OrderExportFailure'
  }
}

function failed(error: unknown): ExportOrderResult {
  if (error instanceof OrderExportFailure || error instanceof WebFolderExportError) {
    return error.files
      ? { status: 'failed', code: error.code, message: error.message, files: error.files }
      : { status: 'failed', code: error.code, message: error.message }
  }
  return { status: 'failed', code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }
}

async function refuseBlocked(plan: OrderExportPlan): Promise<void> {
  const blocked = await blockedContentHashes(plan.entries.map((e) => e.storageHash))
  const names = plan.entries.filter((e) => blocked.has(e.storageHash)).map((e) => e.zipPath)
  if (names.length > 0) {
    throw new OrderExportFailure('BLOCKED_CONTENT', `Damaged or missing content: ${names.join(', ')}`, names)
  }
}

async function signUrls(orgId: string, plan: OrderExportPlan): Promise<Map<string, string>> {
  const hashes = [...new Set(plan.entries.map((e) => e.storageHash))]
  const urls = new Map<string, string>()
  await processWithConcurrency(hashes, SIGN_CONCURRENCY, async (hash) => {
    const { url, error } = await getDownloadUrl(orgId, hash, ORDER_EXPORT_URL_TTL_SECONDS)
    if (!url) {
      const names = plan.entries.filter((e) => e.storageHash === hash).map((e) => e.zipPath)
      throw new OrderExportFailure('NO_URL', error || `No download URL: ${names.join(', ')}`, names)
    }
    urls.set(hash, url)
  })
  return urls
}

async function exportOnDesktop(
  orgId: string,
  plan: OrderExportPlan,
  mode: 'zip' | 'folder',
  onProgress?: (progress: OrderExportProgress) => void,
): Promise<ExportOrderResult> {
  const api = window.electronAPI!.orders
  onProgress?.({ phase: 'preparing', completed: 0, total: plan.entries.length })
  const urls = await signUrls(orgId, plan)
  const unsubscribe = onProgress ? api.onExportProgress((p) => onProgress(p)) : () => undefined
  try {
    const result = await api.export({
      mode,
      name: plan.baseName,
      files: plan.entries.map((e) => ({
        path: e.zipPath,
        url: urls.get(e.storageHash)!,
        sha256: e.storageHash,
        size: e.fileSize,
      })),
      texts: [
        { path: plan.csv.name, content: plan.csv.content },
        { path: plan.json.name, content: plan.json.content },
      ],
    })
    if (result.success) {
      return { status: 'saved', path: result.path, files: plan.entries.length, missing: plan.missing.length }
    }
    if (result.canceled) return { status: 'canceled' }
    return { status: 'failed', code: result.code, message: result.error }
  } finally {
    unsubscribe()
  }
}

async function fetchVerified(orgId: string, hash: string, name: string): Promise<Blob> {
  const { url, error } = await getDownloadUrl(orgId, hash, ORDER_EXPORT_URL_TTL_SECONDS)
  if (!url) throw new OrderExportFailure('NO_URL', error || `No download URL: ${name}`, [name])
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new OrderExportFailure('DOWNLOAD_FAILED', `${name}: ${error instanceof Error ? error.message : String(error)}`, [name])
  }
  if (!response.ok) throw new OrderExportFailure('DOWNLOAD_FAILED', `${name}: storage answered ${response.status}`, [name])
  const blob = await response.blob()
  if ((await sha256Hex(await blob.arrayBuffer())) !== hash) {
    throw new OrderExportFailure('HASH_MISMATCH', `${name} does not match its recorded hash`, [name])
  }
  return blob
}

async function exportOnWeb(
  orgId: string,
  plan: OrderExportPlan,
  onProgress?: (progress: OrderExportProgress) => void,
): Promise<ExportOrderResult> {
  if (plan.entries.length > WEB_DOWNLOAD_MAX_FILES) {
    throw new OrderExportFailure('TOO_MANY_FILES', `More than ${WEB_DOWNLOAD_MAX_FILES} files`)
  }
  const bytes = plan.entries.reduce((sum, e) => sum + e.fileSize, 0)
  if (bytes > WEB_DOWNLOAD_MAX_BYTES) {
    throw new OrderExportFailure('TOO_LARGE', `The export is larger than ${WEB_DOWNLOAD_MAX_BYTES} bytes`)
  }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const total = plan.entries.length
  let completed = 0
  onProgress?.({ phase: 'downloading', completed, total })
  // One fetch per content; an entry whose content another entry shares reuses its bytes.
  const byHash = new Map<string, Promise<Blob>>()
  await processWithConcurrency([...plan.entries], WEB_FETCH_CONCURRENCY, async (entry) => {
    let blob = byHash.get(entry.storageHash)
    if (!blob) {
      blob = fetchVerified(orgId, entry.storageHash, entry.zipPath)
      byHash.set(entry.storageHash, blob)
    }
    zip.file(entry.zipPath, await blob)
    onProgress?.({ phase: 'downloading', completed: ++completed, total })
  })
  zip.file(plan.csv.name, plan.csv.content)
  zip.file(plan.json.name, plan.json.content)
  onProgress?.({ phase: 'writing', completed: 0, total: 1 })
  saveBlobAs(`${plan.baseName}.zip`, await zip.generateAsync({ type: 'blob', compression: 'STORE' }))
  onProgress?.({ phase: 'writing', completed: 1, total: 1 })
  return { status: 'downloaded', files: plan.entries.length, missing: plan.missing.length }
}

/**
 * Export the order's included, ready outputs plus `<order number>.csv` and `order.json`. Outputs
 * that are missing are left out and counted (`missing`); the CSV and order.json list them. Never
 * throws.
 */
export async function exportOrder(
  orgId: string,
  order: SupplyOrder,
  lines: readonly SupplyOrderLine[],
  mode: 'zip' | 'folder',
  options: ExportOrderOptions = {},
): Promise<ExportOrderResult> {
  try {
    if (lines.length === 0) throw new OrderExportFailure('NOTHING_TO_EXPORT', 'The order has no lines')
    const desktop = hasDesktop() && !!window.electronAPI?.orders
    if (mode === 'folder' && !desktop && !webFolderExportSupported()) {
      throw new OrderExportFailure('DESKTOP_ONLY', 'Saving to a folder needs the desktop app')
    }
    // The browser's folder picker needs the click's user activation: it comes before any read.
    let webFolder: FileSystemDirectoryHandle | null = null
    if (mode === 'folder' && !desktop) {
      webFolder = await pickWebExportFolder()
      if (!webFolder) return { status: 'canceled' }
    }
    const states = options.states ?? (await resolveLineOutputs(lines))
    const pattern = orgExportFilenamePattern(usePDMStore.getState().organization)
    const plan = planOrderExport(order, lines, states, pattern, options.now)
    await refuseBlocked(plan)
    const result = desktop
      ? await exportOnDesktop(orgId, plan, mode, options.onProgress)
      : webFolder
        ? await exportToWebFolder(
            webFolder,
            plan,
            { fetchVerified: (hash, name) => fetchVerified(orgId, hash, name) },
            options.onProgress,
          )
        : await exportOnWeb(orgId, plan, options.onProgress)
    if (result.status === 'saved' || result.status === 'downloaded') {
      log.info('[Orders]', 'Order exported', {
        orderId: order.id,
        mode: desktop ? mode : webFolder ? 'web-folder' : 'web',
        files: plan.entries.length,
        missing: plan.missing.length,
      })
    }
    return result
  } catch (error) {
    const result = failed(error)
    log.warn('[Orders]', 'Order export failed', {
      orderId: order.id,
      code: result.status === 'failed' ? result.code : undefined,
      error: error instanceof Error ? error.message : String(error),
    })
    return result
  }
}
