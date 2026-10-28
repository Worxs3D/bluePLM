/**
 * Version references at check-in: map the references read from a just-checked-in assembly or
 * drawing to `record_version_references` input. Pure.
 *
 * Each child is identified by its vault file id and the hash of its content on disk at this
 * moment. The server resolves the hash to the child's matching `file_versions` row (exact) or
 * falls back to the child's latest version (approximate, `exact = false`). A reference this
 * machine cannot place in the vault is sent by path, with no file id, and shows as missing.
 */

import type { SWReference } from '@/lib/supabase/files/mutations'
import type { LocalFile } from '@/stores/types'
import type { VersionReferenceInput } from '@/types/reviews'

/** A vault file this machine knows, as a reference target. */
export interface VaultFileCandidate {
  /** Absolute local path. */
  path: string
  relativePath: string
  name: string
  fileId: string
  /** Hash of the content on disk now; null when unknown. */
  contentHash: string | null
}

function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function baseName(path: string): string {
  const parts = norm(path).split('/')
  return parts[parts.length - 1] ?? ''
}

/**
 * The store's vault files as candidates. The hash is the local hash when known; a file in sync
 * with the server (no diff status) has the server's hash on disk. Anything else (modified,
 * outdated, cloud-only) gets no hash, so the server records an approximate edge rather than a
 * wrong exact one.
 */
export function candidatesFromFiles(files: ReadonlyArray<LocalFile>): VaultFileCandidate[] {
  const out: VaultFileCandidate[] = []
  for (const file of files) {
    if (file.isDirectory || !file.pdmData?.id) continue
    if (file.diffStatus === 'moved_away' || file.diffStatus === 'cloud') continue
    const inSync = file.diffStatus === undefined
    out.push({
      path: file.path,
      relativePath: file.relativePath,
      name: file.name,
      fileId: file.pdmData.id,
      contentHash: file.localHash ?? (inSync ? (file.pdmData.content_hash ?? null) : null),
    })
  }
  return out
}

interface CandidateIndex {
  byPath: Map<string, VaultFileCandidate>
  byRelative: Map<string, VaultFileCandidate>
  byName: Map<string, VaultFileCandidate | null>
}

/**
 * Indexes by candidate list. A bulk check-in maps every assembly and drawing against the same
 * store snapshot, so the vault-sized index is built once per snapshot, not once per file. Weak, so
 * an old snapshot's index goes with it.
 */
const indexCache = new WeakMap<ReadonlyArray<VaultFileCandidate>, CandidateIndex>()

function indexCandidates(candidates: ReadonlyArray<VaultFileCandidate>): CandidateIndex {
  const cached = indexCache.get(candidates)
  if (cached) return cached
  const byPath = new Map<string, VaultFileCandidate>()
  const byRelative = new Map<string, VaultFileCandidate>()
  const byName = new Map<string, VaultFileCandidate | null>()
  for (const candidate of candidates) {
    byPath.set(norm(candidate.path), candidate)
    byRelative.set(norm(candidate.relativePath).replace(/^\/+/, ''), candidate)
    const name = candidate.name.toLowerCase()
    // A name held by two vault files cannot identify either.
    byName.set(name, byName.has(name) ? null : candidate)
  }
  const index = { byPath, byRelative, byName }
  indexCache.set(candidates, index)
  return index
}

export function mapVersionReferences(
  references: ReadonlyArray<SWReference>,
  candidates: ReadonlyArray<VaultFileCandidate>,
  vaultRootPath?: string,
): VersionReferenceInput[] {
  const { byPath, byRelative, byName } = indexCandidates(candidates)
  const root = vaultRootPath ? norm(vaultRootPath) : null

  const resolve = (childPath: string): VaultFileCandidate | null => {
    const key = norm(childPath)
    const direct = byPath.get(key)
    if (direct) return direct
    if (root && key.startsWith(`${root}/`)) {
      const relative = byRelative.get(key.slice(root.length + 1))
      if (relative) return relative
    }
    return byName.get(baseName(childPath)) ?? null
  }

  const out: VersionReferenceInput[] = []
  const seen = new Set<string>()
  for (const reference of references) {
    const candidate = resolve(reference.childFilePath)
    const configuration = reference.configuration ?? null
    const key = `${candidate ? candidate.fileId : norm(reference.childFilePath)}|${configuration ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push(
      candidate
        ? {
            childFileId: candidate.fileId,
            childContentHash: candidate.contentHash,
            configuration,
            referenceType: reference.referenceType,
            quantity: reference.quantity,
          }
        : {
            childFileId: null,
            childPath: reference.childFilePath,
            configuration,
            referenceType: reference.referenceType,
            quantity: reference.quantity,
          },
    )
  }
  return out
}
