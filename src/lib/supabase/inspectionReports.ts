/**
 * Inspection reports (schema 504): generated workbooks attached to a checked-in drawing version.
 *
 * A report follows its file's vault (`my_accessible_vault_ids()`): members without the vault see
 * no report and cannot read its content. Creating or changing one needs module:explorer edit;
 * deleting is for its creator or an administrator. The organization, file, version and creator are
 * fixed by the database, which also sets `created_by` / `updated_by` / `returned_by` to the
 * signed-in user (trg_inspection_report_stamp), so the client never sends them.
 *
 * Content (template and report workbooks, embedded drawing PDFs, returned workbooks) lives in the
 * vault bucket by SHA-256: `uploadInspectionContent` / `downloadInspectionContent`. Every function
 * throws an Error with the database's message on failure.
 *
 * The generated Supabase types predate schema 504, so these calls go through an untyped view of the
 * same authenticated client and every row is mapped through a local row type.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseClient } from './client'

import { downloadFile, hashFile, uploadFile } from '@/lib/storage'
import type { Json } from '@/types/supabase'
import type {
  InspectionReport,
  InspectionReportCreate,
  InspectionReportStatus,
  InspectionReportUpdate,
  InspectionResultsSummary,
  InspectionRowsAtVersion,
  InspectionSnapshotRow,
} from '@/types/inspectionReports'

/** inspection_report as the database returns it. */
interface InspectionReportRow {
  id: string
  org_id: string
  file_id: string
  file_version_id: string
  template_id: string | null
  template_name: string | null
  template_hash: string | null
  report_number: string | null
  title: string | null
  status: InspectionReportStatus
  storage_hash: string
  file_size: number | string
  characteristic_count: number
  drawing_pdf_hash: string | null
  returned_hash: string | null
  returned_at: string | null
  returned_by: string | null
  results: Json | null
  results_summary: InspectionResultsSummary | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
}

const REPORT_COLUMNS =
  'id, org_id, file_id, file_version_id, template_id, template_name, template_hash, report_number, title, status, storage_hash, file_size, characteristic_count, drawing_pdf_hash, returned_hash, returned_at, returned_by, results, results_summary, notes, created_by, created_at, updated_by, updated_at'

/** inspection_characteristic_version columns, tolerance_source included (schema 504). */
const SNAPSHOT_COLUMNS =
  'id, file_version_id, org_id, sort_order, balloon_number, char_id, zone, char_type, sub_type, nominal_value, unit, plus_tolerance, minus_tolerance, upper_limit, lower_limit, classification, inspection_method, operation, aql, sample_size, supplier_inspection_rate, internal_inspection_rate, reference, comments, created_at, source_key, source_sheet, source_view, tolerance_source'

/** How many older versions one probe for a snapshot looks at. */
const OLDER_VERSION_BATCH = 20

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Thrown by createInspectionReport / updateInspectionReport when the drawing already has a report
 * with this number (unique per file); retry with the next number.
 */
export class InspectionReportNumberTakenError extends Error {
  readonly code = 'REPORT_NUMBER_TAKEN'
  constructor(readonly reportNumber: string | null) {
    super(`Report number ${reportNumber ?? ''} is already used on this drawing`)
    this.name = 'InspectionReportNumberTakenError'
  }
}

/** The database error as an Error, with a report-number conflict as InspectionReportNumberTakenError. */
function reportWriteError(
  error: { message: string; code?: string },
  reportNumber: string | null | undefined,
): Error {
  if (
    error.code === '23505' &&
    error.message.includes('inspection_report_file_id_report_number_key')
  ) {
    return new InspectionReportNumberTakenError(reportNumber ?? null)
  }
  return new Error(error.message)
}

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

export function toInspectionReport(row: InspectionReportRow): InspectionReport {
  return {
    id: row.id,
    orgId: row.org_id,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    templateId: row.template_id,
    templateName: row.template_name,
    templateHash: row.template_hash,
    reportNumber: row.report_number,
    title: row.title,
    status: row.status,
    storageHash: row.storage_hash,
    fileSize: Number(row.file_size),
    characteristicCount: row.characteristic_count,
    drawingPdfHash: row.drawing_pdf_hash,
    returnedHash: row.returned_hash,
    returnedAt: row.returned_at,
    returnedBy: row.returned_by,
    results: row.results,
    resultsSummary: row.results_summary,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

function toUpdateRow(patch: InspectionReportUpdate): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.reportNumber !== undefined) row.report_number = patch.reportNumber
  if (patch.title !== undefined) row.title = patch.title
  if (patch.status !== undefined) row.status = patch.status
  if (patch.storageHash !== undefined) row.storage_hash = patch.storageHash
  if (patch.fileSize !== undefined) row.file_size = patch.fileSize
  if (patch.characteristicCount !== undefined) row.characteristic_count = patch.characteristicCount
  if (patch.drawingPdfHash !== undefined) row.drawing_pdf_hash = patch.drawingPdfHash
  if (patch.returnedHash !== undefined) row.returned_hash = patch.returnedHash
  if (patch.results !== undefined) row.results = patch.results
  if (patch.resultsSummary !== undefined) row.results_summary = patch.resultsSummary
  if (patch.notes !== undefined) row.notes = patch.notes
  return row
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Reports of one file (a drawing), newest first. */
export async function listInspectionReports(fileId: string): Promise<InspectionReport[]> {
  const { data, error } = await db()
    .from('inspection_report')
    .select(REPORT_COLUMNS)
    .eq('file_id', fileId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as InspectionReportRow[]).map(toInspectionReport)
}

/** Reports of several files, grouped by file id (newest first in each). Files with none are absent. */
export async function listInspectionReportsForFiles(
  fileIds: readonly string[],
): Promise<Map<string, InspectionReport[]>> {
  const byFile = new Map<string, InspectionReport[]>()
  const unique = [...new Set(fileIds)]
  // Ids go in the query string; keep each request well under URL limits.
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await db()
      .from('inspection_report')
      .select(REPORT_COLUMNS)
      .in('file_id', unique.slice(i, i + 100))
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as InspectionReportRow[]) {
      const report = toInspectionReport(row)
      const list = byFile.get(report.fileId)
      if (list) list.push(report)
      else byFile.set(report.fileId, [report])
    }
  }
  return byFile
}

/** Version numbers of drawing versions (for listing reports by version), keyed by file_version id. */
export async function getFileVersionNumbers(
  fileVersionIds: readonly string[],
): Promise<Map<string, number>> {
  const numbers = new Map<string, number>()
  const unique = [...new Set(fileVersionIds)]
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await db()
      .from('file_version')
      .select('id, version')
      .in('id', unique.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ id: string; version: number }>)
      numbers.set(row.id, row.version)
  }
  return numbers
}

/** One report by id, or null when it does not exist or its vault is not readable. */
export async function getInspectionReport(id: string): Promise<InspectionReport | null> {
  const { data, error } = await db()
    .from('inspection_report')
    .select(REPORT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toInspectionReport(data as InspectionReportRow) : null
}

/** Record a generated report. Upload the workbook (and drawing PDF) first and pass their hashes. */
export async function createInspectionReport(
  input: InspectionReportCreate,
): Promise<InspectionReport> {
  const { data, error } = await db()
    .from('inspection_report')
    .insert({
      ...(input.id ? { id: input.id } : {}),
      org_id: input.orgId,
      file_id: input.fileId,
      file_version_id: input.fileVersionId,
      template_id: input.templateId ?? null,
      template_name: input.templateName ?? null,
      template_hash: input.templateHash ?? null,
      report_number: input.reportNumber ?? null,
      title: input.title ?? null,
      status: input.status ?? 'issued',
      storage_hash: input.storageHash,
      file_size: input.fileSize,
      characteristic_count: input.characteristicCount ?? 0,
      drawing_pdf_hash: input.drawingPdfHash ?? null,
      results: input.results ?? null,
      results_summary: input.resultsSummary ?? null,
      notes: input.notes ?? null,
    })
    .select(REPORT_COLUMNS)
    .single()
  if (error) throw reportWriteError(error, input.reportNumber)
  return toInspectionReport(data as InspectionReportRow)
}

/** Change a report (status, returned workbook and results, notes, ...). */
export async function updateInspectionReport(
  id: string,
  patch: InspectionReportUpdate,
): Promise<InspectionReport> {
  const { data, error } = await db()
    .from('inspection_report')
    .update(toUpdateRow(patch))
    .eq('id', id)
    .select(REPORT_COLUMNS)
    .maybeSingle()
  if (error) throw reportWriteError(error, patch.reportNumber)
  if (!data) throw new Error('Report not found, or you do not have permission to edit it')
  return toInspectionReport(data as InspectionReportRow)
}

/** Delete a report (its creator or an administrator). The workbook bytes stay in the vault bucket. */
export async function deleteInspectionReport(id: string): Promise<void> {
  const { data, error } = await db().from('inspection_report').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('Report not found, or only its creator or an administrator can delete it')
  }
}

// ---------------------------------------------------------------------------
// The inspection rows a report is generated from
// ---------------------------------------------------------------------------

async function snapshotRows(fileVersionId: string): Promise<InspectionSnapshotRow[]> {
  const { data, error } = await db()
    .from('inspection_characteristic_version')
    .select(SNAPSHOT_COLUMNS)
    .eq('file_version_id', fileVersionId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as InspectionSnapshotRow[]
}

/**
 * The inspection rows of a drawing version, as a report of that version uses them.
 *
 * file_checkin() snapshots the live table each time it creates a version, so a version normally
 * has its own snapshot. A version whose inspection_hash is null had no inspection table: no rows,
 * exactly. A version with a fingerprint but no snapshot rows (created by a path that does not
 * snapshot, or before snapshots existed) falls back to the newest snapshot of an older version of
 * the same file, reported with `exact: false`.
 */
export async function getInspectionRowsAtVersion(
  fileId: string,
  fileVersionId: string,
): Promise<InspectionRowsAtVersion> {
  const { data: target, error: targetError } = await db()
    .from('file_version')
    .select('id, version, inspection_hash')
    .eq('id', fileVersionId)
    .eq('file_id', fileId)
    .maybeSingle()
  if (targetError) throw new Error(targetError.message)
  if (!target) throw new Error('Drawing version not found')
  const version = target as { id: string; version: number; inspection_hash: string | null }

  const own = await snapshotRows(version.id)
  if (own.length > 0 || version.inspection_hash === null) {
    return {
      rows: own,
      sourceFileVersionId: version.id,
      sourceVersion: version.version,
      exact: true,
    }
  }

  const { data: older, error: olderError } = await db()
    .from('file_version')
    .select('id, version')
    .eq('file_id', fileId)
    .lt('version', version.version)
    .order('version', { ascending: false })
  if (olderError) throw new Error(olderError.message)
  const candidates = (older ?? []) as Array<{ id: string; version: number }>

  for (let i = 0; i < candidates.length; i += OLDER_VERSION_BATCH) {
    const batch = candidates.slice(i, i + OLDER_VERSION_BATCH)
    const { data: hits, error } = await db()
      .from('inspection_characteristic_version')
      .select('file_version_id')
      .in(
        'file_version_id',
        batch.map((c) => c.id),
      )
    if (error) throw new Error(error.message)
    const withRows = new Set(
      ((hits ?? []) as Array<{ file_version_id: string }>).map((h) => h.file_version_id),
    )
    const newest = batch.find((c) => withRows.has(c.id))
    if (newest) {
      return {
        rows: await snapshotRows(newest.id),
        sourceFileVersionId: newest.id,
        sourceVersion: newest.version,
        exact: false,
      }
    }
  }
  return { rows: [], sourceFileVersionId: null, sourceVersion: null, exact: false }
}

// ---------------------------------------------------------------------------
// Content in the vault bucket
// ---------------------------------------------------------------------------

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * Store template or report content (a workbook, a PDF) in the organization's vault bucket by
 * SHA-256, deduplicated. Returns the hash and size a template or report row names.
 */
export async function uploadInspectionContent(
  orgId: string,
  bytes: Uint8Array,
): Promise<{ hash: string; size: number }> {
  const uploaded = await uploadFile(orgId, toArrayBuffer(bytes))
  if (uploaded.error || !uploaded.hash) throw new Error(uploaded.error ?? 'Upload failed')
  return { hash: uploaded.hash, size: uploaded.size }
}

/**
 * Read template or report content back by hash. The bytes are checked against the hash, so
 * damaged content is never handed out. Reading needs a readable template or report naming it
 * (can_read_vault_object).
 */
export async function downloadInspectionContent(orgId: string, hash: string): Promise<Uint8Array> {
  if (!SHA256_HEX.test(hash)) throw new Error('Invalid content hash')
  const { data, error } = await downloadFile(orgId, hash)
  if (error || !data) throw new Error(error ?? 'Download failed')
  const buffer = await data.arrayBuffer()
  const actual = await hashFile(buffer)
  if (actual !== hash) throw new Error('The stored content does not match its hash')
  return new Uint8Array(buffer)
}
