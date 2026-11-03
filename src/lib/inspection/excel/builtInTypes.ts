/**
 * Built-in templates for the report types (5.6.0): the AS9102 first article forms, a production
 * lot report, a receiving (incoming) inspection report and a re-inspection report. Same design as
 * the starters (`builtInStyle.ts`), English workbook content.
 *
 * What BluePLM fills is what the drawing version and the report truthfully say: part identity,
 * revision, the characteristics and their requirements, the report's type, FAI scope and reason,
 * lot size and sampling plan, NCR reference. Everything only the inspecting organization knows is
 * an `{{ENTRY:...}}` cell (unlocked, read back from the returned workbook); entries the report
 * already knows (lot number, purchase order, supplier) are written into the entry so the recipient
 * can correct them.
 *
 * Production and receiving measure each characteristic on several parts. Up to
 * `MAX_SAMPLE_COLUMNS` parts the table has one result column per part; above that the table has
 * one row per part (`{{COL:sample}}`), which the app produces with `expandSampleRows`.
 */
import type { BuiltInDefinition, BuiltInOptions } from './builtIn'
import type { Worksheet } from 'exceljs'

import { addFormSheet, addReportSheet, conditional, UNUSED, type Column, type Pair, type ReportSpec } from './builtInStyle'
import { address, columnLetter } from './workbook'
import { newWorkbook, writeWorkbook } from './workbook'

/** Largest sample count laid out as one result column per sample. */
export const MAX_SAMPLE_COLUMNS = 10

/** The characteristic columns of AS9102 Form 3, numbered as the 5.5.0 starter numbers them. */
export const FORM3_COLUMNS: Column[] = [
  { caption: '5. Char. no.', token: '{{COL:balloon_number}}', width: 9 },
  { caption: '6. Reference location', token: '{{COL:zone}}', width: 11 },
  { caption: '7. Characteristic designator', token: '{{COL:classification}}', width: 14 },
  { caption: '8. Requirement', token: '{{COL:spec}}', width: 32, align: 'left' },
  { caption: 'Unit', token: '{{COL:unit}}', width: 7 },
  { caption: '9. Results', token: '{{RESULT:1}}', width: 14, input: true },
  { caption: '10. Designed / qualified tooling', token: '{{INPUT:tool}}', width: 17, input: true, align: 'left' },
  { caption: '11. Nonconformance number', token: '{{INPUT:nonconformance}}', width: 16, input: true },
  { caption: 'Pass / fail', token: '{{VERDICT}}', width: 10, input: true },
  { caption: '14. Comments', token: '{{INPUT:remarks}}', width: 26, input: true, align: 'left' },
]

const BAND: Pair[] = [
  ['Report no.', '{{REPORT_NUMBER}}'],
  ['Date issued', '{{DATE}}'],
  ['Drawing version', '{{DRAWING_VERSION}}'],
]

const SIGN_OFF: Pair[] = [
  ['Inspected by', '{{ENTRY:inspected_by}}', true],
  ['Date', '{{ENTRY:inspection_date}}', true],
  ['Approved by', '{{ENTRY:approved_by}}', true],
  ['Date', '{{ENTRY:approval_date}}', true],
]

/** Form sheets lay out over ten columns (the label of a pair takes two; the last holds the report number). */
const FORM_WIDTHS = [12, 12, 12, 12, 12, 12, 12, 12, 12, 24]

// ---------------------------------------------------------------------------
// AS9102 first article inspection: Forms 1, 2 and 3
// ---------------------------------------------------------------------------

async function firstArticleForms(): Promise<Uint8Array> {
  const wb = await newWorkbook()
  addFormSheet(wb, {
    sheet: 'Form 1 - Part',
    title: 'First Article Inspection',
    subtitle: 'Form 1 · Part number accountability (AS9102)',
    widths: FORM_WIDTHS,
    mid: 5,
    bandItems: [
      ['FAI report no.', '{{REPORT_NUMBER}}'],
      ['Date issued', '{{DATE}}'],
      ['Drawing version', '{{DRAWING_VERSION}}'],
    ],
    blocks: [
      {
        kind: 'pairs',
        heading: 'Part',
        pairs: [
          ['Part number', '{{PART_NUMBER}}'],
          ['Part name', '{{PART_NAME}}'],
          ['Part revision level', '{{REVISION}}'],
          ['Serial number', '{{ENTRY:serial_number}}', true],
          ['Drawing number', '{{DRAWING_NAME}}'],
          ['Drawing revision level', '{{REVISION}}'],
          ['Additional changes', '{{ENTRY:additional_changes}}', true],
          ['Mfg. process reference', '{{ENTRY:process_reference}}', true],
          ['Organization name', '{{ENTRY:organization_name}}', true],
          ['Supplier code', '{{ENTRY:supplier_code}}', true],
          ['Purchase order no.', '{{ENTRY:purchase_order}}', true],
          ['Detail / assembly FAI', '{{ENTRY:detail_or_assembly}}', true],
        ],
      },
      {
        kind: 'pairs',
        heading: 'Scope of this FAI',
        pairs: [
          ['FAI', '{{FAI_TYPE}}'],
          ['Reason', '{{FAI_REASON}}'],
          ['Baseline (partial FAI)', '{{FAI_BASELINE}}'],
          ['Customer', '{{ORG_NAME}}'],
        ],
      },
      {
        kind: 'table',
        heading: 'Index of part numbers or sub-assemblies',
        columns: [
          { caption: 'Part number', span: 3 },
          { caption: 'Part name', span: 3 },
          { caption: 'Part type', span: 2 },
          { caption: 'FAI report no.', span: 2 },
        ],
        rows: 4,
        prefix: 'f1_index',
      },
    ],
    signOff: [
      ['Prepared by', '{{ENTRY:prepared_by}}', true],
      ['Date', '{{ENTRY:prepared_date}}', true],
      ['Reviewed by', '{{ENTRY:reviewed_by}}', true],
      ['Date', '{{ENTRY:reviewed_date}}', true],
      ['Customer approval', '{{ENTRY:customer_approval}}', true],
      ['Date', '{{ENTRY:customer_approval_date}}', true],
    ],
    note: 'Field names follow SAE AS9102 Form 1; its field numbers are not reproduced. BluePLM fills what the drawing version and this report state; the organization performing the FAI completes the shaded fields.',
  })
  addFormSheet(wb, {
    sheet: 'Form 2 - Product',
    title: 'First Article Inspection',
    subtitle: 'Form 2 · Product accountability (AS9102)',
    widths: FORM_WIDTHS,
    mid: 5,
    bandItems: [
      ['FAI report no.', '{{REPORT_NUMBER}}'],
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
    ],
    blocks: [
      {
        kind: 'table',
        heading: 'Materials, special processes and functional testing',
        columns: [
          { caption: 'Material or process name', span: 2 },
          { caption: 'Specification number', span: 2 },
          { caption: 'Code', span: 1 },
          { caption: 'Special process supplier code', span: 2 },
          { caption: 'Customer approval verification', span: 1 },
          { caption: 'Certificate of conformance no.', span: 2 },
        ],
        rows: 8,
        prefix: 'f2_item',
      },
      {
        kind: 'table',
        heading: 'Functional testing',
        columns: [
          { caption: 'Functional test procedure number', span: 5 },
          { caption: 'Acceptance report number', span: 5 },
        ],
        rows: 3,
        prefix: 'f2_test',
      },
      { kind: 'text', heading: 'Comments', token: '{{ENTRY:f2_comments}}', height: 48 },
    ],
    signOff: [
      ['Prepared by', '{{ENTRY:f2_prepared_by}}', true],
      ['Date', '{{ENTRY:f2_prepared_date}}', true],
    ],
    note: 'Field names follow SAE AS9102 Form 2. The drawing does not say which materials, special processes or functional tests the part went through: the organization performing the FAI lists them, with their certificates.',
  })
  addReportSheet(wb, {
    sheet: 'Form 3 - Characteristics',
    title: 'First Article Inspection',
    subtitle: 'Form 3 · Characteristic accountability (AS9102)  ·  {{ORG_NAME}}',
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
      ['FAI', '{{FAI_TYPE}}'],
    ],
    signOff: SIGN_OFF,
    note: 'Numbered fields follow AS9102 Form 3; the serial number is on Form 1. A full FAI lists every characteristic on the drawing; a partial FAI lists only those changed since its baseline (Form 1). Characteristics are numbered as ballooned on the drawing pages that follow; the reference location is the drawing zone.',
  })
  return writeWorkbook(wb)
}

// ---------------------------------------------------------------------------
// Lots: production and receiving
// ---------------------------------------------------------------------------

function sampleCount(options: BuiltInOptions): number {
  const n = Math.floor(options.samples ?? 3)
  return Number.isFinite(n) && n >= 1 ? n : 3
}

/** The characteristic columns of a lot report: one result column per sample, or one row per sample. */
function lotColumns(samples: number): { columns: Column[]; perRow: boolean } {
  const lead: Column[] = [
    { caption: 'Balloon', token: '{{COL:balloon_number}}', width: 9 },
    { caption: 'Zone', token: '{{COL:zone}}', width: 6 },
    { caption: 'Class', token: '{{COL:classification}}', width: 9 },
    { caption: 'Requirement', token: '{{COL:spec}}', width: 26, align: 'left' },
    { caption: 'Unit', token: '{{COL:unit}}', width: 6 },
    { caption: 'Method', token: '{{COL:inspection_method}}', width: 14, align: 'left' },
  ]
  const tail: Column[] = [
    { caption: 'Result', token: '{{VERDICT}}', width: 9, input: true },
    { caption: 'Remarks', token: '{{INPUT:remarks}}', width: 24, input: true, align: 'left' },
  ]
  if (samples > MAX_SAMPLE_COLUMNS) {
    return {
      perRow: true,
      columns: [
        ...lead,
        { caption: 'Sample', token: '{{COL:sample}}', width: 9 },
        { caption: 'Serial / part ID', token: '{{INPUT:part_id}}', width: 14, input: true },
        { caption: 'Measured', token: '{{RESULT:1}}', width: 12, input: true },
        ...tail,
      ],
    }
  }
  const results: Column[] = Array.from({ length: samples }, (_, i) => ({
    caption: samples === 1 ? 'Measured' : `Sample ${i + 1}`,
    token: `{{RESULT:${i + 1}}}`,
    width: samples > 5 ? 9 : 11,
    input: true,
  }))
  return { perRow: false, columns: [...lead, { caption: 'Parts', token: '{{COL:sample_size}}', width: 6 }, ...results, ...tail] }
}

/**
 * Shade the sample cells a characteristic does not need: sample k of a row whose Parts column is
 * below k. The rule names the template row; the engine grows its range with the table.
 */
function shadeUnusedSamples(ws: Worksheet, columns: Column[]): void {
  const partsCol = columns.findIndex((c) => c.token === '{{COL:sample_size}}') + 1
  const first = columns.findIndex((c) => c.token === '{{RESULT:1}}') + 1
  const count = columns.filter((c) => /^\{\{RESULT:\d+\}\}$/.test(c.token)).length
  if (partsCol === 0 || first === 0 || count < 2) return
  let row = 0
  ws.eachRow((r, n) => {
    if (!row && r.getCell(first).value === '{{RESULT:1}}') row = n
  })
  if (!row) return
  const ref = `${address(row, first)}:${address(row, first + count - 1)}`
  // Relative to the range's top-left cell: COLUMN() counts samples from 1.
  const formula = `COLUMN()-${first - 1}>$${columnLetter(partsCol)}${row}`
  conditional(ws, ref, [{ type: 'expression', formulae: [formula], style: UNUSED, priority: 1 }])
}

function lotNote(perRow: boolean, receiving: boolean): string {
  const layout = perRow
    ? 'Each characteristic has one row per sampled part.'
    : 'Measure each characteristic on the number of parts in its Parts column, one value per sample column.'
  const who = receiving ? 'the receiving inspector' : 'the inspector'
  return `${layout} The sampling plan is the one this report was issued with; columns with a lighter heading are completed by ${who}. Balloon numbers match the ballooned drawing pages that follow.`
}

async function productionLot(options: BuiltInOptions): Promise<Uint8Array> {
  const { columns, perRow } = lotColumns(sampleCount(options))
  const wb = await newWorkbook()
  const spec: ReportSpec = {
    sheet: 'Production inspection',
    title: 'Production Inspection Report',
    subtitle: 'Lot inspection  ·  {{ORG_NAME}}',
    columns,
    mid: 6,
    bandItems: BAND,
    pairs: [
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
      ['Description', '{{DESCRIPTION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['Lot / batch no.', '{{ENTRY:lot_number}}', true],
      ['Lot size', '{{LOT_SIZE}}'],
      ['Sampling plan', '{{SAMPLING_PLAN}}'],
      ['Characteristics', '{{CHARACTERISTIC_SCOPE}}'],
      ['Work order', '{{ENTRY:work_order}}', true],
      ['Operation', '{{ENTRY:operation}}', true],
    ],
    signOff: [
      ...SIGN_OFF,
      ['Lot disposition', '{{ENTRY:lot_disposition}}', true],
      ['NCR no.', '{{ENTRY:ncr_number}}', true],
    ],
    note: lotNote(perRow, false),
    countCaption: perRow ? 'Measurements' : undefined,
  }
  shadeUnusedSamples(addReportSheet(wb, spec), columns)
  return writeWorkbook(wb)
}

async function receivingInspection(options: BuiltInOptions): Promise<Uint8Array> {
  const { columns, perRow } = lotColumns(sampleCount(options))
  const wb = await newWorkbook()
  const ws = addReportSheet(wb, {
    sheet: 'Receiving inspection',
    title: 'Receiving Inspection Report',
    subtitle: 'Incoming inspection  ·  {{ORG_NAME}}',
    columns,
    mid: 6,
    bandItems: BAND,
    pairs: [
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
      ['Description', '{{DESCRIPTION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['Supplier', '{{ENTRY:supplier}}', true],
      ['Purchase order', '{{ENTRY:purchase_order}}', true],
      ['Lot / batch no.', '{{ENTRY:lot_number}}', true],
      ['Lot size', '{{LOT_SIZE}}'],
      ['Sampling plan', '{{SAMPLING_PLAN}}'],
      ['Characteristics', '{{CHARACTERISTIC_SCOPE}}'],
      ['C of C no.', '{{ENTRY:coc_number}}', true],
      ['Date received', '{{ENTRY:received_date}}', true],
    ],
    signOff: [
      ...SIGN_OFF,
      ['Lot disposition', '{{ENTRY:lot_disposition}}', true],
      ['NCR no.', '{{ENTRY:ncr_number}}', true],
    ],
    note: lotNote(perRow, true),
    countCaption: perRow ? 'Measurements' : undefined,
  })
  shadeUnusedSamples(ws, columns)
  return writeWorkbook(wb)
}

// ---------------------------------------------------------------------------
// Re-inspection after a nonconformance
// ---------------------------------------------------------------------------

async function reinspection(): Promise<Uint8Array> {
  const wb = await newWorkbook()
  addReportSheet(wb, {
    sheet: 'Re-inspection',
    title: 'Re-inspection Report',
    subtitle: 'After nonconformance {{NCR_REFERENCE}}  ·  {{ORG_NAME}}',
    columns: [
      { caption: 'Balloon', token: '{{COL:balloon_number}}', width: 9 },
      { caption: 'Zone', token: '{{COL:zone}}', width: 7 },
      { caption: 'Class', token: '{{COL:classification}}', width: 9 },
      { caption: 'Requirement', token: '{{COL:spec}}', width: 30, align: 'left' },
      { caption: 'Unit', token: '{{COL:unit}}', width: 7 },
      { caption: 'Method', token: '{{COL:inspection_method}}', width: 16, align: 'left' },
      { caption: 'Measured 1', token: '{{RESULT:1}}', width: 12, input: true },
      { caption: 'Measured 2', token: '{{RESULT:2}}', width: 12, input: true },
      { caption: 'Measured 3', token: '{{RESULT:3}}', width: 12, input: true },
      { caption: 'Result', token: '{{VERDICT}}', width: 10, input: true },
      { caption: 'Remarks', token: '{{INPUT:remarks}}', width: 26, input: true, align: 'left' },
    ],
    mid: 6,
    bandItems: BAND,
    pairs: [
      ['Part number', '{{PART_NUMBER}}'],
      ['Revision', '{{REVISION}}'],
      ['Description', '{{DESCRIPTION}}'],
      ['Drawing', '{{DRAWING_NAME}}'],
      ['Nonconformance', '{{NCR_REFERENCE}}'],
      ['Serial / lot no.', '{{ENTRY:lot_number}}', true],
      ['Qty re-inspected', '{{ENTRY:quantity}}', true],
      ['Rework / disposition', '{{ENTRY:mrb_disposition}}', true],
    ],
    signOff: SIGN_OFF,
    note: 'Only the characteristics named in the nonconformance are listed. Columns with a lighter heading are completed by the inspector. Balloon numbers match the ballooned drawing pages that follow.',
  })
  return writeWorkbook(wb)
}

export const BUILT_IN_TYPED_TEMPLATES: readonly BuiltInDefinition[] = [
  {
    key: 'first-article-as9102',
    name: 'First article inspection (AS9102 Forms 1-3)',
    description:
      'Form 1 part number accountability (part, drawing, FAI scope, reason and baseline), Form 2 product accountability (materials, special processes, functional tests) and Form 3 characteristic accountability, with the ballooned drawing pages under Form 3.',
    reportTypes: ['fai'],
    defaultFor: ['fai'],
    build: () => firstArticleForms(),
  },
  {
    key: 'production-lot',
    name: 'Production inspection report',
    description:
      'Lot, lot size and sampling plan, one result per sampled part for each characteristic (one row per part above ten parts), lot disposition and sign-off, with the drawing pages under the table.',
    reportTypes: ['production'],
    defaultFor: ['production'],
    build: (options) => productionLot(options),
  },
  {
    key: 'receiving-inspection',
    name: 'Receiving inspection report',
    description:
      'Supplier, purchase order, lot and certificate of conformance, the sampling plan, one result per sampled part, lot disposition and sign-off, with the drawing pages under the table.',
    reportTypes: ['receiving'],
    defaultFor: ['receiving'],
    build: (options) => receivingInspection(options),
  },
  {
    key: 'reinspection',
    name: 'Re-inspection report',
    description:
      'The nonconformance, the characteristics it names with three measured values each, the rework or disposition and sign-off, with the drawing pages under the table.',
    reportTypes: ['reinspection'],
    defaultFor: ['reinspection'],
    build: () => reinspection(),
  },
]
