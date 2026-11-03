/**
 * The report-type built-ins (5.6.0) through the real engine: their layouts, the one-row-per-part
 * layout of a large sample, known entries written in, the AS9102 form sheets, and a returned
 * workbook read back and folded to one result per characteristic.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { collapseSampleRows, expandSampleRows } from '../reportTypes'
import { analyzeTemplate } from './analyze'
import { buildBuiltInTemplate } from './builtIn'
import { MAX_SAMPLE_COLUMNS } from './builtInTypes'
import type { InspectionReportRow } from './format'
import { generateInspectionReport, META_ROWS_START } from './generate'
import { readReturnedResults } from './results'
import { cellText, META_SHEET, newWorkbook, readWorkbook, writeWorkbook } from './workbook'

function row(i: number, over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return {
    id: `row-${i}`,
    sort_order: i,
    balloon_number: String(i),
    char_id: null,
    zone: `B${i}`,
    char_type: 'Dimension',
    sub_type: null,
    nominal_value: '25.40',
    unit: 'mm',
    plus_tolerance: '0.10',
    minus_tolerance: '0.10',
    upper_limit: null,
    lower_limit: null,
    classification: 'Major',
    inspection_method: 'Caliper',
    operation: null,
    aql: null,
    sample_size: null,
    supplier_inspection_rate: null,
    internal_inspection_rate: null,
    reference: null,
    comments: null,
    source_key: `key-${i}`,
    source_sheet: 'Sheet1',
    source_view: null,
    ...over,
  }
}

beforeAll(async () => {
  await readWorkbook(await writeWorkbook(await newWorkbook()))
}, 60_000)

describe('lot templates', () => {
  it('have one result column per part up to the column limit', async () => {
    for (const key of ['production-lot', 'receiving-inspection']) {
      const layout = await analyzeTemplate(await buildBuiltInTemplate(key, { samples: 5 }))
      expect(layout.errors, key).toEqual([])
      expect(layout.resultCount, key).toBe(5)
      expect(layout.rowTemplate!.cells.some((c) => c.kind === 'field' && c.fields.includes('sample_size')), key).toBe(true)
      const max = await analyzeTemplate(await buildBuiltInTemplate(key, { samples: MAX_SAMPLE_COLUMNS }))
      expect(max.resultCount).toBe(MAX_SAMPLE_COLUMNS)
    }
  })

  it('have one row per part above it', async () => {
    const layout = await analyzeTemplate(await buildBuiltInTemplate('production-lot', { samples: MAX_SAMPLE_COLUMNS + 1 }))
    expect(layout.errors).toEqual([])
    expect(layout.resultCount).toBe(1)
    expect(layout.rowTemplate!.cells.some((c) => c.kind === 'field' && c.fields.includes('sample'))).toBe(true)
  })

  it('write known entries in, and read back what the recipient leaves there', async () => {
    const template = await buildBuiltInTemplate('receiving-inspection', { samples: 2 })
    const bytes = await generateInspectionReport({
      template,
      reportId: 'rep',
      fileId: 'f',
      fileVersionId: 'v',
      rows: [row(1, { sample_size: 2 })],
      entryValues: { lot_number: 'L-77', purchase_order: 'PO-12', supplier: 'Acme' },
      scalars: { LOT_SIZE: '40', SAMPLING_PLAN: '2 parts per characteristic' },
    })
    const ws = (await readWorkbook(bytes)).worksheets[0]
    const texts: string[] = []
    ws.eachRow((r) => r.eachCell((c) => texts.push(cellText(c))))
    expect(texts).toEqual(expect.arrayContaining(['L-77', 'PO-12', 'Acme', '40', '2 parts per characteristic']))
    const back = await readReturnedResults(bytes, { reportId: 'rep' })
    expect(back.entries).toMatchObject({ lot_number: 'L-77', purchase_order: 'PO-12', supplier: 'Acme' })
  })

  it('round-trips a large sample: one row per part, folded back per characteristic', async () => {
    const rows = [row(1), row(2)]
    const counts = new Map([
      ['row-1', 12],
      ['row-2', 12],
    ])
    const laidOut = expandSampleRows(rows, counts, MAX_SAMPLE_COLUMNS)
    const bytes = await generateInspectionReport({
      template: await buildBuiltInTemplate('production-lot', { samples: 12 }),
      reportId: 'rep',
      fileId: 'f',
      fileVersionId: 'v',
      rows: laidOut,
    })
    // Fill measurements as a supplier would: characteristic 1 all in tolerance, characteristic 2
    // with one part out.
    const wb = await readWorkbook(bytes)
    const layout = await analyzeTemplate(await buildBuiltInTemplate('production-lot', { samples: 12 }))
    const resultCol = layout.rowTemplate!.cells.find((c) => c.kind === 'result')!.col
    const meta = wb.getWorksheet(META_SHEET)!
    const table = wb.getWorksheet(layout.rowTemplate!.sheet)!
    for (let i = 0; i < laidOut.length; i++) {
      const sheetRow = Number(cellText(meta.getCell(META_ROWS_START + i, 2)))
      const id = cellText(meta.getCell(META_ROWS_START + i, 3))
      expect(id).toBe(laidOut[i].id)
      table.getCell(sheetRow, resultCol).value = id === 'row-2#7' ? '25.80' : '25.41'
    }
    expect(cellText(table.getCell(Number(cellText(meta.getCell(META_ROWS_START, 2))), 7))).toBe('1 / 12')
    const returned = await readReturnedResults(await writeWorkbook(wb), { reportId: 'rep', rows: laidOut })
    expect(returned.warnings).toEqual([])
    const folded = collapseSampleRows(returned)
    expect(folded.rows.map((r) => [r.rowId, r.measured.length, r.verdict])).toEqual([
      ['row-1', 12, 'pass'],
      ['row-2', 12, 'fail'],
    ])
    expect(folded.rows[1].measured[6]).toBe('25.80')
  })
})

describe('a characteristic measured on several parts in one row', () => {
  it('stays open until every part has a value; one value out of tolerance fails it', async () => {
    const template = await buildBuiltInTemplate('production-lot', { samples: 5 })
    const layout = await analyzeTemplate(template)
    const rows = [row(1, { sample_size: 5 }), row(2, { sample_size: 5 }), row(3, { sample_size: 5 })]
    const bytes = await generateInspectionReport({ template, reportId: 'rep', fileId: 'f', fileVersionId: 'v', rows })
    const wb = await readWorkbook(bytes)
    const table = wb.getWorksheet(layout.rowTemplate!.sheet)!
    const results = layout.rowTemplate!.cells.filter((c) => c.kind === 'result').sort((a, b) => (a.kind === 'result' && b.kind === 'result' ? a.index - b.index : 0))
    const verdictCol = layout.rowTemplate!.cells.find((c) => c.kind === 'verdict')!.col
    const first = layout.rowTemplate!.row
    // Row 1: one value in tolerance, typed PASS. Row 2: all five in tolerance. Row 3: one out.
    table.getCell(first, results[0].col).value = '25.41'
    table.getCell(first, verdictCol).value = 'PASS'
    for (const c of results) table.getCell(first + 1, c.col).value = '25.40'
    table.getCell(first + 2, results[0].col).value = '25.90'
    const expectedValues = new Map(rows.map((r) => [r.id, 5]))
    const back = await readReturnedResults(await writeWorkbook(wb), { reportId: 'rep', rows, expectedValues })
    expect(back.rows.map((r) => r.verdict)).toEqual([null, 'pass', 'fail'])
    // Without the expectation (5.5.0's rule) one value passes.
    const loose = await readReturnedResults(await writeWorkbook(wb), { reportId: 'rep', rows })
    expect(loose.rows[0].verdict).toBe('pass')
  })
})

describe('AS9102 first article template', () => {
  it('has Forms 1, 2 and 3, with the table on Form 3 and FAI scope on Form 1', async () => {
    const template = await buildBuiltInTemplate('first-article-as9102')
    const layout = await analyzeTemplate(template)
    expect(layout.errors).toEqual([])
    expect(layout.warnings).toEqual([])
    expect(layout.rowTemplate!.sheet).toBe('Form 3 - Characteristics')
    expect(layout.logoAnchors).toHaveLength(3)
    const bytes = await generateInspectionReport({
      template,
      reportId: 'rep',
      fileId: 'f',
      fileVersionId: 'v',
      rows: [row(1), row(2)],
      scalars: { FAI_TYPE: 'Partial FAI', FAI_REASON: 'Design change', FAI_BASELINE: 'Version 2 · Rev A', PART_NUMBER: 'BR-1' },
    })
    const wb = await readWorkbook(bytes)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Form 1 - Part', 'Form 2 - Product', 'Form 3 - Characteristics', META_SHEET])
    const form1: string[] = []
    wb.getWorksheet('Form 1 - Part')!.eachRow((r) => r.eachCell((c) => form1.push(cellText(c))))
    expect(form1).toEqual(expect.arrayContaining(['Partial FAI', 'Design change', 'Version 2 · Rev A', 'BR-1']))
    const back = await readReturnedResults(bytes, { reportId: 'rep', rows: [row(1), row(2)] })
    expect(back.rows).toHaveLength(2)
    expect(Object.keys(back.entries)).toEqual(expect.arrayContaining(['serial_number', 'f2_item_1_1', 'f2_comments', 'customer_approval']))
  })
})

describe('re-inspection template', () => {
  it('analyzes cleanly and prints the NCR in its subtitle', async () => {
    const template = await buildBuiltInTemplate('reinspection')
    expect((await analyzeTemplate(template)).errors).toEqual([])
    const bytes = await generateInspectionReport({
      template,
      reportId: 'rep',
      fileId: 'f',
      fileVersionId: 'v',
      rows: [row(3)],
      scalars: { NCR_REFERENCE: 'NCR-0042' },
    })
    const texts: string[] = []
    ;(await readWorkbook(bytes)).worksheets[0].eachRow((r) => r.eachCell((c) => texts.push(cellText(c))))
    expect(texts.some((x) => x.includes('After nonconformance NCR-0042'))).toBe(true)
  })
})
