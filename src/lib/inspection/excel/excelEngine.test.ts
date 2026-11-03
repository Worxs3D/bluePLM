import type { Worksheet } from 'exceljs'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'

import { analyzeTemplate } from './analyze'
import { builtInTemplates } from './builtIn'
import type { InspectionReportRow } from './format'
import { shiftFormula } from './formulaShift'
import { generateInspectionReport, InspectionTemplateError } from './generate'
import { imageSize, wrappedLines } from './place'
import { rasterScale } from './rasterizePdf'
import { readReturnedResults } from './results'
import { cellText, decodeRange, META_SHEET, newWorkbook, readWorkbook, writeWorkbook } from './workbook'

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

// exceljs loads lazily on first use; under a full-suite run that import alone can outlast the
// first test's 5 s budget. Load it once here, so every test measures only its own work.
beforeAll(async () => {
  await readWorkbook(await writeWorkbook(await newWorkbook()))
}, 60_000)

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

interface PlacedImage {
  range: { tl: { nativeCol: number; nativeRow: number }; ext?: { width: number; height: number } }
}

function images(ws: Worksheet): PlacedImage[] {
  return ws.getImages() as unknown as PlacedImage[]
}

/** Manual row breaks of a sheet, read from the XML (exceljs does not read them back). */
async function rowBreaks(bytes: Uint8Array, sheetIndex = 1): Promise<number[]> {
  const xml = await (await JSZip.loadAsync(bytes)).file(`xl/worksheets/sheet${sheetIndex}.xml`)!.async('string')
  return [...xml.matchAll(/<brk id="(\d+)"/g)].map((m) => Number(m[1]))
}

const LOGO = { bytes: PNG, extension: 'png' as const }

describe('builtInTemplates', () => {
  it('ships the starters and the report-type templates, and every one analyzes with no errors', async () => {
    const templates = await builtInTemplates()
    expect(templates.map((t) => t.key)).toEqual([
      'dimensional-inspection',
      'first-article-accountability',
      'first-article-as9102',
      'production-lot',
      'receiving-inspection',
      'reinspection',
    ])
    for (const t of templates) {
      const layout = await analyzeTemplate(t.bytes)
      expect(layout.errors, t.key).toEqual([])
      expect(layout.warnings, t.key).toEqual([])
      expect(layout.resultCount).toBeGreaterThan(0)
      expect(layout.hasVerdict).toBe(true)
      // One logo per sheet (the AS9102 workbook has three form sheets).
      expect(layout.logoAnchors?.length ?? 0, t.key).toBeGreaterThanOrEqual(1)
      expect(layout.drawingAnchor, t.key).toBeNull()
      expect(layout.entries.map((e) => e.name), t.key).toEqual(
        expect.arrayContaining(['inspected_by', 'inspection_date', 'approved_by', 'approval_date']),
      )
    }
    const fai = await analyzeTemplate(templates[1].bytes)
    expect(fai.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['serial_number', 'lot_number', 'supplier', 'inspected_by', 'approved_by']),
    )
  })

  it('label cells are wide enough for their text', async () => {
    for (const t of await builtInTemplates()) {
     for (const ws of (await readWorkbook(t.bytes)).worksheets) {
      const merges = (ws.model.merges ?? []).map(decodeRange)
      // Every column's width survives the write (exceljs drops a width of exactly 9).
      for (let c = 1; c <= ws.columnCount; c++) expect(ws.getColumn(c).width, `${t.key} column ${c}`).toBeGreaterThan(5)
      ws.eachRow((r, rowNumber) => {
        r.eachCell((cell, col) => {
          const text = cellText(cell)
          if (!text || text.includes('{{') || (cell.isMerged && cell.master.address !== cell.address)) return
          const box = merges.find((m) => m.top === rowNumber && m.left === col) ?? { left: col, right: col }
          let width = 0
          for (let c = box.left; c <= box.right; c++) width += ws.getColumn(c).width ?? 8.43
          // Excel width units are digit widths at 11 pt; bold text runs about 10 % wider.
          const factor = ((cell.font?.size ?? 11) / 11) * (cell.font?.bold ? 1.1 : 1)
          const longest = cell.alignment?.wrapText ? Math.max(...text.split(/\s+/).map((w) => w.length)) : text.length
          expect(longest * factor, `${t.key} ${ws.name} ${cell.address} "${text}"`).toBeLessThanOrEqual(width)
        })
      })
     }
    }
  })

  it('sets up printing, frozen panes, footer and conditional formats', async () => {
    for (const t of await builtInTemplates()) {
      const layout = await analyzeTemplate(t.bytes)
      const ws = (await readWorkbook(t.bytes)).getWorksheet(layout.rowTemplate!.sheet)!
      const header = layout.rowTemplate!.row - 1
      expect(ws.pageSetup).toMatchObject({
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: `${header}:${header}`,
      })
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: header })
      expect(ws.headerFooter.oddFooter).toContain('{{REPORT_NUMBER}}')
      expect(ws.headerFooter.oddFooter).toContain('Page &P of &N')
      const cfs = (ws as unknown as { conditionalFormattings: { ref: string; rules: { formulae?: string[] }[] }[] }).conditionalFormattings
      const formulae = cfs.flatMap((c) => c.rules.flatMap((r) => r.formulae ?? []))
      expect(formulae).toEqual(expect.arrayContaining(['"PASS"', '"FAIL"', 'MOD(ROW(),2)=0']))
      expect(ws.getCell(header, 1).fill).toMatchObject({ fgColor: { argb: 'FF1F3864' } })
    }
  })

  it('a starter generates with logo, summary formulas and drawing pages under the table, and reads back', async () => {
    for (const t of await builtInTemplates()) {
      const layout = await analyzeTemplate(t.bytes)
      const first = layout.rowTemplate!.row
      const rows = [row(1), row(2), row(3), row(4)]
      const bytes = await generateInspectionReport({
        template: t.bytes,
        reportId: 'rep',
        fileId: 'f',
        fileVersionId: 'v',
        rows,
        scalars: { REPORT_NUMBER: 'BR-1_RevA_IRv1', DRAWING_NAME: 'BR-1.SLDDRW' },
        logo: LOGO,
        drawingPages: [
          { png: PNG, widthPx: 3300, heightPx: 2135 },
          { png: PNG, widthPx: 3300, heightPx: 2135 },
        ],
      })
      const wb = await readWorkbook(bytes)
      const templateSheets = (await readWorkbook(t.bytes)).worksheets.map((w) => w.name)
      expect(
        wb.worksheets.map((w) => w.name),
        t.key,
      ).toEqual([...templateSheets, META_SHEET])
      expect(templateSheets.at(-1), t.key).toBe(layout.rowTemplate!.sheet)
      const ws = wb.getWorksheet(layout.rowTemplate!.sheet)!
      const placed = images(ws)
      expect(placed, t.key).toHaveLength(3)
      expect(placed[0].range.tl.nativeRow).toBe(0)
      // Summary ranges grew with the table.
      const formulas: string[] = []
      ws.eachRow((r) =>
        r.eachCell((c) => {
          const v = c.value as { formula?: string } | null
          if (v && typeof v === 'object' && typeof v.formula === 'string' && c.master.address === c.address) formulas.push(v.formula)
        }),
      )
      const last = first + rows.length - 1
      expect(formulas.filter((f) => f.includes(`$${first}:$`) && f.includes(`$${last}`)), t.key).toHaveLength(3)
      expect(ws.headerFooter.oddFooter).toContain('BR-1_RevA_IRv1')
      const cfs = (ws as unknown as { conditionalFormattings: { ref: string }[] }).conditionalFormattings.map((c) => c.ref)
      expect(cfs.some((r) => r.endsWith(`${last}`) && r.includes(`${first}:`))).toBe(true)
      // Pages start below the last table row and the sign-off, one page break before each.
      const pageRows = placed.slice(1).map((i) => i.range.tl.nativeRow + 1)
      expect(Math.min(...pageRows)).toBeGreaterThan(last + 6)
      expect(cellText(ws.getCell(pageRows[0] - 1, 1))).toBe('Drawing sheet 1 of 2: BR-1.SLDDRW')
      expect(cellText(ws.getCell(pageRows[1] - 1, 1))).toBe('Drawing sheet 2 of 2: BR-1.SLDDRW')
      expect(await rowBreaks(bytes, templateSheets.length)).toEqual(pageRows.map((r) => r - 2))
      const back = await readReturnedResults(bytes, { reportId: 'rep', rows })
      expect(back.rows).toHaveLength(4)
      expect(back.warnings).toEqual([])
    }
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
    expect(merges).toEqual(expect.arrayContaining(['B5:C5', 'B6:C6', 'B7:C7', 'B9:D9']))
    // Content below the table moved down by two rows.
    expect(cellText(ws.getCell('A9'))).toBe('Signed')
    // The whole table fits the first page, so no title row repeats over the drawing pages.
    expect(ws.pageSetup.printTitlesRow).toBeUndefined()
  })

  it('keeps the repeated header row when the table runs past the first page', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row(i + 1))
    const bytes = await generateInspectionReport({
      template: await customTemplate(),
      reportId: 'r',
      fileId: 'f',
      fileVersionId: 'v',
      rows: many,
      drawingPages: [{ png: PNG, widthPx: 1700, heightPx: 1100 }],
    })
    const ws = (await readWorkbook(bytes)).getWorksheet('Report')!
    expect(ws.pageSetup.printTitlesRow).toBe('4:4')
  })

  it('grows a row whose wrapped text needs more lines, and leaves short rows alone', async () => {
    const [t] = await builtInTemplates()
    const layout = await analyzeTemplate(t.bytes)
    const first = layout.rowTemplate!.row
    const long = 'Anodize per MIL-A-8625 Type II, Class 2, black, with masking of the bearing bore and threads'
    const bytes = await generateInspectionReport({
      template: t.bytes,
      reportId: 'r',
      fileId: 'f',
      fileVersionId: 'v',
      rows: [row(1), row(2, { char_type: 'Note', nominal_value: long, plus_tolerance: null, minus_tolerance: null })],
    })
    const ws = (await readWorkbook(bytes)).worksheets[0]
    const template = (await readWorkbook(t.bytes)).worksheets[0].getRow(first).height
    expect(ws.getRow(first).height).toBe(template)
    expect(ws.getRow(first + 1).height).toBeGreaterThan((template ?? 15) * 1.8)
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

  it('stacks every drawing page from the anchor on the same sheet, with captions and page breaks', async () => {
    const bytes = await generate()
    const wb = await readWorkbook(bytes)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Report', META_SHEET])
    const ws = wb.getWorksheet('Report')!
    const placed = images(ws)
    expect(placed).toHaveLength(2)
    // The anchor A9 moved to A11; its merge (A..F) sets the width, the first caption takes its row.
    expect(cellText(ws.getCell('A11'))).toBe('Drawing sheet 1 of 2')
    expect(placed[0].range.tl.nativeRow).toBe(11)
    expect(placed[1].range.tl.nativeRow).toBeGreaterThan(11 + Math.floor(placed[0].range.ext!.height / 20))
    for (const p of placed) expect(p.range.ext!.width).toBeLessThanOrEqual(6 * 64)
    expect(await rowBreaks(bytes)).toHaveLength(2)
  })

  it('puts the pages of a template without {{DRAWING}} under its table, never on new sheets', async () => {
    const wb = await newWorkbook()
    const ws = wb.addWorksheet('T')
    ws.getCell('A1').value = 'Balloon'
    ws.getCell('A2').value = '{{COL:balloon_number}}'
    ws.getCell('B2').value = '{{RESULT}}'
    ws.getCell('A4').value = 'Checked'
    const rows3 = [row(1), row(2), row(3)]
    const bytes = await generateInspectionReport({
      template: await writeWorkbook(wb),
      reportId: 'r',
      fileId: 'f',
      fileVersionId: 'v',
      rows: rows3,
      drawingPages: [{ png: PNG, widthPx: 1700, heightPx: 1100 }],
      drawingCaption: (i, n, name) => `Blatt ${i + 1}/${n} ${name}`,
      scalars: { DRAWING_NAME: 'X' },
    })
    const out = await readWorkbook(bytes)
    expect(out.worksheets.map((w) => w.name)).toEqual(['T', META_SHEET])
    const t = out.getWorksheet('T')!
    // "Checked" moved from row 4 to 6 (the last used row); the caption goes two rows below it.
    expect(cellText(t.getCell('A6'))).toBe('Checked')
    expect(cellText(t.getCell('A8'))).toBe('Blatt 1/1 X')
    expect(images(t)[0].range.tl.nativeRow).toBe(8)
    expect(await rowBreaks(bytes)).toEqual([7])
    // Results cells are still found after the images were placed.
    out.getWorksheet('T')!.getCell('B3').value = '25.41'
    const back = await readReturnedResults(await writeWorkbook(out), { reportId: 'r', rows: rows3 })
    expect(back.rows.map((r) => r.measured[0])).toEqual(['', '25.41', ''])
    expect(back.warnings).toEqual([])
  })

  it('places the logo in its merged range with the aspect kept, and clears the cell without one', async () => {
    const wb = await newWorkbook()
    const ws = wb.addWorksheet('L')
    ws.getColumn(1).width = 20
    ws.getColumn(2).width = 20
    ws.getRow(1).height = 30
    ws.getRow(2).height = 30
    ws.getCell('A1').value = '{{LOGO}}'
    ws.mergeCells('A1:B2')
    ws.getCell('A4').value = '{{COL:balloon_number}}'
    ws.getCell('B4').value = '{{RESULT}}'
    const template = await writeWorkbook(wb)
    const layout = await analyzeTemplate(template)
    expect(layout.logoAnchors).toEqual([{ sheet: 'L', cell: 'A1' }])
    expect(layout.warnings).toEqual([])
    // The 1x1 PNG with its header rewritten to 200 x 100.
    const wide = PNG.slice()
    new DataView(wide.buffer).setUint32(16, 200)
    new DataView(wide.buffer).setUint32(20, 100)
    const base = { template, reportId: 'r', fileId: 'f', fileVersionId: 'v', rows: [row(1)] }
    const out = await readWorkbook(await generateInspectionReport({ ...base, logo: { bytes: wide, extension: 'png' } }))
    const l = out.getWorksheet('L')!
    const [logo] = images(l)
    expect(logo.range.tl).toMatchObject({ nativeCol: 0, nativeRow: 0 })
    // Box 290 x 80 px less an 8 px inset: height-limited at 72 px, twice as wide.
    expect(logo.range.ext).toEqual({ width: 144, height: 72 })
    expect(cellText(l.getCell('A1'))).toBe('')
    const none = (await readWorkbook(await generateInspectionReport(base))).getWorksheet('L')!
    expect(images(none)).toHaveLength(0)
    expect(cellText(none.getCell('A1'))).toBe('')
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

  it('writes one merged "No characteristics" row for a report with no characteristics', async () => {
    const bytes = await generateInspectionReport({ template: await customTemplate(), reportId: 'r', fileId: 'f', fileVersionId: 'v', rows: [] })
    const ws = (await readWorkbook(bytes)).getWorksheet('Report')!
    expect(cellText(ws.getCell('A5'))).toBe('No characteristics')
    expect(ws.model.merges).toContain('A5:I5')
    expect(ws.getCell('E5').protection?.locked).not.toBe(false)
    expect(cellText(ws.getCell('A7'))).toBe('Signed')
    expect((await readReturnedResults(bytes)).rows).toEqual([])
  })

  it('fills scalar tokens in print headers and footers, escaping &', async () => {
    const wb = await readWorkbook(await customTemplate())
    wb.getWorksheet('Report')!.headerFooter = { oddFooter: '&L{{PART_NUMBER}} {{ORG_NAME}}&RPage &P' }
    const out = await readWorkbook(
      await generateInspectionReport({
        template: await writeWorkbook(wb),
        reportId: 'r',
        fileId: 'f',
        fileVersionId: 'v',
        rows,
        scalars: { PART_NUMBER: 'BR-1', ORG_NAME: 'A & B' },
      }),
    )
    expect(out.getWorksheet('Report')!.headerFooter.oddFooter).toBe('&LBR-1 A && B&RPage &P')
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

describe('shiftFormula', () => {
  it('grows ranges ending on the template row and moves references below it', () => {
    expect(shiftFormula('COUNTIF($J$11:$J$11,"PASS")', 11, 4)).toBe('COUNTIF($J$11:$J$15,"PASS")')
    expect(shiftFormula('SUM(A5:A12)+B12+B11+C3', 11, 2)).toBe('SUM(A5:A14)+B14+B11+C3')
    expect(shiftFormula('A12&"A12"', 11, 1)).toBe('A13&"A12"')
    expect(shiftFormula('LOG10(2)+Other!A20+ROW()', 11, 3)).toBe('LOG10(2)+Other!A20+ROW()')
    expect(shiftFormula('A20', 11, 0)).toBe('A20')
  })
})

describe('imageSize and rasterScale', () => {
  it('reads PNG and JPEG sizes', () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 })
    // SOI, APP0 (length 4), SOF0 with height 300 and width 640.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 300 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('renders drawing pages legible on paper and within canvas limits', () => {
    // Letter landscape (792 pt long side): at least 3300 px across.
    expect(792 * rasterScale(792, 612)).toBeGreaterThanOrEqual(3300)
    // B size (17 x 11 in): 3300 px would be 194 dpi, raised to the 200 dpi floor.
    expect(rasterScale(1224, 792) * 72).toBeCloseTo(200)
    // A0 is capped by the side limit.
    expect(3370 * rasterScale(3370, 2384)).toBeLessThanOrEqual(8000)
    expect(rasterScale(792, 612, 150)).toBeCloseTo(150 / 72)
  })
})

describe('wrappedLines', () => {
  it('wraps at word boundaries, and breaks a word longer than a line', () => {
    expect(wrappedLines('Calipers', 16)).toBe(1)
    expect(wrappedLines('11. Nonconformance number', 16)).toBe(3)
    expect(wrappedLines('Surface Roughness Tester', 17)).toBe(2)
    expect(wrappedLines('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10)).toBe(3)
    expect(wrappedLines('', 10)).toBe(1)
  })
})
