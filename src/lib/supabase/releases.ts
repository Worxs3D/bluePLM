/**
 * Released file versions on the server (schema 509): which versions of these files are released,
 * and the per-file list of export kinds not to regenerate at check-in. Released versions are set
 * only by `workflow_transition_apply` (a transition into a releasing state); clients read them.
 *
 * The release columns are not in the generated `Database` type until `npm run gen:types` runs
 * against 509, so these queries go through the untyped client, as `versionOutputs.ts` does.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { VersionRelease } from '@/types/releases'
import type { VersionOutputKind } from '@/types/versionOutputs'

import { getSupabaseClient } from './client'

const IN_BATCH = 100

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

interface ReleaseRow {
  id: string
  file_id: string
  version: number
  revision: string | null
  released_at: string
  released_by: string | null
  release_forced: boolean | null
  release_review_id: string | null
  release_note: string | null
  /** The revision the version was released as: the file's revision after the releasing transition, which may auto-increment it. */
  release_revision: string | null
}

const RELEASE_COLUMNS =
  'id, file_id, version, revision, released_at, released_by, release_forced, release_review_id, release_note, release_revision'

export function toVersionRelease(row: ReleaseRow): VersionRelease {
  return {
    fileId: row.file_id,
    fileVersionId: row.id,
    version: row.version,
    revision: row.release_revision ?? row.revision,
    releasedAt: row.released_at,
    releasedBy: row.released_by,
    forced: row.release_forced === true,
    reviewId: row.release_review_id,
    note: row.release_note,
  }
}

/**
 * Every released version of these files, newest version first per file. Every asked file is
 * present, with an empty list when none is released. Throws on a query error.
 */
export async function listReleasedVersions(fileIds: readonly string[]): Promise<Map<string, VersionRelease[]>> {
  const ids = [...new Set(fileIds)].filter(Boolean)
  const byFile = new Map<string, VersionRelease[]>(ids.map((id) => [id, []]))
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const { data, error } = await db()
      .from('file_version')
      .select(RELEASE_COLUMNS)
      .in('file_id', batch)
      .not('released_at', 'is', null)
      .order('version', { ascending: false })
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as ReleaseRow[]) byFile.get(row.file_id)?.push(toVersionRelease(row))
  }
  return byFile
}

/** The export kinds this file is not to regenerate at check-in (`file.auto_outputs_off`). */
export async function getAutoOutputsOff(fileId: string): Promise<VersionOutputKind[]> {
  const { data, error } = await db().from('file').select('auto_outputs_off').eq('id', fileId).maybeSingle()
  if (error) throw new Error(error.message)
  const kinds = (data as { auto_outputs_off: string[] | null } | null)?.auto_outputs_off ?? []
  return kinds as VersionOutputKind[]
}

/** The same for several files at once (the check-in queue). Files absent from the answer have none. */
export async function listAutoOutputsOff(fileIds: readonly string[]): Promise<Map<string, VersionOutputKind[]>> {
  const ids = [...new Set(fileIds)].filter(Boolean)
  const byFile = new Map<string, VersionOutputKind[]>()
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const { data, error } = await db().from('file').select('id, auto_outputs_off').in('id', batch)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ id: string; auto_outputs_off: string[] | null }>) {
      if (row.auto_outputs_off && row.auto_outputs_off.length > 0) {
        byFile.set(row.id, row.auto_outputs_off as VersionOutputKind[])
      }
    }
  }
  return byFile
}

/** Turn regenerating `kind` at check-in on or off for one file (`file_set_auto_output()`; explorer edit). */
export async function setAutoOutput(fileId: string, kind: VersionOutputKind, enabled: boolean): Promise<void> {
  const { error } = await db().rpc('file_set_auto_output', { p_file_id: fileId, p_kind: kind, p_enabled: enabled })
  if (error) throw new Error(error.message)
}

/** Why `inspection_report_overwrite()` refused. */
export type ReportOverwriteRefusal = 'RELEASED' | 'HAS_RETURN' | 'NO_EDIT_PERMISSION' | 'NOT_FOUND' | 'UNKNOWN'

export class ReportOverwriteError extends Error {
  constructor(
    readonly code: ReportOverwriteRefusal,
    message: string,
  ) {
    super(message)
    this.name = 'ReportOverwriteError'
  }
}

export interface ReportOverwriteInput {
  reportId: string
  storageHash: string
  fileSize: number
  characteristicCount: number
  drawingPdfHash: string | null
  templateId: string | null
  templateName: string | null
  templateHash: string | null
}

/**
 * Overwrite a report's workbook in place (same row, number and version): a regeneration of the
 * same version. Refused once the version is released (`RELEASED`) or a filled-in workbook came
 * back for it (`HAS_RETURN`); regenerate as a new report then.
 */
export async function overwriteInspectionReport(input: ReportOverwriteInput): Promise<void> {
  const { error } = await db().rpc('inspection_report_overwrite', {
    p_report_id: input.reportId,
    p_storage_hash: input.storageHash,
    p_file_size: input.fileSize,
    p_characteristic_count: input.characteristicCount,
    p_drawing_pdf_hash: input.drawingPdfHash,
    p_template_id: input.templateId,
    p_template_name: input.templateName,
    p_template_hash: input.templateHash,
  })
  if (!error) return
  const hint = (error as { hint?: string }).hint ?? ''
  const code: ReportOverwriteRefusal =
    hint === 'RELEASED' || hint === 'HAS_RETURN' || hint === 'NO_EDIT_PERMISSION' || hint === 'NOT_FOUND'
      ? hint
      : 'UNKNOWN'
  throw new ReportOverwriteError(code, error.message)
}
