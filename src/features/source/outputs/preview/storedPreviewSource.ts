/**
 * Which stored output can stand in for a CAD file's embedded thumbnail in the Preview tab.
 *
 * The thumbnail is the bitmap SOLIDWORKS saved inside the file, a few hundred pixels at most, so
 * a drawing is unreadable at any zoom. A checked-in version usually has better: its drawing PDF
 * (vector, generated at check-in) or a STEP/STL export. Those belong to one version, so they are
 * only shown when the content on disk is exactly that version (or there is no local copy and the
 * newest version is what the row stands for). An edited, added or older local copy keeps the
 * thumbnail, which is the only image of what is actually there. Pure; the hook and tests call it.
 */

import type { DiffStatus } from '@/stores/types'
import type { VersionedOutput } from '@/types/versionOutputs'

import { PREVIEW_MAX_BYTES, type PreviewKind } from './childPreviewModel'

export interface StoredPreviewFile {
  extension?: string | null
  isDirectory?: boolean
  diffStatus?: DiffStatus
  localVersion?: number
  pdmData?: { id?: string | null; version?: number | null } | null
}

export interface StoredPreviewSource {
  output: VersionedOutput
  kind: Extract<PreviewKind, { kind: 'pdf' } | { kind: 'model' }>
}

/** Model export kinds in the order the preview prefers them: STL needs no tessellation. */
const MODEL_ORDER = ['stl', 'step', 'iges'] as const

/**
 * The checked-in version whose content the row shows, or null when no stored output can match it
 * (new, edited, deleted or ignored locally, or an older copy whose version is not recorded).
 */
export function previewContentVersion(file: StoredPreviewFile): number | null {
  const latest = file.pdmData?.version ?? null
  if (!file.pdmData?.id || latest === null) return null
  switch (file.diffStatus) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'deleted_remote':
    case 'ignored':
      return null
    case 'outdated':
      return file.localVersion ?? null
    default:
      // In sync, moved on disk with the same content, or no local copy (cloud, moved_away).
      return latest
  }
}

function extensionOf(file: StoredPreviewFile): string {
  return (file.extension ?? '').toLowerCase()
}

/**
 * The stored output to preview for `file`: a drawing's PDF, or a part's or assembly's model
 * export (STL, then STEP, then IGES; the asked configuration first, then the one the version was
 * saved in) that the 3D viewer accepts. Null: show the thumbnail.
 */
export function pickStoredPreview(
  file: StoredPreviewFile,
  heads: readonly VersionedOutput[] | undefined,
  configuration?: string | null,
): StoredPreviewSource | null {
  if (file.isDirectory || !heads || heads.length === 0) return null
  const version = previewContentVersion(file)
  if (version === null) return null
  const fileId = file.pdmData?.id
  const ofVersion = heads.filter((o) => o.version === version && o.fileId === fileId)
  const ext = extensionOf(file)

  if (ext === '.slddrw') {
    const pdf = ofVersion.find((o) => o.kind === 'pdf')
    return pdf ? { output: pdf, kind: { kind: 'pdf' } } : null
  }
  if (ext !== '.sldprt' && ext !== '.sldasm') return null

  const fits = ofVersion.filter((o) => o.fileSize <= PREVIEW_MAX_BYTES.model)
  const configs = configuration ? [configuration, null] : [null]
  for (const config of configs) {
    for (const kind of MODEL_ORDER) {
      const output = fits.find((o) => o.kind === kind && o.configuration === config)
      if (output) return { output, kind: { kind: 'model', format: kind } }
    }
  }
  return null
}
