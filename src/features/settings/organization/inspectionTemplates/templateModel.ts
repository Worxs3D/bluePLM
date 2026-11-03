/**
 * Pure pieces of the inspection template manager: reading a stored layout back, the summary the
 * page shows for it, and the token reference. Tested in `templateModel.test.ts`.
 */
import { DEFAULT_FIELD_CAPTIONS, ROW_FIELDS, SCALAR_NAMES, type TemplateLayout } from '@/lib/inspection/excel'
import type { Json } from '@/types/supabase'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A stored `inspection_template.layout` as a TemplateLayout, or null when it is not one. */
export function parseLayout(json: Json | null | undefined): TemplateLayout | null {
  if (!isRecord(json) || json.version !== 1) return null
  if (!Array.isArray(json.errors) || !Array.isArray(json.warnings) || !Array.isArray(json.sheets)) return null
  return json as unknown as TemplateLayout
}

export type AnalysisStatus = 'ready' | 'warnings' | 'errors' | 'unknown'

export function analysisStatus(layout: TemplateLayout | null): AnalysisStatus {
  if (!layout) return 'unknown'
  if (layout.errors.length > 0) return 'errors'
  if (layout.warnings.length > 0) return 'warnings'
  return 'ready'
}

export interface LayoutSummary {
  /** `Inspection!5`, or null without a row template. */
  tableAt: string | null
  /** Distinct row fields the table fills. */
  fields: string[]
  resultCount: number
  hasVerdict: boolean
  inputs: string[]
  entries: string[]
  properties: string[]
  /** `Sheet!A1`, or null (pages go on added Drawing sheets). */
  drawingAt: string | null
  scalarCount: number
}

export function layoutSummary(layout: TemplateLayout): LayoutSummary {
  const row = layout.rowTemplate
  const fields: string[] = []
  const inputs: string[] = []
  for (const cell of row?.cells ?? []) {
    if (cell.kind === 'field') for (const f of cell.fields) if (!fields.includes(f)) fields.push(f)
    if (cell.kind === 'input' && !inputs.includes(cell.name)) inputs.push(cell.name)
  }
  return {
    tableAt: row ? `${row.sheet}!${row.row}` : null,
    fields,
    resultCount: layout.resultCount,
    hasVerdict: layout.hasVerdict,
    inputs,
    entries: layout.entries.map((e) => e.name),
    properties: layout.properties,
    drawingAt: layout.drawingAnchor ? `${layout.drawingAnchor.sheet}!${layout.drawingAnchor.cell}` : null,
    scalarCount: layout.scalars.length,
  }
}

/** `Bracket inspection.xlsx` → `Bracket inspection`. */
export function nameFromFileName(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, '').trim() || fileName
}

export interface TokenReferenceEntry {
  token: string
  /** i18n key of the explanation, or null when `caption` says it all. */
  descriptionKey: string | null
  /** Default column caption (English workbook content), for row fields. */
  caption?: string
}

export interface TokenReferenceGroup {
  titleKey: string
  entries: TokenReferenceEntry[]
}

/** Every token the Excel engine understands, grouped as the reference panel shows them. */
export function tokenReference(): TokenReferenceGroup[] {
  return [
    {
      titleKey: 'source.inspection.tplTokGroupHeader',
      entries: [
        ...SCALAR_NAMES.map((name) => ({ token: `{{${name}}}`, descriptionKey: `source.inspection.tplTok_${name}` })),
        { token: '{{PROP:<name>}}', descriptionKey: 'source.inspection.tplTokProp' },
        { token: '{{ENTRY:<name>}}', descriptionKey: 'source.inspection.tplTokEntry' },
        { token: '{{DRAWING}}', descriptionKey: 'source.inspection.tplTokDrawing' },
        { token: '{{LOGO}}', descriptionKey: 'source.inspection.tplTokLogo' },
      ],
    },
    {
      titleKey: 'source.inspection.tplTokGroupRow',
      entries: [
        { token: '{{RESULT}} / {{RESULT:n}}', descriptionKey: 'source.inspection.tplTokResult' },
        { token: '{{VERDICT}}', descriptionKey: 'source.inspection.tplTokVerdict' },
        { token: '{{INPUT:<name>}}', descriptionKey: 'source.inspection.tplTokInput' },
      ],
    },
    {
      titleKey: 'source.inspection.tplTokGroupFields',
      entries: ROW_FIELDS.map((field) => ({
        token: `{{COL:${field}}}`,
        descriptionKey: null,
        caption: DEFAULT_FIELD_CAPTIONS[field],
      })),
    },
    {
      titleKey: 'source.inspection.tplTokGroupLegacy',
      entries: [
        { token: '{{BR_NUMBER}}', descriptionKey: 'source.inspection.tplTokBrNumber' },
        { token: '{{INSPECTION_TABLE}}', descriptionKey: 'source.inspection.tplTokInspectionTable' },
        { token: '{{COL:balloon}} {{COL:nominal}} {{COL:type}} {{COL:method}}', descriptionKey: 'source.inspection.tplTokAliases' },
      ],
    },
  ]
}
