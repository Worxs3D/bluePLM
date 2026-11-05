import { describe, expect, it } from 'vitest'

import type { LineOutputState, SupplyOrder, SupplyOrderLine } from '@/types/orders'

import { csvCell, csvRow, lineOutputName, notDeviceName, orderBaseName, planOrderExport } from './exportPlan'

const NOW = new Date(2026, 0, 2, 3, 4, 5)

const order: SupplyOrder = {
  id: 'o1',
  orgId: 'org',
  sequence: 7,
  orderNumber: 'ORD-0007',
  title: 'Brackets',
  purpose: 'purchase',
  status: 'draft',
  supplierId: null,
  supplierName: 'Acme',
  dueDate: '2026-02-01',
  notes: null,
  lineCount: 3,
  createdBy: null,
  createdAt: '',
  updatedBy: null,
  updatedAt: null,
  sentBy: null,
  sentAt: null,
  receivedAt: null,
  closedAt: null,
  cancelledAt: null,
}

function line(p: Partial<SupplyOrderLine>): SupplyOrderLine {
  return {
    id: 'l',
    orderId: 'o1',
    orgId: 'org',
    position: 1,
    fileId: 'f',
    fileVersionId: 'fv',
    vaultId: 'vault',
    drawingVaultId: null,
    configuration: null,
    drawingFileId: null,
    drawingVersionId: null,
    quantity: 1,
    outputKinds: ['step'],
    notes: null,
    fileName: 'Bracket.SLDPRT',
    partNumber: 'BR-1',
    description: 'Bracket',
    revision: 'A',
    version: 2,
    drawingFileName: null,
    drawingVersion: null,
    sentOutputs: null,
    missingKinds: null,
    addedBy: null,
    addedAt: '',
    updatedAt: null,
    ...p,
  }
}

const ready = (kind: LineOutputState['kind'], hash: string, size = 10): LineOutputState => ({
  kind,
  status: 'ready',
  included: true,
  output: { storageHash: hash, fileSize: size, fileName: null },
})

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12)).toBe('12')
  })

  it('keeps a spreadsheet from running text as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tx')).toBe("'\tx")
    // Numbers are numbers.
    expect(csvCell(-3)).toBe('-3')
  })

  it('joins a row', () => {
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"')
  })
})

describe('lineOutputName', () => {
  const pattern = '{partNumber}_Rev{revision}'
  it('names outputs by the org pattern and a drawing export after the drawing', () => {
    const l = line({ drawingVersionId: 'dv', drawingFileName: 'Bracket Drawing.SLDDRW', configuration: 'Long' })
    expect(lineOutputName(l, 'step', pattern)).toBe('BR-1_RevA.step')
    expect(lineOutputName(l, 'pdf', '{filename}')).toBe('Bracket Drawing.pdf')
    expect(lineOutputName(l, 'stl', '{filename}_{config}')).toBe('Bracket_Long.stl')
    // IGES has no configuration.
    expect(lineOutputName(l, 'iges', '{filename}_{config}')).toBe('Bracket.igs')
  })

  it('keeps the source file\'s own name', () => {
    expect(lineOutputName(line({ fileName: 'sub/Bracket.SLDPRT' }), 'source', pattern)).toBe('Bracket.sldprt')
  })
})

describe('planOrderExport', () => {
  it('writes shared content once and gives a different file under a taken name a number', () => {
    const lines = [
      line({ id: 'a', position: 1, outputKinds: ['step', 'pdf'], drawingVersionId: 'dv', drawingFileName: 'Shared.SLDDRW' }),
      line({ id: 'b', position: 2, fileId: 'g', outputKinds: ['pdf'], drawingVersionId: 'dv', drawingFileName: 'Shared.SLDDRW' }),
      // Same part number and revision, different content.
      line({ id: 'c', position: 3, fileId: 'h', outputKinds: ['step'] }),
    ]
    const states = new Map<string, LineOutputState[]>([
      ['a', [ready('step', 'h-step-a'), ready('pdf', 'h-pdf')]],
      ['b', [ready('pdf', 'h-pdf')]],
      ['c', [ready('step', 'h-step-c')]],
    ])
    const plan = planOrderExport(order, lines, states, '{partNumber}_Rev{revision}', NOW)
    expect(plan.entries).toEqual([
      { zipPath: 'BR-1_RevA.step', storageHash: 'h-step-a', fileSize: 10 },
      { zipPath: 'BR-1_RevA.pdf', storageHash: 'h-pdf', fileSize: 10 },
      { zipPath: 'BR-1_RevA (2).step', storageHash: 'h-step-c', fileSize: 10 },
    ])
    expect(plan.baseName).toBe('ORD-0007')
    expect(plan.csv.name).toBe('ORD-0007.csv')
    expect(plan.missing).toEqual([])
  })

  it('lists missing kinds and writes the CSV and order.json', () => {
    const lines = [
      line({ id: 'a', outputKinds: ['step', 'pdf'], description: '=cmd|calc', quantity: 4, configuration: 'Long' }),
    ]
    const states = new Map<string, LineOutputState[]>([
      ['a', [ready('step', 'h1', 5), { kind: 'pdf', status: 'unsupported', included: true }]],
    ])
    const plan = planOrderExport(order, lines, states, '{filename}', NOW)
    expect(plan.missing).toEqual([{ lineId: 'a', kinds: ['pdf'] }])
    expect(plan.csv.content).toBe(
      '\uFEFFline,part_number,description,revision,version,configuration,quantity,files\r\n' +
        "1,BR-1,'=cmd|calc,A,2,Long,4,Bracket.step\r\n",
    )
    const json = JSON.parse(plan.json.content)
    expect(json.format).toBe('blueplm-order/1')
    expect(json.exported_at).toBe(NOW.toISOString())
    expect(json.order).toMatchObject({ order_number: 'ORD-0007', supplier_name: 'Acme' })
    expect(json.lines[0]).toMatchObject({
      line: 1,
      quantity: 4,
      files: [{ kind: 'step', name: 'Bracket.step', sha256: 'h1', size: 5 }],
      missing_kinds: ['pdf'],
    })
  })

  it('never names an output order.json or the CSV', () => {
    const plan = planOrderExport(
      { ...order, orderNumber: 'Bracket' },
      [line({ id: 'a', outputKinds: ['source'], fileName: 'Bracket.csv' })],
      new Map([['a', [ready('source', 'h')]]]),
      '{filename}',
      NOW,
    )
    expect(plan.entries.map((e) => e.zipPath)).toEqual(['Bracket (2).csv'])
  })

  it('never hands out a Windows device name', () => {
    expect(notDeviceName('CON.step')).toBe('CON_.step')
    expect(notDeviceName('nul')).toBe('nul_')
    expect(notDeviceName('Com1.tar.gz')).toBe('Com1_.tar.gz')
    expect(notDeviceName('LPT9.pdf')).toBe('LPT9_.pdf')
    expect(notDeviceName('CONSOLE.step')).toBe('CONSOLE.step')
    expect(notDeviceName('BR-CON.step')).toBe('BR-CON.step')
    expect(lineOutputName(line({ partNumber: 'AUX' }), 'step', '{partNumber}')).toBe('AUX_.step')
    expect(lineOutputName(line({ fileName: 'PRN.SLDPRT' }), 'source', '{filename}')).toBe('PRN_.sldprt')
    expect(orderBaseName({ orderNumber: 'CON' })).toBe('CON_')
  })

  it('gives an order without a number a base name', () => {
    expect(orderBaseName({ orderNumber: '  ' })).toBe('order')
    expect(orderBaseName({ orderNumber: 'ORD/1' })).toBe('ORD_1')
  })
})
