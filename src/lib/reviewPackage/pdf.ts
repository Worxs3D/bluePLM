/**
 * The PDF of a drawing version: generated once, stored content-addressed, reused by everyone.
 *
 * `ensureDrawingPdf` returns the stored render when one exists. Otherwise, on a machine with
 * SOLIDWORKS, it stages the drawing version and its dependency closure in a temp folder, points
 * the staged files at each other (`retargetReferences`), exports the PDF, uploads it to the vault
 * bucket by content hash, records it against the version, and removes the temp folder. Without
 * SOLIDWORKS it says so (`needs_solidworks`) and changes nothing; someone else can render later.
 *
 * `resolveReviewItemPreview` is what the review viewer shows for an item: always the stored PDF
 * of the pinned version (or the item's own PDF version), never the reviewer's local copy.
 */

import { log } from '@/lib/logger'
import { getDownloadUrl, uploadFile } from '@/lib/storage'
import { getDrawingPdf, recordDrawingPdf, ReviewRpcError } from '@/lib/supabase/reviews'
import {
  checkSwServiceFeature,
  SW_SERVICE_VERSION_RETARGET_REFERENCES,
} from '@/lib/swServiceVersion'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewItemDetail } from '@/types/reviews'

import {
  isDrawingPath,
  isPdfPath,
  isStorageHash,
  joinLocalPath,
  openDocumentNameClashes,
} from './layout'
import { fetchMergedClosure, requireOrgId, stageFiles } from './stage'
import type {
  EnsureDrawingPdfResult,
  PdfProgressCallback,
  PdfUnavailableReason,
  ReviewItemPreview,
} from './types'

const RENDER_FILE = '__blueplm_review_render.pdf'

function electron() {
  const api = window.electronAPI
  if (!api) throw new Error('Review PDFs need the desktop app')
  return api
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** The local vault roots this machine knows, for exact vault-relative retargeting. */
function localVaultRoots(): string[] {
  const state = usePDMStore.getState()
  const roots = new Set<string>()
  for (const vault of state.connectedVaults) if (vault.localPath) roots.add(vault.localPath)
  if (state.vaultPath) roots.add(state.vaultPath)
  return [...roots]
}

/**
 * Whether this machine can render: the service runs, is new enough to retarget, and full
 * SOLIDWORKS is installed. Null when it can.
 */
export async function pdfRenderUnavailableReason(): Promise<PdfUnavailableReason | null> {
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  if (!status?.data?.running) return 'service_offline'
  const feature = checkSwServiceFeature(
    status.data.version ?? null,
    SW_SERVICE_VERSION_RETARGET_REFERENCES,
  )
  if (feature.status === 'incompatible') return 'service_outdated'
  if (status.data.swInstalled === false) return 'solidworks_not_installed'
  return null
}

async function cachedResult(fileVersionId: string): Promise<EnsureDrawingPdfResult | null> {
  const pdf = await getDrawingPdf(fileVersionId)
  return pdf
    ? {
        status: 'cached',
        storageHash: pdf.storageHash,
        fileSize: pdf.fileSize,
        closureExact: pdf.closureExact,
      }
    : null
}

export async function ensureDrawingPdf(
  fileVersionId: string,
  onProgress?: PdfProgressCallback,
): Promise<EnsureDrawingPdfResult> {
  onProgress?.({ phase: 'checking' })
  try {
    const cached = await cachedResult(fileVersionId)
    if (cached) return cached

    const closure = await fetchMergedClosure([fileVersionId])
    const root = closure.files.find((f) => f.fileVersionId === fileVersionId)
    if (!root) return { status: 'failed', error: 'File version not found', errorCode: 'NOT_FOUND' }
    if (!isDrawingPath(root.filePath)) return { status: 'not_a_drawing' }

    const unavailable = await pdfRenderUnavailableReason()
    if (unavailable) return { status: 'needs_solidworks', reason: unavailable }

    return await renderAndRecord(fileVersionId, closure, onProgress)
  } catch (err) {
    log.warn('[ReviewPackage]', 'Drawing PDF failed', {
      fileVersionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

async function renderAndRecord(
  fileVersionId: string,
  closure: Awaited<ReturnType<typeof fetchMergedClosure>>,
  onProgress?: PdfProgressCallback,
): Promise<EnsureDrawingPdfResult> {
  const api = electron()
  const orgId = requireOrgId()
  const root = closure.files.find((f) => f.fileVersionId === fileVersionId)!

  const staging = await api.reviewPackage.createStagingDir()
  if (!staging.success || !staging.path) {
    return { status: 'failed', error: staging.error ?? 'No staging folder', errorCode: 'STAGING' }
  }
  const stagingDir = staging.path

  try {
    // A same-named document already open in SOLIDWORKS would be used instead of the staged one.
    const open = await api.solidworks.getOpenDocuments({ includeComponents: true })
    const clashes = openDocumentNameClashes(
      closure.files.map((f) => f.fileName),
      (open.data?.documents ?? []).map((doc) => doc.filePath),
      stagingDir,
    )
    if (clashes.length > 0) {
      return {
        status: 'failed',
        errorCode: 'SAME_NAME_OPEN',
        error: clashes.join(', '),
      }
    }

    const staged = await stageFiles(closure.files, stagingDir, {
      orgId,
      onProgress: (p) => onProgress?.({ phase: 'staging', completed: p.completed, total: p.total }),
    })
    const failed = staged.filter((s) => s.status === 'failed')
    if (failed.length > 0) {
      return {
        status: 'failed',
        errorCode: 'STAGING',
        error: failed.map((f) => `${f.packagePath}: ${f.error ?? 'failed'}`).join('; '),
      }
    }
    const drawing = staged.find((s) => s.file.fileVersionId === fileVersionId)!

    onProgress?.({ phase: 'retargeting' })
    const retarget = await api.solidworks.retargetReferences({
      packageRoot: stagingDir,
      vaultRoots: localVaultRoots(),
    })
    if (!retarget.success || !retarget.data) {
      return {
        status: 'failed',
        errorCode: retarget.errorCode ?? 'RETARGET_FAILED',
        error: retarget.error ?? 'Retargeting failed',
      }
    }
    const retargetClean =
      retarget.data.summary.failed === 0 && retarget.data.summary.missingReferences === 0

    onProgress?.({ phase: 'exporting' })
    const exported = await api.solidworks.exportPdf(drawing.localPath, {
      outputPath: joinLocalPath(stagingDir, RENDER_FILE),
    })
    if (!exported.success || !exported.data?.outputFile) {
      if (exported.errorCode === 'SW_NOT_INSTALLED') {
        return { status: 'needs_solidworks', reason: 'solidworks_not_installed' }
      }
      return {
        status: 'failed',
        errorCode: exported.errorCode ?? 'EXPORT_FAILED',
        error: exported.error ?? 'PDF export failed',
      }
    }

    onProgress?.({ phase: 'uploading' })
    const read = await api.reviewPackage.readStagedFile(exported.data.outputFile)
    if (!read.success || read.data === undefined) {
      return { status: 'failed', errorCode: 'READ_FAILED', error: read.error ?? 'PDF unreadable' }
    }
    const uploaded = await uploadFile(orgId, base64ToArrayBuffer(read.data))
    if (uploaded.error || !uploaded.hash) {
      return {
        status: 'failed',
        errorCode: 'UPLOAD_FAILED',
        error: uploaded.error ?? 'Upload failed',
      }
    }

    onProgress?.({ phase: 'recording' })
    const closureExact = closure.exact && retargetClean
    try {
      await recordDrawingPdf(fileVersionId, uploaded.hash, uploaded.size, { closureExact })
    } catch (err) {
      // Someone else rendered this version first; theirs stands.
      if (err instanceof ReviewRpcError && err.code === 'PDF_EXISTS') {
        const cached = await cachedResult(fileVersionId)
        if (cached) return cached
      }
      throw err
    }

    log.info('[ReviewPackage]', 'Drawing PDF generated', {
      fileVersionId,
      file: root.filePath,
      version: root.version,
      closureExact,
      bytes: uploaded.size,
    })
    return {
      status: 'generated',
      storageHash: uploaded.hash,
      fileSize: uploaded.size,
      closureExact,
    }
  } finally {
    const removed = await api.reviewPackage.removeStagingDir(stagingDir)
    if (!removed.success) {
      log.warn('[ReviewPackage]', 'Could not remove the PDF staging folder', {
        stagingDir,
        error: removed.error,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Download stored content into the review PDF cache (`<userData>/review-pdf-cache/<hash>.pdf`,
 * bounded by the main process) and return its path. A cached file is re-hashed before use.
 */
export async function downloadPdfToCache(storageHash: string): Promise<string> {
  // The hash names the cache file; anything but a plain hash could write outside the cache.
  if (!isStorageHash(storageHash)) throw new Error('Invalid PDF content hash')
  const api = electron()
  const dir = await api.reviewPackage.getPdfCacheDir()
  if (!dir.success || !dir.path) throw new Error(dir.error ?? 'Review PDF cache unavailable')
  const localPath = joinLocalPath(dir.path, `${storageHash}.pdf`)

  if (await api.fileExists(localPath)) {
    const hashed = await api.hashFile(localPath)
    if (hashed.success && hashed.hash === storageHash) return localPath
  }

  const { url, error } = await getDownloadUrl(requireOrgId(), storageHash)
  if (!url) throw new Error(error ?? 'No download URL for the PDF')
  const download = await api.downloadUrl(url, localPath, storageHash)
  if (!download.success) throw new Error(download.error ?? 'PDF download failed')
  return localPath
}

/**
 * What the viewer shows for a review item at its pinned version.
 * - The item is a PDF version: that version's content, cached locally.
 * - The item is a drawing with a stored render (`item.pdf`, else looked up): the render, cached.
 * - A drawing without a render: `pdf_pending`.
 * - Anything else: `unsupported`.
 * Throws when a PDF exists but cannot be downloaded (offline, storage error).
 */
export async function resolveReviewItemPreview(item: ReviewItemDetail): Promise<ReviewItemPreview> {
  const name = item.file.fileName || item.file.filePath
  if (isPdfPath(name)) {
    return { kind: 'pdf', localPath: await downloadPdfToCache(item.version.contentHash) }
  }
  if (!isDrawingPath(name)) return { kind: 'unsupported' }

  const pdf = item.pdf ?? (await getDrawingPdf(item.version.fileVersionId))
  if (!pdf) return { kind: 'pdf_pending' }
  return { kind: 'pdf', localPath: await downloadPdfToCache(pdf.storageHash) }
}
