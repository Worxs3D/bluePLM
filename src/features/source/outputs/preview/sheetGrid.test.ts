import { beforeAll, describe, expect, it } from 'vitest'

import { newWorkbook, readWorkbook, writeWorkbook } from '@/lib/inspection/excel/workbook'

import { cssColor, formatDate, formatNumber, isVisibleSheet, joinEdges, sheetToGrid, type GridEdge } from './sheetGrid'

/** A sheet written and read back, as a stored workbook arrives. */
async function roundTrip(build: (ws: import('exceljs').Worksheet, wb: import('exceljs').Workbook) => void) {
  const wb = await newWorkbook()
  const ws = wb.addWorksheet('Report')
  build(ws, wb)
  const back = await readWorkbook(await writeWorkbook(wb))
  return { wb: back, ws: back.getWorksheet('Report')! }
}

// exceljs loads lazily on first use; under a full-suite run that import alone can outlast the
// first test's 5 s budget. Load it once here, so every test measures only its own work.
beforeAll(async () => {
  await readWorkbook(await writeWorkbook(await newWorkbook()))
}, 60_000)

describe('sheetToGrid', () => {
  it('lays out columns and rows in px and spans merges from their master', async () => {
    const { ws } = await roundTrip((s) => {
      s.getColumn(1).width = 10
      s.getColumn(2).width = 20
      s.getRow(1).height = 30
      s.mergeCells('A1:B2')
      s.getCell('A1').value = 'Title'
      s.getCell('C3').value = 3.5
    })
    const grid = sheetToGrid(ws)
    expect(grid.colWidths.slice(0, 2)).toEqual([75, 145])
    expect(grid.rowHeights[0]).toBe(40)
    const title = grid.cells.find((c) => c.text === 'Title')!
    expect(title).toMatchObject({ row: 1, col: 1, left: 0, top: 0, width: 220, height: 40 + grid.rowHeights[1] })
    const number = grid.cells.find((c) => c.row === 3 && c.col === 3)!
    expect(number.text).toBe('3.5')
    expect(number.horizontal).toBe('right')
    // No cell for the covered part of the merge.
    expect(grid.cells.filter((c) => c.row <= 2 && c.col <= 2)).toHaveLength(1)
  })

  it('carries fills, fonts, alignment and number formats', async () => {
    const { ws } = await roundTrip((s) => {
      const a = s.getCell('A1')
      a.value = 0.125
      a.numFmt = '0.0%'
      a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }
      a.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Arial' }
      a.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      s.getCell('B1').value = 1234.5
      s.getCell('B1').numFmt = '#,##0.00'
    })
    const grid = sheetToGrid(ws)
    const a = grid.cells.find((c) => c.col === 1)!
    expect(a).toMatchObject({
      text: '12.5%',
      background: '#1f4e79',
      color: '#ffffff',
      bold: true,
      horizontal: 'center',
      vertical: 'middle',
      wrap: true,
    })
    expect(a.fontSize).toBeCloseTo((14 * 96) / 72)
    expect(a.fontFamily.startsWith('Arial')).toBe(true)
    expect(grid.cells.find((c) => c.col === 2)!.text).toBe('1,234.50')
  })

  it('draws a shared edge once with the heavier style, and only the perimeter of a merge', async () => {
    const { ws } = await roundTrip((s) => {
      s.getCell('A1').border = { right: { style: 'thin' } }
      s.getCell('B1').border = { left: { style: 'thick', color: { argb: 'FFFF0000' } } }
      s.mergeCells('A3:B3')
      for (const ref of ['A3', 'B3']) {
        s.getCell(ref).border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        }
      }
      s.getCell('A3').value = 'x'
    })
    const grid = sheetToGrid(ws)
    const shared = grid.edges.filter((e) => e.orientation === 'v' && e.top === 0 && e.left === grid.colWidths[0])
    expect(shared).toHaveLength(1)
    expect(shared[0]).toMatchObject({ thickness: 3, color: '#ff0000' })
    const row3Top = grid.rowHeights[0] + grid.rowHeights[1]
    const inside = grid.edges.filter((e) => e.orientation === 'v' && e.top === row3Top && e.left === grid.colWidths[0])
    expect(inside).toHaveLength(0)
    // The merge's top edge is one joined segment across both columns.
    const top = grid.edges.filter((e) => e.orientation === 'h' && e.top === row3Top)
    expect(top).toEqual([expect.objectContaining({ left: 0, length: grid.colWidths[0] + grid.colWidths[1] })])
  })

  it('lets unwrapped text run over empty cells to its right, and not over filled ones', async () => {
    const { ws } = await roundTrip((s) => {
      s.getCell('A1').value = 'A long heading that overflows'
      s.getCell('A2').value = 'Stops'
      s.getCell('C2').value = 'here'
    })
    const grid = sheetToGrid(ws)
    const a1 = grid.cells.find((c) => c.row === 1 && c.col === 1)!
    expect(a1.textWidth).toBe(grid.width)
    const a2 = grid.cells.find((c) => c.row === 2 && c.col === 1)!
    expect(a2.textWidth).toBe(grid.colWidths[0] + grid.colWidths[1])
  })

  it('places images from their anchors and skips hidden sheets', async () => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
      (ch) => ch.charCodeAt(0),
    )
    const { wb, ws } = await roundTrip((s, book) => {
      s.getCell('A1').value = 'Logo'
      const id = book.addImage({ buffer: png.buffer as ArrayBuffer, extension: 'png' })
      s.addImage(id, { tl: { col: 1, row: 1 }, ext: { width: 120, height: 40 } })
      book.addWorksheet('_blueplm', { state: 'veryHidden' })
    })
    const grid = sheetToGrid(ws)
    expect(grid.images).toHaveLength(1)
    expect(grid.images[0]).toMatchObject({ left: grid.colWidths[0], top: grid.rowHeights[0], width: 120, height: 40 })
    expect(wb.worksheets.filter(isVisibleSheet).map((s) => s.name)).toEqual(['Report'])
  })

  it('draws gridlines unless the sheet hides them', async () => {
    const shown = sheetToGrid((await roundTrip((s) => (s.getCell('B2').value = 1))).ws)
    expect(shown.gridlines.length).toBe(shown.colWidths.length + 1 + shown.rowHeights.length + 1)
    const hidden = sheetToGrid(
      (
        await roundTrip((s) => {
          s.views = [{ showGridLines: false }]
          s.getCell('B2').value = 1
        })
      ).ws,
    )
    expect(hidden.gridlines).toEqual([])
  })
})

describe('values and colors', () => {
  it('formats numbers by their format', () => {
    expect(formatNumber(0.1 + 0.2, undefined)).toBe('0.3')
    expect(formatNumber(25.4, '0.000')).toBe('25.400')
    expect(formatNumber(0.5, '0%')).toBe('50%')
    expect(formatNumber(1234567, '#,##0')).toBe('1,234,567')
    expect(formatNumber(7, 'General')).toBe('7')
  })

  it('formats dates by the common tokens', () => {
    const d = new Date(Date.UTC(2026, 10, 3, 14, 5, 9))
    expect(formatDate(d, 'yyyy-mm-dd')).toBe('2026-11-03')
    expect(formatDate(d, 'd mmm yyyy')).toBe('3 Nov 2026')
    expect(formatDate(d, 'yyyy-mm-dd hh:mm')).toBe('2026-11-03 14:05')
    expect(formatDate(d, undefined)).toBe('2026-11-03')
  })

  it('resolves argb, theme with tint, and indexed colors', () => {
    expect(cssColor({ argb: 'FF00B050' })).toBe('#00b050')
    expect(cssColor({ theme: 1 })).toBe('#000000')
    expect(cssColor({ theme: 0, tint: -0.5 } as never)).toBe('#808080')
    expect(cssColor({ indexed: 10 } as never)).toBe('#ff0000')
    expect(cssColor(undefined)).toBeNull()
  })

  it('joins touching segments that look the same', () => {
    const e = (left: number, color = '#000000'): GridEdge => ({
      orientation: 'h',
      left,
      top: 10,
      length: 5,
      thickness: 1,
      lineStyle: 'solid',
      color,
    })
    expect(joinEdges([e(5), e(0), e(10, '#ff0000')])).toEqual([{ ...e(0), length: 10 }, e(10, '#ff0000')])
  })
})
