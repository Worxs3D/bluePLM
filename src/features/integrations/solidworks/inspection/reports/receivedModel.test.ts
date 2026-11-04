import { describe, expect, it } from 'vitest'

import { NO_REPORT_TYPE_FIELDS, type InspectionReport } from '@/types/inspectionReports'

import {
  drawingsInScope,
  filterReceived,
  folderOf,
  generatedStatus,
  NO_RECEIVED_FILTER,
  receivedCounts,
  receivedReports,
  receivedStatus,
  receivedSuppliers,
} from './receivedModel'
import {
  isReportReleased,
  mayDeleteReport,
  overwriteFallback,
  overwriteKeepsLayout,
  regenerateMenu,
} from './regenerateModel'

function report(id: string, over: Partial<InspectionReport> = {}): InspectionReport {
  return {
    ...NO_REPORT_TYPE_FIELDS,
    reportType: 'production',
    id,
    orgId: 'org',
    fileId: 'f1',
    fileVersionId: 'v1',
    templateId: null,
    templateName: 'Built-in',
    templateHash: null,
    reportNumber: id.toUpperCase(),
    sequence: 1,
    title: null,
    status: 'issued',
    storageHash: 'h',
    fileSize: 1,
    characteristicCount: 1,
    drawingPdfHash: null,
    returnedHash: null,
    returnedAt: null,
    returnedBy: null,
    results: null,
    resultsSummary: null,
    notes: null,
    createdBy: 'u',
    createdAt: '2026-01-01T00:00:00Z',
    updatedBy: null,
    updatedAt: '2026-01-01T00:00:00Z',
    supersedesReportId: null,
    workingCopy: false,
    ...over,
  }
}

describe('receivedReports', () => {
  it('keeps only returned reports, newest return first, superseded ones included', () => {
    const a = report('a', { returnedHash: 'r', returnedAt: '2026-02-01T00:00:00Z', status: 'returned' })
    const b = report('b', { returnedHash: 'r', returnedAt: '2026-03-01T00:00:00Z', status: 'accepted' })
    const c = report('c', { supersedesReportId: 'a' })
    const d = report('d')
    expect(receivedReports([a, b, c, d]).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('falls back to updatedAt without a return date and is stable', () => {
    const a = report('a', { returnedHash: 'r', updatedAt: '2026-05-01T00:00:00Z' })
    const b = report('b', { returnedHash: 'r', returnedAt: '2026-04-01T00:00:00Z' })
    const c = report('c', { returnedHash: 'r', returnedAt: '2026-04-01T00:00:00Z' })
    expect(receivedReports([b, c, a]).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('statuses', () => {
  it('maps a received report to returned / accepted / rejected', () => {
    expect(receivedStatus('returned')).toBe('returned')
    expect(receivedStatus('accepted')).toBe('accepted')
    expect(receivedStatus('rejected')).toBe('rejected')
    expect(receivedStatus('sent')).toBe('returned')
  })

  it('shows a generated report as issued or sent', () => {
    expect(generatedStatus('issued')).toBe('issued')
    expect(generatedStatus('sent')).toBe('sent')
    expect(generatedStatus('accepted')).toBe('sent')
  })

  it('counts per status', () => {
    expect(receivedCounts([report('a', { status: 'returned' }), report('b', { status: 'accepted' })])).toEqual({
      returned: 1,
      accepted: 1,
      rejected: 0,
    })
  })
})

describe('filterReceived', () => {
  const list = [
    report('a', { status: 'returned', supplierName: 'Acme Machining', poNumber: 'PO-100', lotNumber: 'L1' }),
    report('b', { status: 'accepted', supplierName: 'Beta Parts', poNumber: 'PO-200', lotNumber: 'L2' }),
    report('c', { status: 'rejected', supplierName: null, poNumber: null, lotNumber: null }),
  ]

  it('passes everything with no filter', () => {
    expect(filterReceived(list, NO_RECEIVED_FILTER)).toHaveLength(3)
  })

  it('filters by status and by case-insensitive substrings', () => {
    expect(filterReceived(list, { ...NO_RECEIVED_FILTER, status: 'accepted' }).map((r) => r.id)).toEqual(['b'])
    expect(filterReceived(list, { ...NO_RECEIVED_FILTER, supplier: 'acme' }).map((r) => r.id)).toEqual(['a'])
    expect(filterReceived(list, { ...NO_RECEIVED_FILTER, po: '200' }).map((r) => r.id)).toEqual(['b'])
    expect(filterReceived(list, { ...NO_RECEIVED_FILTER, lot: ' l1 ' }).map((r) => r.id)).toEqual(['a'])
    expect(filterReceived(list, { ...NO_RECEIVED_FILTER, lot: 'x' })).toEqual([])
  })

  it('lists distinct suppliers', () => {
    expect(receivedSuppliers([...list, report('d', { supplierName: ' Acme Machining ' })])).toEqual([
      'Acme Machining',
      'Beta Parts',
    ])
  })
})

describe('drawingsInScope', () => {
  const f = (relativePath: string, extension = '.SLDDRW', id: string | null = relativePath) => ({
    relativePath,
    extension,
    isDirectory: false,
    pdmData: id ? { id } : undefined,
  })
  const files = [f('A/x.SLDDRW'), f('A/B/y.slddrw'), f('A/z.SLDPRT', '.SLDPRT'), f('A/local.slddrw', '.slddrw', null), f('top.slddrw')]

  it('takes checked-in drawings of one folder', () => {
    expect(drawingsInScope(files, 'A').map((x) => x.relativePath)).toEqual(['A/x.SLDDRW'])
    expect(drawingsInScope(files, '').map((x) => x.relativePath)).toEqual(['top.slddrw'])
  })

  it('takes every checked-in drawing of the vault', () => {
    expect(drawingsInScope(files, null)).toHaveLength(3)
  })

  it('finds a file folder', () => {
    expect(folderOf('A\\B\\y.slddrw')).toBe('A/B')
    expect(folderOf('top.slddrw')).toBe('')
  })
})

describe('regenerateMenu', () => {
  const base = { released: new Set<string>(), reportVersion: 2, latestVersion: 2, canEdit: true }

  it('offers overwrite for an up-to-date report, and no "for version"', () => {
    expect(regenerateMenu({ ...base, report: report('a') })).toEqual({
      overwrite: true,
      forVersion: null,
      asCopy: true,
      frozen: false,
    })
  })

  it('offers both when the drawing has a newer version', () => {
    const menu = regenerateMenu({ ...base, latestVersion: 3, report: report('a') })
    expect(menu.overwrite).toBe(true)
    expect(menu.forVersion).toBe(3)
  })

  it('hides overwrite for a released version, a returned report and a report from before types', () => {
    expect(regenerateMenu({ ...base, released: new Set(['v1']), report: report('a') })).toMatchObject({
      overwrite: false,
      frozen: true,
    })
    expect(regenerateMenu({ ...base, report: report('a', { returnedHash: 'r' }) }).overwrite).toBe(false)
    expect(regenerateMenu({ ...base, report: report('a', { reportType: null }) }).overwrite).toBe(false)
  })

  it('offers nothing to a reader', () => {
    expect(regenerateMenu({ ...base, latestVersion: 3, canEdit: false, report: report('a') })).toEqual({
      overwrite: false,
      forVersion: null,
      asCopy: false,
      frozen: false,
    })
  })

  it('hides delete for a released version', () => {
    expect(isReportReleased(report('a'), new Set(['v1']))).toBe(true)
    expect(mayDeleteReport(true, true)).toBe(false)
    expect(mayDeleteReport(true, false)).toBe(true)
    expect(mayDeleteReport(false, false)).toBe(false)
  })

  it('maps overwrite refusals', () => {
    expect(overwriteFallback('RELEASED')).toBe('frozen')
    expect(overwriteFallback('HAS_RETURN')).toBe('supersede')
    expect(overwriteFallback('NO_EDIT_PERMISSION')).toBe('fail')
    expect(overwriteFallback('NOT_FOUND')).toBe('fail')
  })

  it('keeps a lot layout or asks for a new report', () => {
    expect(overwriteKeepsLayout(null, 10)).toBe(true)
    expect(overwriteKeepsLayout(5, 5)).toBe(true)
    expect(overwriteKeepsLayout(5, 10)).toBe(false)
  })
})
