/**
 * Stage file versions on disk: `<root>/<vault-relative path>` at the pinned versions.
 *
 * Downloads go through the vault's signed URL and the main process's hash-verified
 * `downloadUrl`, the same path Get Latest uses. Each distinct content hash is downloaded once;
 * further files with the same content are copied from the first. A file already on disk with
 * the version's hash (or with the hash an earlier run recorded after retargeting) is skipped, so
 * an interrupted package resumes where it stopped.
 */

import { processWithConcurrency } from '@/lib/concurrency'
import { log } from '@/lib/logger'
import { getDownloadUrl } from '@/lib/storage'
import { getVersionDependencyClosure } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { DependencyClosureRow } from '@/types/reviews'

import { groupByContentHash, mergeClosures } from './closure'
import { joinLocalPath, packageRelativePath } from './layout'
import { packageKey } from './manifest'
import type {
  MergedClosure,
  PackageFile,
  StagedFile,
  StageProgressCallback,
  StageResult,
} from './types'

/** Parallel downloads. Each one streams to disk in the main process. */
export const STAGE_CONCURRENCY = 6
/** Parallel closure queries; each is one recursive RPC. */
const CLOSURE_CONCURRENCY = 4

export interface StageOptions {
  orgId: string
  onProgress?: StageProgressCallback
  isCancelled?: () => boolean
  /** `path|originalHash` -> hash on disk after an earlier run's retargeting. */
  previousPackagedHashes?: ReadonlyMap<string, string>
}

export function requireOrgId(): string {
  const orgId = usePDMStore.getState().organization?.id
  if (!orgId) throw new Error('Not signed in to an organization')
  return orgId
}

function electron() {
  const api = window.electronAPI
  if (!api) throw new Error('Review packages need the desktop app')
  return api
}

/** Closures of several versions, fetched with bounded parallelism and merged. */
export async function fetchMergedClosure(
  fileVersionIds: ReadonlyArray<string>,
): Promise<MergedClosure> {
  const unique = [...new Set(fileVersionIds)]
  const closures: DependencyClosureRow[][] = await processWithConcurrency(
    unique,
    CLOSURE_CONCURRENCY,
    (id) => getVersionDependencyClosure(id),
  )
  return mergeClosures(closures)
}

async function hashOnDisk(path: string): Promise<string | null> {
  const api = electron()
  if (!(await api.fileExists(path))) return null
  const result = await api.hashFile(path)
  return result.success && result.hash ? result.hash : null
}

/** Stage `files` under `root`. Never throws for one file; failures come back as `failed`. */
export async function stageFiles(
  files: ReadonlyArray<PackageFile>,
  root: string,
  options: StageOptions,
): Promise<StagedFile[]> {
  const api = electron()
  const total = files.length
  let completed = 0
  const report = (fileName?: string) =>
    options.onProgress?.({ phase: 'downloading', completed, total, fileName })
  report()

  const stageGroup = async (group: PackageFile[]): Promise<StagedFile[]> => {
    const results: StagedFile[] = []
    let source: string | null = null

    for (const file of group) {
      const packagePath = packageRelativePath(file.filePath)
      const localPath = joinLocalPath(root, packagePath)
      const done = (status: StagedFile['status'], error?: string) => {
        results.push({ file, localPath, packagePath, status, error })
        completed++
        report(file.fileName)
      }

      if (options.isCancelled?.()) {
        done('failed', 'cancelled')
        continue
      }

      try {
        const existing = await hashOnDisk(localPath)
        const resumed = options.previousPackagedHashes?.get(
          `${packageKey(packagePath)}|${file.contentHash}`,
        )
        if (existing && (existing === file.contentHash || existing === resumed)) {
          if (existing === file.contentHash) source = source ?? localPath
          done('skipped')
          continue
        }
        // A stale copy from an earlier run is read-only; downloading over it would fail.
        if (existing) await api.setReadonly(localPath, false)

        if (source) {
          const copy = await api.copyFile(source, localPath)
          if (copy.success) {
            done('copied')
            continue
          }
          log.warn('[ReviewPackage]', 'Copy of identical content failed; downloading', {
            path: packagePath,
            error: copy.error,
          })
        }

        const { url, error } = await getDownloadUrl(options.orgId, file.contentHash)
        if (!url) {
          done('failed', error ?? 'No download URL')
          continue
        }
        const download = await api.downloadUrl(url, localPath, file.contentHash)
        if (!download.success) {
          done('failed', download.error ?? 'Download failed')
          continue
        }
        source = localPath
        done('downloaded')
      } catch (err) {
        done('failed', err instanceof Error ? err.message : String(err))
      }
    }
    return results
  }

  const groups = groupByContentHash(files)
  const perGroup = await processWithConcurrency(groups, STAGE_CONCURRENCY, stageGroup)
  return perGroup.flat()
}

/**
 * Stage one file version and its dependency closure under `destDir`, at the files' vault-relative
 * paths. Used by PDF generation (into a temp folder); the package download stages several items
 * through `fetchMergedClosure` + `stageFiles` instead.
 */
export async function stageVersionClosure(
  fileVersionId: string,
  destDir: string,
  onProgress?: StageProgressCallback,
): Promise<StageResult> {
  const orgId = requireOrgId()
  onProgress?.({ phase: 'resolving', completed: 0, total: 1 })
  const closure = await fetchMergedClosure([fileVersionId])
  const staged = await stageFiles(closure.files, destDir, { orgId, onProgress })
  return {
    root: destDir,
    closure,
    staged,
    failed: staged.filter((s) => s.status === 'failed'),
  }
}
