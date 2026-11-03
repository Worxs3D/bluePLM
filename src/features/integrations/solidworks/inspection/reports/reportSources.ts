/**
 * Inputs of a report that come from outside the version's inspection snapshot: the part number,
 * description and revision when the version itself lacks them, the organization logo, and the
 * live inspection table's row count (for the "not checked in" warning). Read-only.
 */
import type { ReportLogo } from '@/lib/inspection/excel'
import { log } from '@/lib/logger'
import { getSupabaseClient } from '@/lib/supabase'
import type { Organization, PDMFile } from '@/types/pdm'

import { identityIncomplete, resolveReportIdentity, type ReportIdentity, type VersionInfo } from './reportModel'

export type { ReportLogo }

const MODEL_EXTENSIONS = /\.(sldprt|sldasm)$/i
/** References looked at for the drawing's model; a drawing names its model among the first few. */
const MAX_REFERENCES = 20
/** Logos larger than this are not embedded (uploads are limited to 2 MB). */
const MAX_LOGO_BYTES = 5 * 1024 * 1024

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface IdentityRow {
  part_number: string | null
  description: string | null
  revision: string | null
}

function fromRow(row: IdentityRow | null | undefined): Partial<ReportIdentity> | null {
  if (!row) return null
  return { partNumber: row.part_number, description: row.description, revision: row.revision }
}

/**
 * The model a drawing version references (first part or assembly), at the version the drawing
 * recorded, or the model's current row when the reference names no version. Null when unknown.
 */
async function referencedModelIdentity(fileVersionId: string): Promise<Partial<ReportIdentity> | null> {
  const client = getSupabaseClient()
  const { data: refs, error } = await client
    .from('file_version_reference')
    .select('child_file_id, child_version_id, child_path, reference_type')
    .eq('parent_version_id', fileVersionId)
    .limit(MAX_REFERENCES)
  if (error) throw new Error(error.message)
  const models = (refs ?? []).filter((r) => MODEL_EXTENSIONS.test(r.child_path) && (r.child_version_id || r.child_file_id))
  const ref = models.find((r) => r.reference_type === 'reference') ?? models[0]
  if (!ref) return null
  if (ref.child_version_id) {
    const { data, error: vErr } = await client
      .from('file_version')
      .select('part_number, description, revision')
      .eq('id', ref.child_version_id)
      .maybeSingle()
    if (vErr) throw new Error(vErr.message)
    if (data) return fromRow(data)
  }
  if (!ref.child_file_id) return null
  const { data, error: fErr } = await client
    .from('file')
    .select('part_number, description, revision')
    .eq('id', ref.child_file_id)
    .maybeSingle()
  if (fErr) throw new Error(fErr.message)
  return fromRow(data)
}

/**
 * Part number, description and revision of a report: the drawing version, then the file's current
 * row, then the model the drawing references at that version. The model is read only when the
 * first two leave a field blank; a failed read leaves it blank.
 */
export async function reportIdentity(
  version: VersionInfo,
  currentFile: Pick<PDMFile, 'part_number' | 'description' | 'revision'> | null | undefined,
): Promise<ReportIdentity> {
  const fromVersion = { partNumber: version.partNumber, description: version.description, revision: version.revision }
  const current = currentFile
    ? { partNumber: currentFile.part_number, description: currentFile.description, revision: currentFile.revision }
    : null
  const first = resolveReportIdentity(fromVersion, current)
  if (!identityIncomplete(first)) return first
  try {
    return resolveReportIdentity(first, await referencedModelIdentity(version.id))
  } catch (err) {
    log.warn('[InspectionReports]', 'Referenced model could not be read', { fileVersionId: version.id, error: errorText(err) })
    return first
  }
}

// ---------------------------------------------------------------------------
// Organization logo
// ---------------------------------------------------------------------------

/** PNG or JPEG by magic bytes; null for anything else. */
export function logoFormat(bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return null
}

/** Another image format (WebP, GIF, SVG) drawn to PNG, where the runtime can; else null. */
async function toPng(bytes: Uint8Array, type: string): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const bitmap = await createImageBitmap(new Blob([copy.buffer], { type }))
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/** One cached logo (the signed-in organization's); replaced when the logo path changes. */
let logoCache: { key: string; logo: ReportLogo | null } | null = null

/**
 * The organization logo for a report, or null when the organization has none or it cannot be
 * read (the report is then generated without it).
 */
export async function organizationLogo(
  organization: Pick<Organization, 'id' | 'logo_storage_path'> | null | undefined,
): Promise<ReportLogo | null> {
  const path = organization?.logo_storage_path
  if (!organization || !path) return null
  const key = `${organization.id}:${path}`
  if (logoCache?.key === key) return logoCache.logo
  let logo: ReportLogo | null = null
  try {
    const { data, error } = await getSupabaseClient().storage.from('vault').download(path)
    if (error || !data) throw new Error(error?.message ?? 'Download failed')
    if (data.size > MAX_LOGO_BYTES) throw new Error('Logo is too large')
    const bytes = new Uint8Array(await data.arrayBuffer())
    const format = logoFormat(bytes)
    if (format) logo = { bytes, extension: format }
    else {
      const png = await toPng(bytes, data.type || 'image/*')
      logo = png ? { bytes: png, extension: 'png' } : null
    }
  } catch (err) {
    log.warn('[InspectionReports]', 'Organization logo unavailable', { error: errorText(err) })
    return null
  }
  logoCache = { key, logo }
  return logo
}

// ---------------------------------------------------------------------------
// Live inspection table
// ---------------------------------------------------------------------------

/** Rows in the drawing's live inspection table, or null when it cannot be counted. */
export async function liveInspectionRowCount(fileId: string): Promise<number | null> {
  try {
    const { count, error } = await getSupabaseClient()
      .from('inspection_characteristic')
      .select('id', { count: 'exact', head: true })
      .eq('file_id', fileId)
    if (error) throw new Error(error.message)
    return count ?? null
  } catch (err) {
    log.debug('[InspectionReports]', 'Live inspection rows not counted', { fileId, error: errorText(err) })
    return null
  }
}
