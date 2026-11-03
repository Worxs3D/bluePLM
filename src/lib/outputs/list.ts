/**
 * Reading the outputs of versions, and keeping the store's copy (`versionOutputs`, the file list
 * chevron's source) in step.
 */

import { listOutputHeadsForFiles, listOutputsForVersions } from '@/lib/supabase/versionOutputs'
import { usePDMStore } from '@/stores/pdmStore'
import type { VersionedOutput, VersionOutput } from '@/types/versionOutputs'

/**
 * The outputs of one version: its drawing PDF and its exports, in one shape, sorted (pdf, step,
 * iges, stl, dxf). `fileId` scopes the answer; rows of another file are dropped. Stores the list.
 */
export async function listVersionOutputs(
  fileId: string,
  fileVersionId: string,
): Promise<VersionOutput[]> {
  const byVersion = await listOutputsForVersions([fileVersionId])
  const outputs = (byVersion.get(fileVersionId) ?? []).filter((o) => o.fileId === fileId)
  usePDMStore.getState().setVersionOutputs(new Map([[fileVersionId, outputs]]))
  return outputs
}

/** The outputs of several versions at once (the file list expanding many rows). Stores them. */
export async function loadVersionOutputs(
  fileVersionIds: readonly string[],
): Promise<Map<string, VersionOutput[]>> {
  const byVersion = await listOutputsForVersions(fileVersionIds)
  const complete = new Map<string, VersionOutput[]>()
  for (const id of new Set(fileVersionIds)) complete.set(id, byVersion.get(id) ?? [])
  usePDMStore.getState().setVersionOutputs(complete)
  return complete
}

/**
 * The newest output of each kind of these files across their versions (store `fileOutputHeads`,
 * the file list's output rows and Outputs column). Stores them.
 */
export async function loadOutputHeads(fileIds: readonly string[]): Promise<Map<string, VersionedOutput[]>> {
  const heads = await listOutputHeadsForFiles(fileIds)
  usePDMStore.getState().setFileOutputHeads(heads)
  return heads
}
