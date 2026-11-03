/**
 * Built-in starter templates, built with exceljs at runtime (no binary assets in the repo).
 *
 * Captions are workbook content, not UI: they are English, like a template an admin authors, so a
 * template reads the same whoever downloads it. An organization that wants other wording
 * downloads a starter, edits it, and uploads it as its own template.
 *
 * Every layout is original and shares one design (`builtInStyle.ts`): a title band with the logo and the report
 * identity, a part block, a summary strip counted by formula, the characteristic table (dark
 * header, banded rows, PASS / FAIL colours), a sign-off block, and print setup (landscape, one
 * page wide, header row repeated, footer with report number and page x of y). The drawing pages
 * are added by the engine under the sign-off block. The first article layout names and numbers
 * the AS9102 Form 3 fields it fills (part and report identity, characteristic number, reference
 * location, designator, requirement, results, tooling, nonconformance number, comments) in a
 * layout of its own. The report-type templates (AS9102 FAI forms, production lot, receiving,
 * re-inspection) are in `builtInTypes.ts`.
 */
import type { InspectionReportType } from '@/types/inspectionReports'

import { addReportSheet, type ReportSpec } from './builtInStyle'
import { BUILT_IN_TYPED_TEMPLATES, FORM3_COLUMNS } from './builtInTypes'
import { newWorkbook, writeWorkbook } from './workbook'

export interface BuiltInTemplateInfo {
  key: string
  name: string
  description: string
  /** Report types the template serves; empty = any. */
  reportTypes: InspectionReportType[]
  /** Types it is the built-in default for (an organization's own default comes first). */
  defaultFor: InspectionReportType[]
}

export interface BuiltInTemplate extends BuiltInTemplateInfo {
  bytes: Uint8Array
}

/** Options of a built-in that depends on the report (production and receiving: samples per characteristic). */
export interface BuiltInOptions {
  /**
   * Parts measured per characteristic. Up to `MAX_SAMPLE_COLUMNS` the table has one result column
   * per sample; above it, one row per sample (`expandSampleRows`). Default 3.
   */
  samples?: number
}

export interface BuiltInDefinition extends BuiltInTemplateInfo {
  build: (options: BuiltInOptions) => Promise<Uint8Array>
}

async function buildReport(spec: ReportSpec): Promise<Uint8Array> {
  const wb = await newWorkbook()
  addReportSheet(wb, spec)
  return writeWorkbook(wb)
}

function dimensionalReport(): Promise<Uint8Array> {
  return buildReport({
    sheet: 'Inspection',
    title: 'Dimensional Inspection Report',
    subtitle: '{{ORG_NAME}}',
    columns: [
      { caption: 'Balloon', token: '{{COL:balloon_number}}', width: 10 },
      { caption: 'Zone', token: '{{COL:zone}}', width: 7 },
      { caption: 'Characteristic', token: '{{COL:char_type}}', width: 14, align: 'left' },
      { caption: 'Requirement', token: '{{COL:spec}}', width: 30, align: 'left' },
      { caption: 'Unit', token: '{{COL:unit}}', width: 7 },
      { caption: 'Method', token: '{{COL:inspection_method}}', width: 17, align: 'left' },
      { caption: 'Measured 1', token: '{{RESULT:1}}', width: 12, input: true },
      { caption: 'Measured 2', token: '{{RESULT:2}}', width: 12, input: true },
      { caption: 'Measured 3', token: '{{RESULT:3}}', width: 12, input: true },
      { caption: 'Result', token: '{{VERDICT}}', width: 11, input: true },
      { caption: 'Remarks', token: '{{INPUT:remarks}}', width: 28, input: true, align: 'left' },
    ],
    mid: 6,
    bandItems: [
      ['Report no.', '{{REPORT_NUMBER}}'],
      ['Date issued', '{{DATE}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
    ],
    pairs: [
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
      ['Description', '{{DESCRIPTION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
    ],
    signOff: [
      ['Inspected by', '{{ENTRY:inspected_by}}', true],
      ['Date', '{{ENTRY:inspection_date}}', true],
      ['Approved by', '{{ENTRY:approved_by}}', true],
      ['Date', '{{ENTRY:approval_date}}', true],
    ],
    note: 'Columns with a lighter heading are completed by the inspector. Balloon numbers match the ballooned drawing pages that follow.',
  })
}

/**
 * Characteristic accountability laid out on the AS9102 Form 3 fields the drawing can fill
 * truthfully, numbered as the standard numbers them (1-4 identity, 5-11 per characteristic,
 * 14 comments). Fields only the supplier knows (serial number, results, tooling, nonconformance)
 * are inputs; nothing is pre-filled that the drawing does not say.
 */
function firstArticleAccountability(): Promise<Uint8Array> {
  return buildReport({
    sheet: 'Characteristics',
    title: 'First Article Inspection Report',
    subtitle: 'Characteristic accountability (AS9102 Form 3 fields)  ·  {{ORG_NAME}}',
    columns: FORM3_COLUMNS,
    mid: 6,
    bandItems: [
      ['4. FAI report no.', '{{REPORT_NUMBER}}'],
      ['Date issued', '{{DATE}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
    ],
    pairs: [
      ['1. Part number', '{{PART_NUMBER}}'],
      ['2. Part name', '{{PART_NAME}}'],
      ['Revision', '{{REVISION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['3. Serial number', '{{ENTRY:serial_number}}', true],
      ['Lot / batch', '{{ENTRY:lot_number}}', true],
      ['Supplier', '{{ENTRY:supplier}}', true],
      ['Purchase order', '{{ENTRY:purchase_order}}', true],
      ['Customer', '{{ORG_NAME}}'],
      ['Reason for FAI', '{{ENTRY:fai_reason}}', true],
    ],
    signOff: [
      ['Inspected by', '{{ENTRY:inspected_by}}', true],
      ['Date', '{{ENTRY:inspection_date}}', true],
      ['Approved by', '{{ENTRY:approved_by}}', true],
      ['Date', '{{ENTRY:approval_date}}', true],
    ],
    note: 'Numbered fields follow AS9102 Form 3. Each characteristic on the drawing is listed once, numbered as ballooned on the drawing pages that follow; the reference location is the drawing zone. Columns with a lighter heading are completed by the inspector.',
  })
}

const BUILT_INS: readonly BuiltInDefinition[] = [
  {
    key: 'dimensional-inspection',
    name: 'Dimensional inspection report',
    description:
      'Requirement, method, three measured values, result and remarks per characteristic, a summary and sign-off, with the ballooned drawing pages under the table.',
    reportTypes: [],
    defaultFor: [],
    build: () => dimensionalReport(),
  },
  {
    key: 'first-article-accountability',
    name: 'First article inspection — characteristic accountability',
    description:
      'AS9102 Form 3 fields: part and report identity, serial, lot, supplier and purchase order, one row per ballooned characteristic with reference location, designator, requirement, result, tooling, nonconformance number and pass / fail, a summary, sign-off, and the drawing pages under the table.',
    reportTypes: ['fai'],
    defaultFor: [],
    build: () => firstArticleAccountability(),
  },
  ...BUILT_IN_TYPED_TEMPLATES,
]

/** Every built-in (without bytes), in the order they are offered. */
export function builtInTemplateInfo(): BuiltInTemplateInfo[] {
  return BUILT_INS.map(({ build: _build, ...info }) => info)
}

/** Build one built-in for a report. Throws for an unknown key. */
export async function buildBuiltInTemplate(key: string, options: BuiltInOptions = {}): Promise<Uint8Array> {
  const def = BUILT_INS.find((b) => b.key === key)
  if (!def) throw new Error(`Unknown built-in template: ${key}`)
  return def.build(options)
}

/** The starter templates offered to every organization, with default options. Each analyzes with no errors. */
export async function builtInTemplates(): Promise<BuiltInTemplate[]> {
  const out: BuiltInTemplate[] = []
  for (const def of BUILT_INS) {
    const { build, ...info } = def
    out.push({ ...info, bytes: await build({}) })
  }
  return out
}
