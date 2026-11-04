/**
 * Which order lines a file selection makes ("Add to order", "Add with referenced parts").
 *
 * A line is one model file (part or assembly, or a lone drawing) pinned to its latest checked-in
 * version, read fresh from the server (never the renderer's cached `pdmData.version`).
 *
 * - A drawing makes a line for the model it references: its first part or assembly reference in
 *   `file_version_reference` (a `reference` edge first), at the version the drawing recorded, or
 *   the model's latest when the edge names none. With no model it is a drawing-only line `{pdf}`.
 * - A part or assembly gets the newest checked-in drawing whose latest version references it, if
 *   there is exactly one such drawing, or exactly one with the model's base name; else none.
 * - With `withReferencedParts`, each selected assembly adds every part and sub-assembly of its
 *   dependency closure (`file_version_get_dependency_closure`) as its own line, pinned to the
 *   closure's versions, and those get a drawing by the same rule. A child referenced in one
 *   configuration is ordered in its saved configuration (null): references name a configuration
 *   even when a part has only one, and the outputs generated at check-in are of the saved one.
 *   A child referenced in several configurations gets one line per configuration.
 * - Default kinds: `{pdf, step}` with a drawing, `{step}` without, `{pdf}` for a drawing-only line.
 * - One line per (file, configuration); a line with a drawing wins over one without.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { isDrawingFile, isModelFile } from '@/lib/outputs/kinds'
import { baseNameOf } from '@/lib/outputs/fileName'
import { getSupabaseClient } from '@/lib/supabase/client'
import {
  getLatestCheckedInVersions,
  getVersionDependencyClosure,
  type LatestFileVersion,
} from '@/lib/supabase/reviews'
import type { LocalFile } from '@/stores/types'
import type { AddLineInput, OrderOutputKind } from '@/types/orders'
import type { DependencyClosureRow } from '@/types/reviews'

import { readAllPages } from './paging'

export type PlanSkipReason = 'not-checked-in' | 'folder' | 'unsupported'

export interface PlanOrderLinesResult {
  lines: AddLineInput[]
  skipped: Array<{ path: string; reason: PlanSkipReason }>
}

export interface PlanOrderLinesOptions {
  withReferencedParts?: boolean
}

/** The model a drawing version references. */
export interface DrawingModelRef {
  drawingVersionId: string
  childFileId: string | null
  childVersionId: string | null
  childPath: string
  referenceType: string | null
}

/** A drawing that references a model at the drawing's latest version (a pairing candidate). */
export interface ModelDrawingRef {
  modelFileId: string
  drawingFileId: string
  /** The drawing's latest version, the one that references the model. */
  drawingVersionId: string
  drawingFileName: string
}

/** A `file_version_reference` row with its parent file and version embedded. */
export interface ParentReferenceRow {
  child_file_id: string | null
  parent_file_id: string
  parent_version_id: string
  parent: { file_name: string | null; file_path: string | null; extension: string | null; version: number | null; deleted_at: string | null } | null
  parent_version: { version: number | null } | null
}

/** The server reads the planner makes; injectable for tests. */
export interface PlanDeps {
  latestVersions: (fileIds: readonly string[]) => Promise<LatestFileVersion[]>
  /** Part and assembly references of these drawing versions. */
  drawingModelRefs: (drawingVersionIds: readonly string[]) => Promise<DrawingModelRef[]>
  /** Every live drawing whose latest version references one of these model files (all rows, paged). */
  modelDrawingRefs: (modelFileIds: readonly string[]) => Promise<ModelDrawingRef[]>
  closure: (fileVersionId: string) => Promise<DependencyClosureRow[]>
}

export const DRAWING_LINE_KINDS: readonly OrderOutputKind[] = ['pdf', 'step']
export const MODEL_LINE_KINDS: readonly OrderOutputKind[] = ['step']
export const DRAWING_ONLY_LINE_KINDS: readonly OrderOutputKind[] = ['pdf']

/** How many ids one `in (...)` filter carries. */
const IN_BATCH = 100

interface PlannedLine {
  fileId: string
  /** File name or path, for the drawing pairing's base-name rule. */
  fileName: string
  fileVersionId: string
  configuration: string | null
  drawingVersionId: string | null
}

function lineKey(fileId: string, configuration: string | null): string {
  return `${fileId}:${configuration ?? ''}`
}

/** The model reference a drawing's line is made for: a `reference` edge first, then the first. Pure. */
export function pickDrawingModel(refs: readonly DrawingModelRef[]): DrawingModelRef | null {
  const models = refs.filter((r) => isModelFile(r.childPath) && (r.childVersionId || r.childFileId))
  return models.find((r) => r.referenceType === 'reference') ?? models[0] ?? null
}

/**
 * The drawing a model gets: among drawings whose latest version references it, the only one, or
 * the only one with the model's base name; else null. Pure.
 */
export function pickModelDrawing(
  modelFileName: string,
  candidates: ReadonlyArray<{ fileId: string; fileName: string; fileVersionId: string }>,
): string | null {
  const unique = [...new Map(candidates.map((c) => [c.fileId, c])).values()]
  if (unique.length === 1) return unique[0].fileVersionId
  const base = baseNameOf(modelFileName).toLowerCase()
  const named = unique.filter((c) => baseNameOf(c.fileName).toLowerCase() === base)
  return named.length === 1 ? named[0].fileVersionId : null
}

function pathOfRow(row: DependencyClosureRow): string {
  return row.filePath || row.fileName || row.referencePath || ''
}

/**
 * The parts and sub-assemblies of closures as lines (root rows and unresolved references left
 * out), with the configuration rule above. Pure.
 */
export function closureChildLines(closures: ReadonlyArray<readonly DependencyClosureRow[]>): PlannedLine[] {
  const byFile = new Map<string, { fileVersionId: string; version: number; configs: Set<string>; path: string }>()
  for (const rows of closures) {
    for (const row of rows) {
      if (row.depth === 0 || row.missing || row.deleted || !row.fileId || !row.fileVersionId) continue
      if (!isModelFile(pathOfRow(row))) continue
      const current = byFile.get(row.fileId)
      const version = row.version ?? 0
      if (!current) {
        byFile.set(row.fileId, {
          fileVersionId: row.fileVersionId,
          version,
          configs: new Set(row.configuration ? [row.configuration] : []),
          path: pathOfRow(row),
        })
        continue
      }
      if (row.configuration) current.configs.add(row.configuration)
      // Two closures pinning different versions of one file: the newer one goes on the order.
      if (version > current.version) {
        current.fileVersionId = row.fileVersionId
        current.version = version
      }
    }
  }
  const out: PlannedLine[] = []
  const sorted = [...byFile.entries()].sort((a, b) => a[1].path.toLowerCase().localeCompare(b[1].path.toLowerCase()))
  for (const [fileId, child] of sorted) {
    const configs = child.configs.size > 1 ? [...child.configs].sort() : [null]
    for (const configuration of configs) {
      out.push({ fileId, fileName: child.path, fileVersionId: child.fileVersionId, configuration, drawingVersionId: null })
    }
  }
  return out
}

function kindsFor(line: PlannedLine, drawingOnly: boolean): OrderOutputKind[] {
  if (drawingOnly) return [...DRAWING_ONLY_LINE_KINDS]
  return line.drawingVersionId ? [...DRAWING_LINE_KINDS] : [...MODEL_LINE_KINDS]
}

export async function planOrderLinesForFiles(
  files: readonly LocalFile[],
  options: PlanOrderLinesOptions = {},
  deps: PlanDeps = defaultPlanDeps,
): Promise<PlanOrderLinesResult> {
  const skipped: PlanOrderLinesResult['skipped'] = []
  const pathOf = new Map<string, string>()
  for (const file of files) {
    const path = file.relativePath || file.name
    if (file.isDirectory) skipped.push({ path, reason: 'folder' })
    else if (!isDrawingFile(path) && !isModelFile(path)) skipped.push({ path, reason: 'unsupported' })
    else if (!file.pdmData?.id) skipped.push({ path, reason: 'not-checked-in' })
    else if (!pathOf.has(file.pdmData.id)) pathOf.set(file.pdmData.id, path)
  }
  if (pathOf.size === 0) return { lines: [], skipped }

  const latest = await deps.latestVersions([...pathOf.keys()])
  const latestByFile = new Map(latest.map((v) => [v.fileId, v]))
  for (const [fileId, path] of pathOf) {
    if (!latestByFile.has(fileId)) skipped.push({ path, reason: 'not-checked-in' })
  }
  const selected = [...pathOf.keys()].map((id) => latestByFile.get(id)).filter((v): v is LatestFileVersion => !!v)
  const drawings = selected.filter((v) => isDrawingFile(v.filePath || v.fileName))
  const models = selected.filter((v) => isModelFile(v.filePath || v.fileName))

  const lines = new Map<string, PlannedLine>()
  const drawingOnly = new Set<string>()
  const put = (line: PlannedLine) => {
    const key = lineKey(line.fileId, line.configuration)
    const current = lines.get(key)
    if (!current || (!current.drawingVersionId && line.drawingVersionId)) lines.set(key, line)
  }

  // Drawings: a line for the model each one shows, else a drawing-only line.
  if (drawings.length > 0) {
    const refs = await deps.drawingModelRefs(drawings.map((d) => d.fileVersionId))
    const picked = new Map<string, DrawingModelRef>()
    for (const d of drawings) {
      const ref = pickDrawingModel(refs.filter((r) => r.drawingVersionId === d.fileVersionId))
      if (ref) picked.set(d.fileVersionId, ref)
    }
    // The model's latest version confirms it exists and is readable, and pins an edge with no version.
    const childFileIds = [...new Set([...picked.values()].map((r) => r.childFileId).filter((id): id is string => !!id))]
    const childLatest = childFileIds.length > 0 ? await deps.latestVersions(childFileIds) : []
    const childLatestByFile = new Map(childLatest.map((v) => [v.fileId, v]))
    for (const d of drawings) {
      const ref = picked.get(d.fileVersionId)
      const model = ref?.childFileId ? childLatestByFile.get(ref.childFileId) : undefined
      if (ref && model) {
        put({
          fileId: model.fileId,
          fileName: model.fileName || model.filePath,
          fileVersionId: ref.childVersionId ?? model.fileVersionId,
          configuration: null,
          drawingVersionId: d.fileVersionId,
        })
      } else {
        const line: PlannedLine = {
          fileId: d.fileId,
          fileName: d.fileName || d.filePath,
          fileVersionId: d.fileVersionId,
          configuration: null,
          drawingVersionId: null,
        }
        drawingOnly.add(lineKey(line.fileId, null))
        put(line)
      }
    }
  }

  // Models, then (with referenced parts) the closures of the selected assemblies.
  const modelLines: PlannedLine[] = models.map((m) => ({
    fileId: m.fileId,
    fileName: m.fileName || m.filePath,
    fileVersionId: m.fileVersionId,
    configuration: null,
    drawingVersionId: null,
  }))
  if (options.withReferencedParts) {
    const assemblies = models.filter((m) => /\.sldasm$/i.test(m.filePath || m.fileName))
    const closures: DependencyClosureRow[][] = []
    for (const a of assemblies) closures.push(await deps.closure(a.fileVersionId))
    modelLines.push(...closureChildLines(closures))
  }

  const unpaired = modelLines.filter((l) => !lines.get(lineKey(l.fileId, l.configuration))?.drawingVersionId)
  const drawingFor = await drawingsForModels(
    [...new Set(unpaired.map((l) => l.fileId))],
    new Map(modelLines.map((l) => [l.fileId, l.fileName])),
    deps,
  )
  for (const line of modelLines) put({ ...line, drawingVersionId: drawingFor.get(line.fileId) ?? null })

  return {
    lines: [...lines.entries()].map(([key, line]) => {
      const out: AddLineInput = {
        fileVersionId: line.fileVersionId,
        outputKinds: kindsFor(line, drawingOnly.has(key) && !line.drawingVersionId),
      }
      if (line.configuration) out.configuration = line.configuration
      if (line.drawingVersionId) out.drawingVersionId = line.drawingVersionId
      return out
    }),
    skipped,
  }
}

/** file id of a model -> the drawing version that goes with it, by the pairing rule. */
async function drawingsForModels(
  modelFileIds: readonly string[],
  names: ReadonlyMap<string, string>,
  deps: PlanDeps,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (modelFileIds.length === 0) return out
  const refs = await deps.modelDrawingRefs(modelFileIds)
  for (const modelFileId of modelFileIds) {
    const candidates = refs
      .filter((r) => r.modelFileId === modelFileId)
      .map((r) => ({ fileId: r.drawingFileId, fileName: r.drawingFileName, fileVersionId: r.drawingVersionId }))
    const picked = pickModelDrawing(names.get(modelFileId) ?? '', candidates)
    if (picked) out.set(modelFileId, picked)
  }
  return out
}

// ---------------------------------------------------------------------------
// Server reads
// ---------------------------------------------------------------------------

function untyped(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

async function drawingModelRefs(drawingVersionIds: readonly string[]): Promise<DrawingModelRef[]> {
  const ids = [...new Set(drawingVersionIds)]
  const out: DrawingModelRef[] = []
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const rows = await readAllPages((from, to) =>
      untyped()
        .from('file_version_reference')
        .select('id, parent_version_id, child_file_id, child_version_id, child_path, reference_type, created_at')
        .in('parent_version_id', batch)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const r of rows) {
      if (typeof r.parent_version_id !== 'string' || typeof r.child_path !== 'string') continue
      out.push({
        drawingVersionId: r.parent_version_id,
        childFileId: typeof r.child_file_id === 'string' ? r.child_file_id : null,
        childVersionId: typeof r.child_version_id === 'string' ? r.child_version_id : null,
        childPath: r.child_path,
        referenceType: typeof r.reference_type === 'string' ? r.reference_type : null,
      })
    }
  }
  return out
}

/**
 * The pairing candidates among reference rows: the parent is a live drawing and the row belongs
 * to the drawing's latest version. Pure.
 */
export function latestDrawingRefs(rows: readonly ParentReferenceRow[]): ModelDrawingRef[] {
  const out = new Map<string, ModelDrawingRef>()
  for (const r of rows) {
    const parent = r.parent
    if (!r.child_file_id || !parent || parent.deleted_at) continue
    const name = parent.file_name || parent.file_path || ''
    if (!isDrawingFile(name) && !/slddrw$/i.test(parent.extension ?? '')) continue
    if (parent.version === null || r.parent_version?.version !== parent.version) continue
    out.set(`${r.child_file_id}:${r.parent_file_id}`, {
      modelFileId: r.child_file_id,
      drawingFileId: r.parent_file_id,
      drawingVersionId: r.parent_version_id,
      drawingFileName: name,
    })
  }
  return [...out.values()]
}

/**
 * Drawings that reference these models, read whole: the parent is filtered to drawings on the
 * server (an inner join on the parent file, which RLS also limits to readable vaults), every page
 * is read, and the latest-version check runs here (PostgREST cannot compare two columns).
 */
async function modelDrawingRefs(modelFileIds: readonly string[]): Promise<ModelDrawingRef[]> {
  const ids = [...new Set(modelFileIds)]
  const rows: ParentReferenceRow[] = []
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const page = await readAllPages((from, to) =>
      untyped()
        .from('file_version_reference')
        .select(
          'id, child_file_id, parent_file_id, parent_version_id, ' +
            'parent:file!file_version_reference_parent_file_id_fkey!inner(file_name, file_path, extension, version, deleted_at), ' +
            'parent_version:file_version!file_version_reference_parent_version_id_fkey!inner(version)',
        )
        .in('child_file_id', batch)
        .ilike('parent.extension', '%slddrw')
        .is('parent.deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to),
    )
    rows.push(...(page as unknown as ParentReferenceRow[]))
  }
  return latestDrawingRefs(rows)
}

export const defaultPlanDeps: PlanDeps = {
  latestVersions: getLatestCheckedInVersions,
  drawingModelRefs,
  modelDrawingRefs,
  closure: getVersionDependencyClosure,
}
