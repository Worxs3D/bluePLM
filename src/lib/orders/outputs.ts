/**
 * The outputs of order lines: which version and configuration each kind comes from and whether it
 * is generated. Free of store imports, so the orders slice can use it. Generating: `./generate`.
 *
 * Where a kind comes from (`lineKindSource`):
 * - `pdf`: the drawing version's PDF, or the line's own version when the line is a drawing.
 * - `dxf`: a drawing export too: the drawing version, or the line's own drawing.
 * - `step`: the model version (in the line's configuration); a drawing-only line uses the
 *   drawing's STEP (the model its views show).
 * - `iges`, `stl`: the model version (STL in the line's configuration, IGES the saved one).
 * - `source`: the line version's own file bytes.
 *
 * A sent order's lines carry the outputs that went out (`sentOutputs`); those are the answer then,
 * never a newer output.
 */

import { isDrawingFile, kindTakesConfiguration } from '@/lib/outputs/kinds'
import { getSupabaseClient } from '@/lib/supabase/client'
import { listOutputsForVersions } from '@/lib/supabase/versionOutputs'
import { ORDER_OUTPUT_KINDS, type LineOutputState, type OrderOutputKind, type SupplyOrderLine } from '@/types/orders'
import type { VersionOutput } from '@/types/versionOutputs'

/** Where one kind of a line comes from. */
export interface LineKindSource {
  fileId: string
  fileVersionId: string
  /** The version number (for the output queue); null when the line does not say. */
  version: number | null
  /** The source file's name (the job's label). */
  fileName: string
  /** The configuration of the output; null = the saved one. */
  configuration: string | null
}

type SourceLine = Pick<
  SupplyOrderLine,
  | 'fileId'
  | 'fileVersionId'
  | 'fileName'
  | 'version'
  | 'configuration'
  | 'drawingFileId'
  | 'drawingVersionId'
  | 'drawingFileName'
  | 'drawingVersion'
>

/**
 * Whether a line of this kind of file can have `kind` at all, from its snapshot (so a purged line
 * still says): PDF and DXF need a drawing, IGES and STL a model. Pure.
 */
export function lineKindApplies(line: Pick<SupplyOrderLine, 'fileName' | 'drawingFileName'>, kind: OrderOutputKind): boolean {
  const lineIsDrawing = isDrawingFile(line.fileName)
  switch (kind) {
    case 'source':
    case 'step':
      return true
    case 'pdf':
    case 'dxf':
      return lineIsDrawing || !!line.drawingFileName
    case 'iges':
    case 'stl':
      return !lineIsDrawing
  }
}

/**
 * Where `kind` of `line` comes from, or null when the line cannot have it, or its file (or, for a
 * drawing export, its drawing) has been purged. Pure.
 */
export function lineKindSource(line: SourceLine, kind: OrderOutputKind): LineKindSource | null {
  const own: LineKindSource | null =
    line.fileId && line.fileVersionId
      ? {
          fileId: line.fileId,
          fileVersionId: line.fileVersionId,
          version: line.version > 0 ? line.version : null,
          fileName: line.fileName,
          configuration: null,
        }
      : null
  const drawing: LineKindSource | null =
    line.drawingVersionId && line.drawingFileId
      ? {
          fileId: line.drawingFileId,
          fileVersionId: line.drawingVersionId,
          version: line.drawingVersion,
          fileName: line.drawingFileName ?? line.fileName,
          configuration: null,
        }
      : null
  const lineIsDrawing = isDrawingFile(line.fileName)
  switch (kind) {
    case 'source':
      return own
    case 'pdf':
    case 'dxf':
      return drawing ?? (lineIsDrawing ? own : null)
    case 'step':
    case 'iges':
    case 'stl':
      if (lineIsDrawing) return kind === 'step' ? own : null
      return own && { ...own, configuration: kindTakesConfiguration(kind) ? line.configuration : null }
  }
}

/** Content of a version's own file. */
export interface VersionContent {
  contentHash: string
  fileSize: number
}

export interface ResolveOutputsDeps {
  outputsForVersions: (fileVersionIds: readonly string[]) => Promise<Map<string, VersionOutput[]>>
  versionContent: (fileVersionIds: readonly string[]) => Promise<Map<string, VersionContent>>
}

export type ResolvableLine = SourceLine & Pick<SupplyOrderLine, 'id' | 'outputKinds' | 'sentOutputs' | 'missingKinds'>

/** The states of a sent line, from what was recorded when it was sent. Pure. */
export function sentLineStates(line: ResolvableLine): LineOutputState[] {
  const sent = line.sentOutputs ?? []
  return ORDER_OUTPUT_KINDS.map((kind) => {
    const included = line.outputKinds.includes(kind)
    const output = sent.find((o) => o.kind === kind)
    if (output) {
      return {
        kind,
        status: 'ready',
        included,
        output: { storageHash: output.storageHash, fileSize: output.fileSize, fileName: output.fileName },
      }
    }
    return { kind, status: lineKindApplies(line, kind) ? 'missing' : 'unsupported', included }
  })
}

/** The states of a draft line from the outputs and contents read. Pure. */
export function draftLineStates(
  line: ResolvableLine,
  outputs: ReadonlyMap<string, readonly VersionOutput[]>,
  contents: ReadonlyMap<string, VersionContent>,
): LineOutputState[] {
  return ORDER_OUTPUT_KINDS.map((kind) => {
    const included = line.outputKinds.includes(kind)
    const source = lineKindSource(line, kind)
    // A purged file (or drawing) has nothing to send: missing, not unsupported.
    if (!source) return { kind, status: lineKindApplies(line, kind) ? 'missing' : 'unsupported', included }
    if (kind === 'source') {
      const content = contents.get(source.fileVersionId)
      return content
        ? {
            kind,
            status: 'ready',
            included,
            output: { storageHash: content.contentHash, fileSize: content.fileSize, fileName: line.fileName },
          }
        : { kind, status: 'missing', included }
    }
    const found = (outputs.get(source.fileVersionId) ?? []).find(
      (o) => o.kind === kind && o.fileId === source.fileId && (o.configuration ?? null) === source.configuration,
    )
    return found
      ? {
          kind,
          status: 'ready',
          included,
          output: { storageHash: found.storageHash, fileSize: found.fileSize, fileName: found.fileName },
        }
      : { kind, status: 'missing', included }
  })
}

const IN_BATCH = 100

async function versionContent(fileVersionIds: readonly string[]): Promise<Map<string, VersionContent>> {
  const ids = [...new Set(fileVersionIds)].filter(Boolean)
  const out = new Map<string, VersionContent>()
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const { data, error } = await getSupabaseClient()
      .from('file_version')
      .select('id, content_hash, file_size')
      .in('id', ids.slice(i, i + IN_BATCH))
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      if (row.content_hash) out.set(row.id, { contentHash: row.content_hash, fileSize: Number(row.file_size ?? 0) })
    }
  }
  return out
}

export const defaultResolveOutputsDeps: ResolveOutputsDeps = {
  outputsForVersions: listOutputsForVersions,
  versionContent,
}

/**
 * The state of every kind of every line (each list in `ORDER_OUTPUT_KINDS` order, with
 * `included` marking the line's kinds), by line id. Sent lines are answered from `sentOutputs`
 * without a read. Throws on a query error.
 */
export async function resolveLineOutputs(
  lines: readonly ResolvableLine[],
  deps: ResolveOutputsDeps = defaultResolveOutputsDeps,
): Promise<Map<string, LineOutputState[]>> {
  const result = new Map<string, LineOutputState[]>()
  const drafts = lines.filter((l) => l.sentOutputs === null)
  for (const line of lines) if (line.sentOutputs !== null) result.set(line.id, sentLineStates(line))
  if (drafts.length === 0) return result

  const outputVersionIds = new Set<string>()
  const sourceVersionIds = new Set<string>()
  for (const line of drafts) {
    for (const kind of ORDER_OUTPUT_KINDS) {
      const source = lineKindSource(line, kind)
      if (!source) continue
      if (kind === 'source') sourceVersionIds.add(source.fileVersionId)
      else outputVersionIds.add(source.fileVersionId)
    }
  }
  const [outputs, contents] = await Promise.all([
    outputVersionIds.size > 0 ? deps.outputsForVersions([...outputVersionIds]) : Promise.resolve(new Map()),
    sourceVersionIds.size > 0 ? deps.versionContent([...sourceVersionIds]) : Promise.resolve(new Map()),
  ])
  for (const line of drafts) result.set(line.id, draftLineStates(line, outputs, contents))
  return result
}
