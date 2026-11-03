/**
 * Outputs Slice
 *
 * The version outputs (drawing PDFs and STEP/IGES/STL/DXF exports, schema 505) the app has read,
 * keyed by file_version id, and the background generation jobs (the check-in queue and any
 * Generate the user starts through `src/lib/outputs`). The file list chevron shows both. Session
 * state only. Bounded: the least recently written versions are dropped past
 * `MAX_VERSIONS_WITH_OUTPUTS`, and finished jobs past `MAX_OUTPUT_JOBS`, so a session that runs
 * for weeks keeps a fixed footprint.
 */

import { StateCreator } from 'zustand'

import type { ChildSelection } from '../../features/source/outputs/preview/childPreviewModel'
import type { VersionRelease } from '../../types/releases'
import type { VersionedOutput, VersionOutput, VersionOutputKind } from '../../types/versionOutputs'
import type { DrawingRefItem, PDMStoreState } from '../types'

export const MAX_VERSIONS_WITH_OUTPUTS = 500
export const MAX_OUTPUT_JOBS = 200
/** Files whose latest version id the file list has resolved (for the outputs under its chevron). */
export const MAX_FILE_OUTPUT_VERSIONS = 500
/** Section headers under expanded files the user opened or closed against their default. */
export const MAX_FILE_SECTION_TOGGLES = 2000

/** The checked-in version of a file whose outputs the file list shows. */
export interface FileOutputVersion {
  version: number
  fileVersionId: string
}

export type OutputJobStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed'

export interface OutputJob {
  /** `${fileId}:${kind}:${configuration ?? ''}` */
  key: string
  fileId: string
  /** Set once the version is known (the queue resolves it when the job starts). */
  fileVersionId: string | null
  kind: VersionOutputKind
  configuration: string | null
  fileName: string
  status: OutputJobStatus
  /** Why it was skipped or failed (an error code or message), for the tooltip and the log. */
  detail: string | null
  /** Started from a check-in (true) or by the user. */
  auto: boolean
  updatedAt: number
}

export interface OutputsSlice {
  /** Outputs per file_version id, sorted. An empty list means "loaded, none". */
  versionOutputs: Map<string, VersionOutput[]>
  setVersionOutputs: (byVersion: ReadonlyMap<string, VersionOutput[]>) => void
  clearVersionOutputs: () => void
  /** Generation jobs by key; finished ones stay (bounded) so a row can show the last result. */
  outputJobs: Map<string, OutputJob>
  upsertOutputJob: (job: OutputJob) => void
  clearOutputJobs: () => void
  /**
   * file id -> the newest output of each kind and configuration across its versions, with the
   * version it came from (an older one is shown as out of date). Bounded like `fileOutputVersions`.
   */
  fileOutputHeads: Map<string, VersionedOutput[]>
  setFileOutputHeads: (byFile: ReadonlyMap<string, VersionedOutput[]>) => void
  /** file id -> the version (number and id) whose outputs the file list shows. */
  fileOutputVersions: Map<string, FileOutputVersion>
  setFileOutputVersions: (byFile: ReadonlyMap<string, FileOutputVersion>) => void
  /**
   * The output or inspection report row selected under a file, shown in the Preview tab. Valid
   * only while `selectedFiles` is still its anchor (`activeChildSelection` in
   * src/features/source/outputs/preview/childPreviewModel.ts); write it through `selectChildRow`.
   * Session state, never persisted.
   */
  childSelection: ChildSelection | null
  setChildSelection: (selection: ChildSelection | null) => void
  /**
   * file id -> its released versions, newest first (schema 509; `loadFileReleases`). An empty list
   * means "loaded, none released". Bounded like `fileOutputHeads`.
   */
  fileReleases: Map<string, VersionRelease[]>
  setFileReleases: (byFile: ReadonlyMap<string, VersionRelease[]>) => void
  /**
   * Chevron section headers (`${filePath}::${section}`) the user flipped from their default
   * (`fileSectionExpanded` in FileList/fileSections.ts). Session state, bounded.
   */
  fileSectionToggles: Set<string>
  toggleFileSection: (key: string) => void
  /** part/assembly file id -> the drawings that reference it (the Drawings section). Bounded. */
  modelDrawings: Map<string, DrawingRefItem[]>
  setModelDrawings: (byFile: ReadonlyMap<string, DrawingRefItem[]>) => void
  /** part/assembly file id -> the assemblies that reference it (the Used in section). Bounded. */
  modelUsedIn: Map<string, DrawingRefItem[]>
  setModelUsedIn: (byFile: ReadonlyMap<string, DrawingRefItem[]>) => void
}

export function outputJobKey(fileId: string, kind: VersionOutputKind, configuration: string | null): string {
  return `${fileId}:${kind}:${configuration ?? ''}`
}

/** Written ids move to the end (most recent); the oldest go past `max`. */
export function mergeVersionOutputs(
  current: ReadonlyMap<string, VersionOutput[]>,
  byVersion: ReadonlyMap<string, VersionOutput[]>,
  max = MAX_VERSIONS_WITH_OUTPUTS,
): Map<string, VersionOutput[]> {
  const next = new Map(current)
  for (const [id, outputs] of byVersion) {
    next.delete(id)
    next.set(id, outputs)
  }
  for (const key of next.keys()) {
    if (next.size <= max) break
    next.delete(key)
  }
  return next
}

/** Written file ids move to the end (most recent); the oldest go past `max`. */
export function mergeFileOutputVersions<T>(
  current: ReadonlyMap<string, T>,
  byFile: ReadonlyMap<string, T>,
  max = MAX_FILE_OUTPUT_VERSIONS,
): Map<string, T> {
  const next = new Map(current)
  for (const [id, entry] of byFile) {
    next.delete(id)
    next.set(id, entry)
  }
  for (const key of next.keys()) {
    if (next.size <= max) break
    next.delete(key)
  }
  return next
}

/** Flip one key; the oldest flips go past `max` (they fall back to their default). */
export function toggleSetKey(current: ReadonlySet<string>, key: string, max = MAX_FILE_SECTION_TOGGLES): Set<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  for (const k of next) {
    if (next.size <= max) break
    next.delete(k)
  }
  return next
}

/** The job written last; finished jobs beyond `max` are dropped oldest first (active ones stay). */
export function mergeOutputJob(
  current: ReadonlyMap<string, OutputJob>,
  job: OutputJob,
  max = MAX_OUTPUT_JOBS,
): Map<string, OutputJob> {
  const next = new Map(current)
  next.delete(job.key)
  next.set(job.key, job)
  for (const [key, j] of next) {
    if (next.size <= max) break
    if (j.status !== 'queued' && j.status !== 'running') next.delete(key)
  }
  return next
}

export const createOutputsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  OutputsSlice
> = (set) => ({
  versionOutputs: new Map(),
  setVersionOutputs: (byVersion) =>
    set((state) => ({ versionOutputs: mergeVersionOutputs(state.versionOutputs, byVersion) })),
  clearVersionOutputs: () => set({ versionOutputs: new Map() }),
  outputJobs: new Map(),
  upsertOutputJob: (job) => set((state) => ({ outputJobs: mergeOutputJob(state.outputJobs, job) })),
  clearOutputJobs: () => set({ outputJobs: new Map() }),
  fileOutputHeads: new Map(),
  setFileOutputHeads: (byFile) =>
    set((state) => ({ fileOutputHeads: mergeFileOutputVersions(state.fileOutputHeads, byFile) })),
  fileOutputVersions: new Map(),
  setFileOutputVersions: (byFile) =>
    set((state) => ({ fileOutputVersions: mergeFileOutputVersions(state.fileOutputVersions, byFile) })),
  childSelection: null,
  setChildSelection: (childSelection) => set({ childSelection }),
  fileReleases: new Map(),
  setFileReleases: (byFile) =>
    set((state) => ({ fileReleases: mergeFileOutputVersions(state.fileReleases, byFile) })),
  fileSectionToggles: new Set(),
  toggleFileSection: (key) => set((state) => ({ fileSectionToggles: toggleSetKey(state.fileSectionToggles, key) })),
  modelDrawings: new Map(),
  setModelDrawings: (byFile) =>
    set((state) => ({ modelDrawings: mergeFileOutputVersions(state.modelDrawings, byFile) })),
  modelUsedIn: new Map(),
  setModelUsedIn: (byFile) => set((state) => ({ modelUsedIn: mergeFileOutputVersions(state.modelUsedIn, byFile) })),
})
