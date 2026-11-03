/**
 * Inspection templates (schema 504): the organization's library of Excel report templates.
 *
 * Members read the library; only administrators (`is_org_admin()`) insert, update or delete, and
 * the database refuses anyone else. The workbook bytes live in the vault bucket by SHA-256
 * (`uploadInspectionContent` in `./inspectionReports`); a row names them by `storage_hash`.
 * At most one live template is the default: setting `isDefault` clears the previous default in the
 * same statement (trg_inspection_template_stamp). `created_by` / `updated_by` are set by the
 * database. Every function throws an Error with the database's message on failure.
 *
 * The generated Supabase types predate schema 504, so these calls go through an untyped view of the
 * same authenticated client and every row is mapped through a local row type.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseClient } from './client'

import type { Json } from '@/types/supabase'
import type {
  InspectionTemplate,
  InspectionTemplateCreate,
  InspectionTemplateUpdate,
  InspectionReportType,
} from '@/types/inspectionReports'
import { isInspectionReportType } from '@/types/inspectionReports'

/** inspection_template as the database returns it. */
interface InspectionTemplateRow {
  id: string
  org_id: string
  name: string
  description: string | null
  storage_hash: string
  file_size: number | string
  original_filename: string | null
  revision: number
  is_default: boolean
  /** Schema 506. */
  report_types?: string[] | null
  default_for?: string[] | null
  layout: Json
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
}

const TEMPLATE_COLUMNS =
  'id, org_id, name, description, storage_hash, file_size, original_filename, revision, is_default, report_types, default_for, layout, archived_at, created_by, created_at, updated_by, updated_at'

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

function reportTypeList(value: string[] | null | undefined): InspectionReportType[] {
  return Array.isArray(value) ? value.filter(isInspectionReportType) : []
}

export function toInspectionTemplate(row: InspectionTemplateRow): InspectionTemplate {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    storageHash: row.storage_hash,
    fileSize: Number(row.file_size),
    originalFilename: row.original_filename,
    revision: row.revision,
    isDefault: row.is_default,
    reportTypes: reportTypeList(row.report_types),
    defaultFor: reportTypeList(row.default_for),
    layout: row.layout,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

function toUpdateRow(patch: InspectionTemplateUpdate): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.description !== undefined) row.description = patch.description
  if (patch.storageHash !== undefined) row.storage_hash = patch.storageHash
  if (patch.fileSize !== undefined) row.file_size = patch.fileSize
  if (patch.originalFilename !== undefined) row.original_filename = patch.originalFilename
  if (patch.revision !== undefined) row.revision = patch.revision
  if (patch.isDefault !== undefined) row.is_default = patch.isDefault
  if (patch.reportTypes !== undefined) row.report_types = patch.reportTypes
  if (patch.defaultFor !== undefined) row.default_for = patch.defaultFor
  if (patch.layout !== undefined) row.layout = patch.layout
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt
  return row
}

/** Templates of the organization, default first, then by name. Archived ones only when asked. */
export async function listInspectionTemplates(
  orgId: string,
  options: { includeArchived?: boolean } = {},
): Promise<InspectionTemplate[]> {
  let query = db().from('inspection_template').select(TEMPLATE_COLUMNS).eq('org_id', orgId)
  if (!options.includeArchived) query = query.is('archived_at', null)
  const { data, error } = await query
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as InspectionTemplateRow[]).map(toInspectionTemplate)
}

/** One template by id, or null when it does not exist or is not readable. */
export async function getInspectionTemplate(id: string): Promise<InspectionTemplate | null> {
  const { data, error } = await db()
    .from('inspection_template')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toInspectionTemplate(data as InspectionTemplateRow) : null
}

/** The organization's live default template, or null. */
export async function getDefaultInspectionTemplate(
  orgId: string,
): Promise<InspectionTemplate | null> {
  const { data, error } = await db()
    .from('inspection_template')
    .select(TEMPLATE_COLUMNS)
    .eq('org_id', orgId)
    .eq('is_default', true)
    .is('archived_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toInspectionTemplate(data as InspectionTemplateRow) : null
}

/** Add a template (administrators). Upload the workbook first and pass its hash and size. */
export async function createInspectionTemplate(
  input: InspectionTemplateCreate,
): Promise<InspectionTemplate> {
  const { data, error } = await db()
    .from('inspection_template')
    .insert({
      org_id: input.orgId,
      name: input.name.trim(),
      description: input.description ?? null,
      storage_hash: input.storageHash,
      file_size: input.fileSize,
      original_filename: input.originalFilename ?? null,
      is_default: input.isDefault ?? false,
      report_types: input.reportTypes ?? [],
      default_for: input.defaultFor ?? [],
      layout: input.layout ?? {},
    })
    .select(TEMPLATE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toInspectionTemplate(data as InspectionTemplateRow)
}

/** Change a template (administrators). */
export async function updateInspectionTemplate(
  id: string,
  patch: InspectionTemplateUpdate,
): Promise<InspectionTemplate> {
  const { data, error } = await db()
    .from('inspection_template')
    .update(toUpdateRow(patch))
    .eq('id', id)
    .select(TEMPLATE_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Template not found, or only an administrator can change it')
  return toInspectionTemplate(data as InspectionTemplateRow)
}

/** Make this template the organization's default; the previous default is cleared by the database. */
export function setDefaultInspectionTemplate(id: string): Promise<InspectionTemplate> {
  return updateInspectionTemplate(id, { isDefault: true })
}

/** Archive a template (it stops being offered and stops being the default; reports keep naming it). */
export function archiveInspectionTemplate(id: string): Promise<InspectionTemplate> {
  return updateInspectionTemplate(id, { isDefault: false, defaultFor: [], archivedAt: new Date().toISOString() })
}

/**
 * Delete a template row (administrators). Reports generated from it keep their template name and
 * hash (template_id becomes null). The workbook bytes stay in the vault bucket.
 */
export async function deleteInspectionTemplate(id: string): Promise<void> {
  const { data, error } = await db().from('inspection_template').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0)
    throw new Error('Template not found, or only an administrator can delete it')
}
