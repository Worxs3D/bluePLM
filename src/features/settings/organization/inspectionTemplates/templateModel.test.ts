import { describe, expect, it } from 'vitest'

import { ROW_FIELDS, SCALAR_NAMES, type TemplateLayout } from '@/lib/inspection/excel'
import type { Json } from '@/types/supabase'

import { analysisStatus, layoutSummary, nameFromFileName, parseLayout, tokenReference } from './templateModel'

const layout: TemplateLayout = {
  version: 1,
  sheets: [{ name: 'Inspection', state: 'visible', rowCount: 20, columnCount: 8 }],
  rowTemplate: {
    sheet: 'Inspection',
    row: 8,
    legacyHeaderRow: null,
    cells: [
      { col: 1, cell: 'A8', kind: 'field', fields: ['balloon_number'] },
      { col: 2, cell: 'B8', kind: 'field', fields: ['nominal_value', 'tolerance'] },
      { col: 3, cell: 'C8', kind: 'field', fields: ['balloon_number'] },
      { col: 4, cell: 'D8', kind: 'result', index: 1 },
      { col: 5, cell: 'E8', kind: 'verdict' },
      { col: 6, cell: 'F8', kind: 'input', name: 'tool' },
    ],
    printTitleRows: null,
  },
  scalars: [{ sheet: 'Inspection', cell: 'B2', tokens: ['PART_NUMBER'] }],
  entries: [{ sheet: 'Inspection', cell: 'F2', name: 'serial' }],
  properties: ['Material'],
  resultCount: 1,
  hasVerdict: true,
  drawingAnchor: null,
  errors: [],
  warnings: [{ code: 'UNKNOWN_TOKEN', token: '{{FOO}}' }],
}

describe('templateModel', () => {
  it('reads a stored layout back and rejects anything else', () => {
    expect(parseLayout(layout as unknown as Json)).toEqual(layout)
    expect(parseLayout({})).toBeNull()
    expect(parseLayout(null)).toBeNull()
    expect(parseLayout({ version: 2, errors: [], warnings: [], sheets: [] })).toBeNull()
  })

  it('summarises the layout', () => {
    expect(layoutSummary(layout)).toEqual({
      tableAt: 'Inspection!8',
      fields: ['balloon_number', 'nominal_value', 'tolerance'],
      resultCount: 1,
      hasVerdict: true,
      inputs: ['tool'],
      entries: ['serial'],
      properties: ['Material'],
      drawingAt: null,
      scalarCount: 1,
    })
  })

  it('derives the analysis status', () => {
    expect(analysisStatus(null)).toBe('unknown')
    expect(analysisStatus(layout)).toBe('warnings')
    expect(analysisStatus({ ...layout, warnings: [] })).toBe('ready')
    expect(analysisStatus({ ...layout, errors: [{ code: 'NO_ROW_TEMPLATE' }] })).toBe('errors')
  })

  it('names a template after its file', () => {
    expect(nameFromFileName('Bracket FAI.xlsx')).toBe('Bracket FAI')
  })

  it('lists every scalar and row field the engine supports', () => {
    const tokens = tokenReference().flatMap((g) => g.entries.map((e) => e.token))
    for (const name of SCALAR_NAMES) expect(tokens).toContain(`{{${name}}}`)
    for (const field of ROW_FIELDS) expect(tokens).toContain(`{{COL:${field}}}`)
    for (const special of ['{{DRAWING}}', '{{VERDICT}}', '{{ENTRY:<name>}}', '{{INPUT:<name>}}', '{{PROP:<name>}}']) {
      expect(tokens).toContain(special)
    }
  })
})
