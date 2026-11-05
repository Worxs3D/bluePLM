/**
 * Open a checked-in version with its references (gap 12 b, desktop only).
 *
 * 1. Fetch the version's dependency closure (`fetchMergedClosure`, the review package's).
 * 2. Refuse while a same-named document is open in SOLIDWORKS outside the entry: SOLIDWORKS would
 *    use that one instead of the staged file (the PDF render's rule, `openDocumentNameClashes`).
 * 3. Prepare the version's cache entry under userData (never a vault working folder). When its
 *    marker matches this closure and every file is unchanged on disk, open it as it is.
 * 4. Otherwise stage the closure into the entry (`stageFiles`: hash-verified downloads,
 *    deduplicated, resumable), retarget the assemblies and drawings at each other through the
 *    service's `retargetReferences` exactly as `download-review-package` does, make every file
 *    read-only, and write the marker last.
 * 5. Open the root through `versionOpen.openRoot`, which hands only a SOLIDWORKS file inside the
 *    cache to the shell. The opened path itself is checked, never the row's display name.
 *
 * An approximate closure (versions checked in before schema 107) is staged and opened too, and the
 * result says so; the caller tells the user. Without a usable service an assembly or drawing is not
 * opened at all, because its references would still point at today's vault files.
 */

import { log } from '@/lib/logger'
import { fetchMergedClosure, requireOrgId, stageFiles } from '@/lib/reviewPackage/stage'
import { isRetargetable, joinLocalPath, openDocumentNameClashes, packageRelativePath } from '@/lib/reviewPackage/layout'
import { indexRetargetResults, packageKey } from '@/lib/reviewPackage/manifest'
import type { MergedClosure, StagedFile } from '@/lib/reviewPackage/types'
import { checkSwServiceFeature, SW_SERVICE_VERSION_RETARGET_REFERENCES } from '@/lib/swServiceVersion'
import { usePDMStore } from '@/stores/pdmStore'

import {
  fileUnchanged,
  markerMatchesClosure,
  markerToJson,
  MARKER_FORMAT,
  parseMarker,
  previousHashesFromMarker,
} from './marker'
import type { CacheMarker, CacheMarkerFile, OpenVersionResult, VersionOpenProgress } from './types'

type ElectronApi = NonNullable<Window['electronAPI']>

/** The parts of the desktop bridge this pipeline uses. */
export type VersionOpenApi = Pick<ElectronApi, 'versionOpen' | 'statFile' | 'setReadonlyBatch' | 'hashFile'> & {
  solidworks: Pick<ElectronApi['solidworks'], 'getServiceStatus' | 'getOpenDocuments' | 'retargetReferences'>
}

export interface VersionOpenDeps {
  api: () => VersionOpenApi | null
  closure: (fileVersionId: string) => Promise<MergedClosure>
  stage: typeof stageFiles
  orgId: () => string
  vaultRoots: () => string[]
  now: () => Date
}

function localVaultRoots(): string[] {
  const state = usePDMStore.getState()
  const roots = new Set<string>()
  for (const vault of state.connectedVaults) if (vault.localPath) roots.add(vault.localPath)
  if (state.vaultPath) roots.add(state.vaultPath)
  return [...roots]
}

export const defaultVersionOpenDeps: VersionOpenDeps = {
  api: () => (window.electronAPI ?? null) as VersionOpenApi | null,
  closure: (id) => fetchMergedClosure([id]),
  stage: stageFiles,
  orgId: requireOrgId,
  vaultRoots: localVaultRoots,
  now: () => new Date(),
}

/** Parts, assemblies and drawings: what SOLIDWORKS opens. */
export function isOpenableWithReferences(fileName: string): boolean {
  return /\.(sldprt|sldasm|slddrw)$/i.test(fileName)
}

export interface OpenVersionOptions {
  onProgress?: (progress: VersionOpenProgress) => void
  isCancelled?: () => boolean
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function serviceReason(api: VersionOpenApi): Promise<'service_offline' | 'service_outdated' | null> {
  const status = await api.solidworks.getServiceStatus()
  if (!status?.data?.running) return 'service_offline'
  const feature = checkSwServiceFeature(status.data.version ?? null, SW_SERVICE_VERSION_RETARGET_REFERENCES)
  return feature.status === 'incompatible' ? 'service_outdated' : null
}

/** Whether every file the marker lists is still on disk as it was left. */
async function entryIntact(api: VersionOpenApi, entry: string, marker: CacheMarker): Promise<boolean> {
  for (const file of marker.files) {
    const stat = await api.statFile(joinLocalPath(entry, file.path))
    if (!fileUnchanged(file, stat)) return false
  }
  return true
}

function opened(path: string, reused: boolean, marker: CacheMarker): OpenVersionResult {
  return {
    status: 'opened',
    path,
    reused,
    exact: marker.exact,
    approximate: marker.approximate,
    missing: marker.missing,
    conflicts: marker.conflicts,
    retargetFailed: marker.retargetFailed,
    retargetMissing: marker.retargetMissing,
  }
}

async function openRoot(api: VersionOpenApi, path: string): Promise<string | null> {
  const result = await api.versionOpen.openRoot(path)
  return result.success ? null : (result.error ?? 'Could not open the file')
}

const inFlight = new Map<string, Promise<OpenVersionResult>>()

/**
 * Stage `fileVersionId` with its closure into its cache entry (or reuse the entry) and open it in
 * SOLIDWORKS. Never throws; a second call for a version already being opened joins the first.
 */
export function openVersionWithReferences(
  fileVersionId: string,
  options: OpenVersionOptions = {},
  deps: VersionOpenDeps = defaultVersionOpenDeps,
): Promise<OpenVersionResult> {
  const running = inFlight.get(fileVersionId)
  if (running) return running
  const work = run(fileVersionId, options, deps)
    .catch((err): OpenVersionResult => {
      log.warn('[VersionOpen]', 'Open with references failed', { fileVersionId, error: errorText(err) })
      return { status: 'failed', error: errorText(err) }
    })
    .finally(() => inFlight.delete(fileVersionId))
  inFlight.set(fileVersionId, work)
  return work
}

async function run(
  fileVersionId: string,
  options: OpenVersionOptions,
  deps: VersionOpenDeps,
): Promise<OpenVersionResult> {
  const api = deps.api()
  if (!api) return { status: 'failed', error: 'The desktop app is needed to open a version' }
  const progress = (phase: VersionOpenProgress['phase'], completed = 0, total = 0) =>
    options.onProgress?.({ phase, completed, total })

  progress('resolving')
  const closure = await deps.closure(fileVersionId)
  const root = closure.files.find((f) => f.fileVersionId === fileVersionId)
  if (!root) return { status: 'unsupported' }
  const rootPath = packageRelativePath(root.filePath)
  // The path that is opened decides, never the row's file name: a row named `x.sldasm` whose path
  // is `x.exe` must not reach the shell.
  if (!isOpenableWithReferences(rootPath)) return { status: 'unsupported' }
  if (options.isCancelled?.()) return { status: 'cancelled' }

  const prepared = await api.versionOpen.prepareEntry(fileVersionId)
  if (!prepared.success || !prepared.path) {
    return { status: 'failed', error: prepared.error ?? 'The version cache is not available' }
  }
  const entry = prepared.path
  const rootLocal = joinLocalPath(entry, rootPath)

  // A same-named document open outside this entry would be used instead of the staged file.
  const open = await api.solidworks.getOpenDocuments({ includeComponents: true })
  const clashes = openDocumentNameClashes(
    closure.files.map((f) => f.fileName),
    (open.data?.documents ?? []).map((d) => d.filePath),
    entry,
  )
  if (clashes.length > 0) return { status: 'same_name_open', documents: clashes }

  progress('checking')
  const previous = parseMarker(prepared.marker)
  if (markerMatchesClosure(previous, fileVersionId, closure) && (await entryIntact(api, entry, previous!))) {
    progress('opening')
    const error = await openRoot(api, rootLocal)
    if (error) return { status: 'failed', error }
    log.info('[VersionOpen]', 'Opened a cached version', { fileVersionId, files: closure.files.length })
    return opened(rootLocal, true, previous!)
  }

  const retargetable = closure.files.some((f) => isRetargetable(f.filePath))
  if (retargetable) {
    const reason = await serviceReason(api)
    if (reason) return { status: 'needs_service', reason }
  }

  const restage = await api.versionOpen.beginRestage(entry)
  if (!restage.success) return { status: 'failed', error: restage.error ?? 'The version cache is not writable' }

  const staged = await deps.stage(closure.files, entry, {
    orgId: deps.orgId(),
    isCancelled: options.isCancelled,
    previousPackagedHashes: previousHashesFromMarker(previous),
    onProgress: (p) => progress('downloading', p.completed, p.total),
  })
  if (options.isCancelled?.()) return { status: 'cancelled' }
  const failed = staged.filter((s) => s.status === 'failed')
  if (failed.length > 0) {
    return {
      status: 'failed',
      error: failed.map((f) => `${f.packagePath}: ${f.error ?? 'failed'}`).slice(0, 3).join('; '),
      failedFiles: failed.map((f) => f.packagePath),
    }
  }

  // Point the staged assemblies and drawings at each other, never at the vault.
  const retargetables = staged.filter((s) => isRetargetable(s.packagePath))
  let retargetFailed = 0
  let retargetMissing = 0
  if (retargetables.length > 0) {
    progress('retargeting')
    const result = await api.solidworks.retargetReferences({
      packageRoot: entry,
      files: retargetables.map((s) => s.localPath),
      vaultRoots: deps.vaultRoots(),
    })
    if (!result.success || !result.data) {
      return { status: 'failed', error: result.error ?? 'The references could not be pointed at the staged files' }
    }
    const outcomes = indexRetargetResults(entry, result.data.files)
    for (const s of retargetables) {
      const outcome = outcomes.get(packageKey(s.packagePath))
      if (!outcome || outcome.status === 'failed') retargetFailed++
      retargetMissing += outcome?.missingReferences.length ?? 0
    }
  }

  const marker = await finishEntry(api, entry, fileVersionId, rootPath, closure, staged, {
    retargetFailed,
    retargetMissing,
    stagedAt: deps.now().toISOString(),
  })

  progress('opening')
  const error = await openRoot(api, rootLocal)
  if (error) return { status: 'failed', error }
  log.info('[VersionOpen]', 'Staged and opened a version', {
    fileVersionId,
    files: closure.files.length,
    downloaded: staged.filter((s) => s.status === 'downloaded').length,
    exact: marker.exact,
    retargetFailed,
  })
  return opened(rootLocal, false, marker)
}

/** Hash retargeted files, make everything read-only, record what is on disk, write the marker. */
async function finishEntry(
  api: VersionOpenApi,
  entry: string,
  fileVersionId: string,
  rootPath: string,
  closure: MergedClosure,
  staged: readonly StagedFile[],
  extra: { retargetFailed: number; retargetMissing: number; stagedAt: string },
): Promise<CacheMarker> {
  const packaged = new Map<string, string>()
  for (const s of staged) {
    if (!isRetargetable(s.packagePath)) continue
    const hashed = await api.hashFile(s.localPath)
    if (hashed.success && hashed.hash) packaged.set(s.localPath, hashed.hash)
  }

  const readonly = await api.setReadonlyBatch(staged.map((s) => ({ path: s.localPath, readonly: true })))
  if (!readonly.success) log.warn('[VersionOpen]', 'Some staged files could not be made read-only', { entry })

  const files: CacheMarkerFile[] = []
  for (const s of staged) {
    const stat = await api.statFile(s.localPath)
    files.push({
      path: s.packagePath,
      fileVersionId: s.file.fileVersionId,
      originalHash: s.file.contentHash,
      packagedHash: packaged.get(s.localPath) ?? null,
      size: stat.success ? (stat.size ?? 0) : 0,
      // No mtime means the entry is never reused as it is (it restages, which skips good files).
      modifiedTime: stat.success ? (stat.modifiedTime ?? null) : null,
    })
  }

  const approximate = closure.files.some((f) => !f.exact)
  const marker: CacheMarker = {
    format: MARKER_FORMAT,
    formatVersion: 1,
    fileVersionId,
    rootPath,
    exact: closure.exact && extra.retargetFailed === 0 && extra.retargetMissing === 0,
    approximate,
    stagedAt: extra.stagedAt,
    files,
    missing: closure.missing.length,
    conflicts: closure.conflicts.length,
    retargetFailed: extra.retargetFailed,
    retargetMissing: extra.retargetMissing,
  }
  const written = await api.versionOpen.writeMarker(entry, markerToJson(marker))
  if (!written.success) {
    // The files are fine; the next open just stages again (and skips what matches).
    log.warn('[VersionOpen]', 'Could not write the cache marker', { entry, error: written.error })
  }
  return marker
}
