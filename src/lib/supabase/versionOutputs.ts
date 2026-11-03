/**
 * Version outputs on the server (schema 505): reads of `file_version_output` and
 * `drawing_pdf_render` under RLS (the file's vault), and the one writer,
 * `file_version_output_record()`. Drawing PDFs are written through `recordDrawingPdf`
 * (`./reviews`), unchanged.
 *
 * Neither table is in the generated `Database` type until `npm run gen:types` runs against 505, so
 * these queries go through the untyped client, as `inspectionReports.ts` does.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logger'
import type {
  ModelOutputKind,
  RecordVersionOutputInput,
  RecordVersionOutputResult,
  VersionedOutput,
  VersionOutput,
  VersionOutputErrorCode,
} from '@/types/versionOutputs'

import { getSupabaseClient } from './client'

/** How many version ids one `in (...)` filter carries. */
const IN_BATCH = 100

const OUTPUT_COLUMNS =
  'id, file_id, file_version_id, kind, configuration, storage_hash, file_size, file_name, is_closure_exact, generated_by, generated_at'
const PDF_COLUMNS =
  'id, file_id, file_version_id, storage_hash, file_size, is_closure_exact, generated_by, generated_at'

interface OutputRow {
  id: string
  file_id: string
  file_version_id: string
  kind: ModelOutputKind
  configuration: string | null
  storage_hash: string
  file_size: number | string
  file_name: string
  is_closure_exact: boolean | null
  generated_by: string | null
  generated_at: string
}

interface PdfRow {
  id: string
  file_id: string
  file_version_id: string
  storage_hash: string
  file_size: number | string
  is_closure_exact: boolean | null
  generated_by: string | null
  generated_at: string
}

const ERROR_CODES: readonly VersionOutputErrorCode[] = [
  'OUTPUT_EXISTS',
  'NOT_UPLOADER',
  'NO_EDIT_PERMISSION',
  'NOT_GENERATOR',
  'IN_REVIEW',
  'NOT_FOUND',
  'RELEASED',
]

/** A refused or failed output write or delete; `code` is the RPC's hint. */
export class VersionOutputRpcError extends Error {
  readonly code: VersionOutputErrorCode
  readonly sqlState: string | null
  constructor(message: string, code: VersionOutputErrorCode, sqlState: string | null) {
    super(message)
    this.name = 'VersionOutputRpcError'
    this.code = code
    this.sqlState = sqlState
  }
}

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

export function toVersionOutput(row: OutputRow): VersionOutput {
  return {
    id: row.id,
    kind: row.kind,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    configuration: row.configuration,
    storageHash: row.storage_hash,
    fileSize: Number(row.file_size),
    fileName: row.file_name,
    closureExact: row.is_closure_exact,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
  }
}

export function pdfToVersionOutput(row: PdfRow): VersionOutput {
  return {
    id: row.id,
    kind: 'pdf',
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    configuration: null,
    storageHash: row.storage_hash,
    fileSize: Number(row.file_size),
    fileName: null,
    closureExact: row.is_closure_exact,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
  }
}

/** Kind order (pdf, step, iges, stl, dxf), then configuration (saved one first), then name. */
export function sortVersionOutputs<T extends VersionOutput>(outputs: T[]): T[] {
  const rank: Record<string, number> = { pdf: 0, step: 1, iges: 2, stl: 3, dxf: 4 }
  return outputs.sort(
    (a, b) =>
      (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) ||
      (a.configuration ?? '').localeCompare(b.configuration ?? '') ||
      (a.fileName ?? '').localeCompare(b.fileName ?? ''),
  )
}

/**
 * The outputs of these versions (PDF renders and exports), by file_version id, each list sorted.
 * Versions with none are absent. Throws on a query error.
 */
export async function listOutputsForVersions(
  fileVersionIds: readonly string[],
): Promise<Map<string, VersionOutput[]>> {
  const ids = [...new Set(fileVersionIds)].filter(Boolean)
  const byVersion = new Map<string, VersionOutput[]>()
  const add = (output: VersionOutput) => {
    const list = byVersion.get(output.fileVersionId)
    if (list) list.push(output)
    else byVersion.set(output.fileVersionId, [output])
  }
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const [outputs, pdfs] = await Promise.all([
      db().from('file_version_output').select(OUTPUT_COLUMNS).in('file_version_id', batch),
      db().from('drawing_pdf_render').select(PDF_COLUMNS).in('file_version_id', batch),
    ])
    if (outputs.error) throw new Error(outputs.error.message)
    if (pdfs.error) throw new Error(pdfs.error.message)
    for (const row of (pdfs.data ?? []) as PdfRow[]) add(pdfToVersionOutput(row))
    for (const row of (outputs.data ?? []) as OutputRow[]) add(toVersionOutput(row))
  }
  for (const list of byVersion.values()) sortVersionOutputs(list)
  return byVersion
}

/**
 * The newest output of each kind and configuration of these files, across their versions, with
 * the version number it was generated from (the file list's output rows and Outputs column: an
 * output of an older version is shown as out of date). Every asked file is present, with an empty
 * list when it has none. Throws on a query error.
 */
export async function listOutputHeadsForFiles(
  fileIds: readonly string[],
): Promise<Map<string, VersionedOutput[]>> {
  const ids = [...new Set(fileIds)].filter(Boolean)
  const all: VersionOutput[] = []
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const [outputs, pdfs] = await Promise.all([
      db().from('file_version_output').select(OUTPUT_COLUMNS).in('file_id', batch),
      db().from('drawing_pdf_render').select(PDF_COLUMNS).in('file_id', batch),
    ])
    if (outputs.error) throw new Error(outputs.error.message)
    if (pdfs.error) throw new Error(pdfs.error.message)
    for (const row of (pdfs.data ?? []) as PdfRow[]) all.push(pdfToVersionOutput(row))
    for (const row of (outputs.data ?? []) as OutputRow[]) all.push(toVersionOutput(row))
  }

  const versionIds = [...new Set(all.map((o) => o.fileVersionId))]
  const versionOf = new Map<string, number>()
  for (let i = 0; i < versionIds.length; i += IN_BATCH) {
    const batch = versionIds.slice(i, i + IN_BATCH)
    const { data, error } = await db().from('file_version').select('id, version').in('id', batch)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ id: string; version: number }>) versionOf.set(row.id, row.version)
  }

  const byFile = new Map<string, VersionedOutput[]>(ids.map((id) => [id, []]))
  const best = new Map<string, VersionedOutput>()
  for (const output of all) {
    const version = versionOf.get(output.fileVersionId)
    if (version === undefined || !byFile.has(output.fileId)) continue
    const key = `${output.fileId}:${output.kind}:${output.configuration ?? ''}`
    const current = best.get(key)
    if (!current || version > current.version) best.set(key, { ...output, version })
  }
  for (const head of best.values()) byFile.get(head.fileId)!.push(head)
  for (const [id, list] of byFile) byFile.set(id, sortVersionOutputs(list))
  return byFile
}

/** The recorded export of one version, kind and configuration, or null. */
export async function getModelOutput(
  fileVersionId: string,
  kind: ModelOutputKind,
  configuration: string | null,
): Promise<VersionOutput | null> {
  let query = db()
    .from('file_version_output')
    .select(OUTPUT_COLUMNS)
    .eq('file_version_id', fileVersionId)
    .eq('kind', kind)
  query = configuration ? query.eq('configuration', configuration) : query.is('configuration', null)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toVersionOutput(data as OutputRow) : null
}

/** The id of a file's version by number, or null when there is none. */
export async function getFileVersionId(fileId: string, version: number): Promise<string | null> {
  const { data, error } = await db()
    .from('file_version')
    .select('id')
    .eq('file_id', fileId)
    .eq('version', version)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { id: string } | null)?.id ?? null
}

/** How many (file, version) pairs one `or(...)` filter carries. */
const PAIR_BATCH = 50

/**
 * The ids of these files' versions by number, keyed by file id (the file list resolving the
 * latest version of each expanded file). Pairs with no row are absent. Throws on a query error.
 */
export async function getFileVersionIdsByNumber(
  pairs: ReadonlyArray<{ fileId: string; version: number }>,
): Promise<Map<string, { version: number; fileVersionId: string }>> {
  const wanted = new Map<string, number>()
  for (const p of pairs) {
    if (p.fileId && Number.isInteger(p.version) && p.version > 0) wanted.set(p.fileId, p.version)
  }
  const entries = [...wanted]
  const found = new Map<string, { version: number; fileVersionId: string }>()
  for (let i = 0; i < entries.length; i += PAIR_BATCH) {
    const batch = entries.slice(i, i + PAIR_BATCH)
    const filter = batch.map(([fileId, version]) => `and(file_id.eq.${fileId},version.eq.${version})`).join(',')
    const { data, error } = await db().from('file_version').select('id, file_id, version').or(filter)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ id: string; file_id: string; version: number }>) {
      if (wanted.get(row.file_id) === row.version) {
        found.set(row.file_id, { version: row.version, fileVersionId: row.id })
      }
    }
  }
  return found
}

/** The newest version of a file: its id and number, or null. */
export async function getLatestFileVersion(
  fileId: string,
): Promise<{ id: string; version: number } | null> {
  const { data, error } = await db()
    .from('file_version')
    .select('id, version')
    .eq('file_id', fileId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const row = (data as Array<{ id: string; version: number }> | null)?.[0]
  return row ?? null
}

function isRecordResult(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Record an export of a version after uploading it content-addressed to the vault bucket. First
 * write wins; the same hash again is a no-op; a different hash is refused (`OUTPUT_EXISTS`)
 * unless the caller is an administrator. Throws `VersionOutputRpcError`.
 */
export async function recordVersionOutput(
  input: RecordVersionOutputInput,
): Promise<RecordVersionOutputResult> {
  const { data, error } = await db().rpc('file_version_output_record', {
    p_file_version_id: input.fileVersionId,
    p_kind: input.kind,
    p_configuration: input.configuration ?? null,
    p_storage_hash: input.storageHash,
    p_file_size: input.fileSize,
    p_file_name: input.fileName,
    p_closure_exact: input.closureExact ?? null,
  })
  if (error) {
    const hint = (error as { hint?: string | null }).hint ?? ''
    const code = ERROR_CODES.find((c) => c === hint) ?? 'UNKNOWN'
    log.warn('[VersionOutputs]', 'file_version_output_record failed', {
      code,
      sqlState: error.code,
      message: error.message,
    })
    throw new VersionOutputRpcError(error.message, code, error.code ?? null)
  }
  const r = isRecordResult(data) ? data : {}
  return {
    recorded: r.recorded === true,
    replaced: r.replaced === true,
    storageHash: typeof r.storage_hash === 'string' ? r.storage_hash : input.storageHash,
    id: typeof r.id === 'string' ? r.id : null,
  }
}

/**
 * Delete a version's drawing PDF or export (schema 507): an administrator, or the user who
 * generated it with explorer edit. A drawing PDF of a version in an open review is kept
 * (`IN_REVIEW`). The content stays in the vault bucket. Throws `VersionOutputRpcError`.
 */
export async function deleteVersionOutput(output: Pick<VersionOutput, 'id' | 'kind'>): Promise<void> {
  // Literal names, so rpcContract.test.ts can check each call against its SQL signature.
  const fn = output.kind === 'pdf' ? 'drawing_pdf_render_delete' : 'file_version_output_delete'
  const { error } =
    output.kind === 'pdf'
      ? await db().rpc('drawing_pdf_render_delete', { p_id: output.id })
      : await db().rpc('file_version_output_delete', { p_id: output.id })
  if (error) {
    const hint = (error as { hint?: string | null }).hint ?? ''
    const code = ERROR_CODES.find((c) => c === hint) ?? 'UNKNOWN'
    log.warn('[VersionOutputs]', `${fn} failed`, { code, sqlState: error.code, message: error.message })
    throw new VersionOutputRpcError(error.message, code, error.code ?? null)
  }
}
