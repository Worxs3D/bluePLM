import { describe, expect, it } from 'vitest'

import { analyzeTemplate } from './analyze'
import { builtInTemplates } from './builtIn'
import type { InspectionReportRow } from './format'
import { generateInspectionReport, InspectionTemplateError } from './generate'
import { readReturnedResults } from './results'
import { cellText, META_SHEET, newWorkbook, readWorkbook, writeWorkbook } from './workbook'

// 1x1 PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

function row(i: number, over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return {
    id: `row-${i}`,
    sort_order: i,
    balloon_number: String(i),
    char_id: null,
    zone: `B${i}`,
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '25.40',
    unit: 'mm',
    plus_tolerance: '+0.10',
    minus_tolerance: '-0.10',
    upper_limit: null,
    lower_limit: null,
    classification: null,
    inspection_method: 'Caliper',
    operation: null,
    aql: null,
    sample_size: 5,
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

/** A template with a styled, merged row template, content and merges below it, and an entry. */
async function customTemplate(): Promise<Uint8Array> {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet('Report')
  ws.getCell('A1').value = 'Part {{BR_NUMBER}} rev {{REVISION}} ({{PROP:Material}})'
  ws.getCell('A2').value = 'Serial'
  ws.getCell('B2').value = '{{ENTRY:serial}}'
  ws.getCell('A4').value = 'Balloon'
  ws.getCell('B4').value = 'Requirement'
  ws.getCell('A5').value = '{{COL:balloon_number}}'
  ws.getCell('B5').value = '{{COL:spec}}'
  ws.mergeCells('B5:C5')
  ws.getCell('D5').value = '{{COL:sample_size}}'
  ws.getCell('E5').value = '{{RESULT:1}}'
  ws.getCell('F5').value = '{{RESULT:2}}'
  ws.getCell('G5').value = '{{VERDICT}}'
  ws.getCell('H5').value = '{{INPUT:tool}}'
  ws.getCell('I5').value = 'n={{COL:zone}}'
  for (const c of ['A5', 'B5', 'D5', 'E5']) {
    ws.getCell(c).border = { bottom: { style: 'thin' } }
    ws.getCell(c).font = { bold: true }
  }
  ws.getRow(5).height = 24
  ws.getCell('A7').value = 'Signed'
  ws.getCell('B7').value = '{{ENTRY:signed_by}}'
  ws.mergeCells('B7:D7')
  ws.getCell('A9').value = '{{DRAWING}}'
  ws.mergeCells('A9:F20')
  return writeWorkbook(wb)
}

describe('analyzeTemplate', () => {
  it('finds the row template, scalars, entries, results and the drawing anchor', async () => {
    const layout = await analyzeTemplate(await customTemplate())
    expect(layout.errors).toEqual([])
    expect(layout.rowTemplate?.row).toBe(5)
    expect(layout.rowTemplate?.cells.map((c) => c.kind)).toEqual(['field', 'field', 'field', 'result', 'result', 'verdict', 'input', 'field'])
    expect(layout.rowTemplate?.printTitleRows).toBe('4:4')
    expect(layout.scalars[0].tokens).toEqual(['PART_NUMBER', 'REVISION', 'PROP:Material'])
    expect(layout.properties).toEqual(['Material'])
    expect(layout.entries.map((e) => e.name)).toEqual(['serial', 'signed_by'])
    expect(layout.resultCount).toBe(2)
    expect(layout.hasVerdict).toBe(true)
    expect(layout.drawingAnchor).toEqual({ sheet: 'Report', cell: 'A9' })
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout)
  })

  it('reports a missing row template and unknown tokens / fields', async () => {
    const wb = await newWorkbook()
    const ws = wb.addWorksheet('S')
    ws.getCell('A1').value = '{{PART_NUMBER}} {{WHAT}} {{PART_PREVIEW}}'
    const layout = await analyzeTemplate(await writeWorkbook(wb))
    expect(layout.errors.map((e) => e.code)).toEqual(['NO_ROW_TEMPLATE'])
    expect(layout.warnings.map((w) => w.code)).toEqual(['UNKNOWN_TOKEN', 'UNSUPPORTED_TOKEN'])

    ws.getCell('A3').value = '{{COL:nominal_value}}'
    ws.getCell('B3').value = '{{COL:colour}}'
    ws.getCell('C6').value = '{{RESULT}}'
    const second = await analyzeTemplate(await writeWorkbook(wb))
    expect(second.errors).toEqual([])
    expect(second.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['UNKNOWN_FIELD', 'ROW_TOKEN_OUTSIDE_TEMPLATE', 'NO_RESULT_COLUMNS']),
    )
  })

  it('refuses a row template merged across rows and an unreadable file', async () => {
    const wb = await newWorkbook()
    const ws = wb.addWorksheet('S')
    ws.getCell('A2').value = '{{COL:balloon_number}}'
    ws.mergeCells('A2:A3')
    expect((await analyzeTemplate(await writeWorkbook(wb))).errors.map((e) => e.code)).toEqual(['ROW_TEMPLATE_VERTICAL_MERGE'])
    expect((await analyzeTemplate(new Uint8Array([1, 2, 3]))).errors.map((e) => e.code)).toEqual(['UNREADABLE_WORKBOOK'])
  })

  it('understands a legacy Google Sheets {{INSPECTION_TABLE}} layout', async () => {
    const wb = await newWorkbook()
    const ws = wb.addWorksheet('S')
    ws.getCell('A1').value = '{{COL:balloon_number}}'
    ws.getCell('B1').value = '{{COL:nominal}}'
    ws.getCell('A2').value = '{{INSPECTION_TABLE}}'
    ws.getCell('C2').value = '{{RESULT}}'
    const bytes = await writeWorkbook(wb)
    const layout = await analyzeTemplate(bytes)
    expect(layout.errors).toEqual([])
    expect(layout.rowTemplate).toMatchObject({ row: 2, legacyHeaderRow: 1 })
    const out = await readWorkbook(
      await generateInspectionReport({ template: bytes, reportId: 'r', fileId: 'f', fileVersionId: 'v', rows: [row(1), row(2)] }),
    )
    const s = out.getWorksheet('S')!
    expect([cellText(s.getCell('A1')), cellText(s.getCell('B1'))]).toEqual(['Balloon', 'Nominal'])
    expect([cellText(s.getCell('A2')), cellText(s.getCell('B2')), cellText(s.getCell('A3'))]).toEqual(['1', '25.40', '2'])
  })
})

describe('builtInTemplates', () => {
  it('ships the two starters and both analyze with no errors', async () => {
    const templates = await builtInTemplates()
    expect(templates.map((t) => t.key)).toEqual(['dimensional-inspection', 'first-article-accountability'])
    for (const t of templates) {
      const layout = await analyzeTemplate(t.bytes)
      expect(layout.errors, t.key).toEqual([])
      expect(layout.warnings, t.key).toEqual([])
      expect(layout.resultCount).toBeGreaterThan(0)
      expect(layout.hasVerdict).toBe(true)
    }
    const fai = await analyzeTemplate(templates[1].bytes)
    expect(fai.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['serial_number', 'lot_number', 'supplier', 'inspected_by', 'approved_by']),
    )
  })

  it('a starter generates and reads back', async () => {
    const [dimensional] = await builtInTemplates()
    const rows = [row(1), row(2), row(3), row(4)]
    const bytes = await generateInspectionReport({
      template: dimensional.bytes,
      reportId: 'rep',
      fileId: 'f',
      fileVersionId: 'v',
      rows,
      drawingPages: [{ png: PNG, widthPx: 1700, heightPx: 1100 }],
    })
    const wb = await readWorkbook(bytes)
    expect(wb.getWorksheet('Drawing')!.getImages()).toHaveLength(1)
    const back = await readReturnedResults(bytes, { reportId: 'rep', rows })
    expect(back.rows).toHaveLength(4)
    expect(back.warnings).toEqual([])
  })
})

describe('generateInspectionReport', () => {
  const rows = [row(1), row(2), row(3, { plus_tolerance: null, minus_tolerance: null, upper_limit: '10.2', lower_limit: '10.0', nominal_value: '10.1' })]

  async function generate(template?: Uint8Array) {
    return generateInspectionReport({
      template: template ?? (await customTemplate()),
      templateHash: 'hash-1',
      reportId: 'report-1',
      fileId: 'file-1',
      fileVersionId: 'version-1',
      rows,
      scalars: { PART_NUMBER: 'BR-100', REVISION: 'C' },
      properties: { material: 'Al 6061' },
      drawingPages: [
        { png: PNG, widthPx: 1700, heightPx: 1100 },
        { png: PNG, widthPx: 1100, heightPx: 1700 },
      ],
      generatedAt: new Date('2026-11-02T10:00:00Z'),
    })
  }

  it('fills scalars and repeats the row template with styles, heights and merges', async () => {
    const wb = await readWorkbook(await generate())
    const ws = wb.getWorksheet('Report')!
    expect(cellText(ws.getCell('A1'))).toBe('Part BR-100 rev C (Al 6061)')
    for (let i = 0; i < 3; i++) {
      const r = 5 + i
      expect(cellText(ws.getCell(r, 1))).toBe(String(i + 1))
      expect(ws.getCell(r, 1).font?.bold).toBe(true)
      expect(ws.getCell(r, 2).border?.bottom?.style).toBe('thin')
      expect(ws.getRow(r).height).toBe(24)
      expect(ws.getCell(r, 4).value).toBe(5)
      expect(cellText(ws.getCell(r, 9))).toBe(`n=B${i + 1}`)
    }
    expect(cellText(ws.getCell('B5'))).toBe('25.40 ±0.10')
    expect(cellText(ws.getCell('B7'))).toBe('10.1 (10.0 – 10.2)')
    const merges = ws.model.merges
    expect(merges).toEqual(expect.arrayContaining(['B5:C5', 'B6:C6', 'B7:C7', 'B9:D9', 'A11:F22']))
    // Content below the table moved down by two rows.
    expect(cellText(ws.getCell('A9'))).toBe('Signed')
    expect(ws.pageSetup.printTitlesRow).toBe('4:4')
  })

  it('unlocks only the recipient cells and protects every sheet', async () => {
    const wb = await readWorkbook(await generate())
    const ws = wb.getWorksheet('Report')!
    for (const c of ['E5', 'F6', 'G7', 'H5', 'B2', 'B9']) expect(ws.getCell(c).protection?.locked, c).toBe(false)
    for (const c of ['A5', 'B6', 'D7', 'A1']) expect(ws.getCell(c).protection?.locked, c).not.toBe(false)
    expect(ws.getCell('G6').dataValidation?.type).toBe('list')
    for (const sheet of wb.worksheets) {
      const protection = (sheet as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection
      expect(protection?.sheet, sheet.name).toBe(true)
    }
  })

  it('embeds the drawing at the anchor and adds a sheet for further pages', async () => {
    const wb = await readWorkbook(await generate())
    expect(wb.getWorksheet('Report')!.getImages()).toHaveLength(1)
    const extra = wb.getWorksheet('Drawing 2')!
    expect(extra.getImages()).toHaveLength(1)
    expect(extra.pageSetup.orientation).toBe('landscape')
    expect(extra.pageSetup.fitToPage).toBe(true)
  })

  it('writes a very hidden _blueplm sheet identifying the report and rows', async () => {
    const wb = await readWorkbook(await generate())
    const meta = wb.getWorksheet(META_SHEET)!
    expect(meta.state).toBe('veryHidden')
    expect(cellText(meta.getCell('B2'))).toBe('report-1')
    expect(cellText(meta.getCell('B5'))).toBe('hash-1')
    expect(cellText(meta.getCell('D11'))).toBe('key-1')
    expect(cellText(meta.getCell('D13'))).toBe('key-3')
  })

  it('refuses a template with errors', async () => {
    const wb = await newWorkbook()
    wb.addWorksheet('S').getCell('A1').value = '{{PART_NUMBER}}'
    await expect(
      generateInspectionReport({ template: await writeWorkbook(wb), reportId: 'r', fileId: 'f', fileVersionId: 'v', rows }),
    ).rejects.toBeInstanceOf(InspectionTemplateError)
  })

  it('keeps one blank row for a report with no characteristics', async () => {
    const wb = await readWorkbook(
      await generateInspectionReport({ template: await customTemplate(), reportId: 'r', fileId: 'f', fileVersionId: 'v', rows: [] }),
    )
    const ws = wb.getWorksheet('Report')!
    expect(cellText(ws.getCell('A5'))).toBe('')
    expect(cellText(ws.getCell('A7'))).toBe('Signed')
  })

  describe('readReturnedResults', () => {
    async function returned(edit: (ws: import('exceljs').Worksheet) => void): Promise<Uint8Array> {
      const wb = await readWorkbook(await generate())
      edit(wb.getWorksheet('Report')!)
      return writeWorkbook(wb)
    }

    it('reads measured values, inputs, entries and verdicts', async () => {
      const bytes = await returned((ws) => {
        ws.getCell('E5').value = '25.45'
        ws.getCell('F5').value = 25.38
        ws.getCell('G5').value = 'PASS'
        ws.getCell('H5').value = 'Mitutoyo 500'
        ws.getCell('E6').value = '25.6'
        ws.getCell('G6').value = 'pass'
        ws.getCell('G7').value = 'later'
        ws.getCell('B2').value = 'SN-0042'
        ws.getCell('B9').value = 'J. Smith'
      })
      const res = await readReturnedResults(bytes, { reportId: 'report-1', rows })
      expect(res.reportId).toBe('report-1')
      expect(res.fileVersionId).toBe('version-1')
      expect(res.entries).toEqual({ serial: 'SN-0042', signed_by: 'J. Smith' })
      expect(res.rows.map((r) => r.sourceKey)).toEqual(['key-1', 'key-2', 'key-3'])
      expect(res.rows[0]).toMatchObject({ measured: ['25.45', '25.38'], inputs: { tool: 'Mitutoyo 500' }, verdict: 'pass', tampered: false })
      expect(res.rows[1]).toMatchObject({ computedVerdict: 'fail', enteredVerdict: 'pass', verdict: 'fail', verdictConflict: true })
      expect(res.rows[2]).toMatchObject({ verdict: null, enteredVerdictText: 'later' })
      expect(res.summary).toEqual({ total: 3, pass: 1, fail: 1, blank: 1 })
      expect(res.warnings.map((w) => w.code).sort()).toEqual(['UNRECOGNIZED_VERDICT', 'VERDICT_CONFLICT'])
    })

    it('flags an edited requirement cell and a mismatching expected spec', async () => {
      const bytes = await returned((ws) => {
        ws.getCell('B6').value = '25.40 ±0.50'
      })
      const res = await readReturnedResults(bytes, { rows: [rows[0], rows[1], { ...rows[2], upper_limit: '10.5' }] })
      expect(res.rows.map((r) => r.tampered)).toEqual([false, true, true])
      expect(res.rows[1].tamperReasons).toEqual(['cells'])
      expect(res.rows[2].tamperReasons).toEqual(['spec'])
      expect(res.warnings.filter((w) => w.code === 'TAMPERED_ROW')).toHaveLength(2)
    })

    it('computes verdicts from _blueplm when no expected rows are given, and reports mismatches', async () => {
      const bytes = await returned((ws) => {
        ws.getCell('E7').value = '10.3'
      })
      const res = await readReturnedResults(bytes, { reportId: 'other', rows: [rows[0], row(9)] })
      expect(res.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['REPORT_ID_MISMATCH', 'UNKNOWN_ROW', 'MISSING_ROW']))
      const free = await readReturnedResults(bytes)
      expect(free.rows[2].computedVerdict).toBe('fail')
    })

    it('says so when the workbook is not a BluePLM report', async () => {
      const wb = await newWorkbook()
      wb.addWorksheet('S')
      const res = await readReturnedResults(await writeWorkbook(wb))
      expect(res.reportId).toBeNull()
      expect(res.warnings.map((w) => w.code)).toEqual(['NOT_A_REPORT'])
    })
  })
})
