import { describe, expect, it } from 'vitest'

import type { InspectionReportRow, ReturnedResults } from '@/lib/inspection/excel'
import type { InspectionReport, InspectionTemplate } from '@/types/inspectionReports'

import {
  canDeleteReport,
  defaultTemplateChoice,
  groupReportsByVersion,
  importVerdict,
  nextReportNumber,
  parseStoredResults,
  reportActions,
  reportFileName,
  safeFileName,
  statusTone,
  storedResultsJson,
  summarizeStored,
  templateChoiceId,
  templateChoices,
  toStoredResults,
  type VersionInfo,
} from './reportModel'

function report(over: Partial<InspectionReport>): InspectionReport {
  return {
    id: 'r1',
    orgId: 'o',
    fileId: 'f',
    fileVersionId: 'v1',
    templateId: null,
    templateName: null,
    templateHash: null,
    reportNumber: null,
    title: null,
    status: 'issued',
    storageHash: 'a'.repeat(64),
    fileSize: 1,
    characteristicCount: 0,
    drawingPdfHash: null,
    returnedHash: null,
    returnedAt: null,
    returnedBy: null,
    results: null,
    resultsSummary: null,
    notes: null,
    createdBy: 'u1',
    createdAt: '2026-11-01T10:00:00Z',
    updatedBy: null,
    updatedAt: '2026-11-01T10:00:00Z',
    ...over,
  }
}

function version(id: string, n: number, revision: string | null = null): VersionInfo {
  return { id, version: n, revision, partNumber: null, description: null, createdAt: null }
}

function template(over: Partial<InspectionTemplate>): InspectionTemplate {
  return {
    id: 't',
    orgId: 'o',
    name: 'T',
    description: null,
    storageHash: 'b'.repeat(64),
    fileSize: 1,
    originalFilename: null,
    revision: 1,
    isDefault: false,
    layout: {},
    archivedAt: null,
    createdBy: null,
    createdAt: '',
    updatedBy: null,
    updatedAt: '',
    ...over,
  }
}

function row(id: string, balloon: string, over: Partial<InspectionReportRow> = {}): InspectionReportRow {
  return {
    id,
    sort_order: 0,
    balloon_number: balloon,
    char_id: null,
    zone: null,
    char_type: null,
    sub_type: null,
    nominal_value: '10.00',
    unit: null,
    plus_tolerance: '0.1',
    minus_tolerance: '0.1',
    upper_limit: null,
    lower_limit: null,
    classification: null,
    inspection_method: null,
    operation: null,
    aql: null,
    sample_size: null,
    supplier_inspection_rate: null,
    internal_inspection_rate: null,
    reference: null,
    comments: null,
    source_key: `k${id}`,
    source_sheet: null,
    source_view: null,
    tolerance_source: null,
    ...over,
  }
}

describe('nextReportNumber', () => {
  it('starts at IR1 with part and revision', () => {
    expect(nextReportNumber('BRK-100', 'B', 'BRK-100.SLDDRW', [])).toBe('BRK-100-B-IR1')
  })

  it('continues after the highest number of any revision', () => {
    expect(nextReportNumber('BRK-100', 'C', 'x', ['BRK-100-A-IR1', 'BRK-100-B-IR4', null, 'custom'])).toBe(
      'BRK-100-C-IR5',
    )
  })

  it('falls back to the drawing name and omits a missing revision', () => {
    expect(nextReportNumber(null, '', 'Bracket plate.SLDDRW', [])).toBe('Bracket_plate-IR1')
  })

  it('replaces characters a file name cannot hold', () => {
    expect(nextReportNumber('A/B:C', 'r 1', 'x', [])).toBe('A_B_C-r_1-IR1')
  })
})

describe('groupReportsByVersion', () => {
  it('groups by version, newest version and newest report first', () => {
    const reports = [
      report({ id: 'a', fileVersionId: 'v1', createdAt: '2026-01-01T00:00:00Z' }),
      report({ id: 'b', fileVersionId: 'v2', createdAt: '2026-01-02T00:00:00Z' }),
      report({ id: 'c', fileVersionId: 'v1', createdAt: '2026-01-03T00:00:00Z' }),
      report({ id: 'd', fileVersionId: 'gone', createdAt: '2026-01-04T00:00:00Z' }),
    ]
    const groups = groupReportsByVersion(reports, [version('v1', 1), version('v2', 2, 'B')])
    expect(groups.map((g) => [g.fileVersionId, g.version, g.revision])).toEqual([
      ['v2', 2, 'B'],
      ['v1', 1, null],
      ['gone', null, null],
    ])
    expect(groups[1].reports.map((r) => r.id)).toEqual(['c', 'a'])
  })
})

describe('status and permissions', () => {
  it('gives every status a tone', () => {
    expect(statusTone('accepted')).toBe('success')
    expect(statusTone('rejected')).toBe('error')
    expect(statusTone('returned')).toBe('warning')
  })

  it('lets the creator or an admin delete', () => {
    expect(canDeleteReport({ createdBy: 'u1' }, 'u1', false)).toBe(true)
    expect(canDeleteReport({ createdBy: 'u1' }, 'u2', false)).toBe(false)
    expect(canDeleteReport({ createdBy: 'u1' }, 'u2', true)).toBe(true)
    expect(canDeleteReport({ createdBy: null }, undefined, false)).toBe(false)
  })

  it('offers the status actions that fit', () => {
    expect(reportActions('issued')).toEqual({ markSent: true, importResults: true, accept: false, reject: false })
    expect(reportActions('returned')).toEqual({ markSent: false, importResults: true, accept: true, reject: true })
    expect(reportActions('accepted')).toEqual({ markSent: false, importResults: false, accept: false, reject: true })
  })
})

describe('file names', () => {
  it('sanitises and adds .xlsx', () => {
    expect(safeFileName('a/b:c*?.xlsx')).toBe('a_b_c_.xlsx')
    expect(safeFileName('   ')).toBe('inspection-report')
    expect(reportFileName({ reportNumber: 'P-A-IR2', title: 't' })).toBe('P-A-IR2.xlsx')
    expect(reportFileName({ reportNumber: null, title: null }, true)).toBe('inspection-report-returned.xlsx')
  })
})

describe('template choices', () => {
  const builtIns = [{ key: 'dimensional-inspection', name: 'Dimensional' }]

  it('lists live org templates (default first), then built-ins', () => {
    const choices = templateChoices(
      [
        template({ id: 'b', name: 'B' }),
        template({ id: 'a', name: 'A', archivedAt: '2026-01-01' }),
        template({ id: 'd', name: 'Z', isDefault: true }),
      ],
      builtIns,
    )
    expect(choices.map(templateChoiceId)).toEqual(['org:d', 'org:b', 'builtin:dimensional-inspection'])
    expect(templateChoiceId(defaultTemplateChoice(choices)!)).toBe('org:d')
  })

  it('preselects the first org template, else the first built-in', () => {
    expect(templateChoiceId(defaultTemplateChoice(templateChoices([template({ id: 'x' })], builtIns))!)).toBe('org:x')
    expect(templateChoiceId(defaultTemplateChoice(templateChoices([], builtIns))!)).toBe(
      'builtin:dimensional-inspection',
    )
    expect(defaultTemplateChoice([])).toBeNull()
  })
})

describe('stored results', () => {
  const expected = [row('1', '1'), row('2', '2'), row('3', '10')]
  const returned: ReturnedResults = {
    reportId: 'r1',
    fileId: 'f',
    fileVersionId: 'v1',
    templateHash: null,
    entries: { serial: 'SN-1' },
    rows: [
      {
        rowId: '3',
        sourceKey: 'k3',
        balloon: '10',
        measured: ['10.05'],
        inputs: {},
        enteredVerdictText: '',
        enteredVerdict: null,
        computedVerdict: 'pass',
        verdict: 'pass',
        verdictConflict: false,
        tampered: false,
        tamperReasons: [],
      },
      {
        rowId: '1',
        sourceKey: 'k1',
        balloon: '1',
        measured: ['10.5'],
        inputs: { tool: 'caliper' },
        enteredVerdictText: 'PASS',
        enteredVerdict: 'pass',
        computedVerdict: 'fail',
        verdict: 'fail',
        verdictConflict: true,
        tampered: true,
        tamperReasons: ['cells'],
      },
      {
        rowId: 'x',
        sourceKey: null,
        balloon: '99',
        measured: [''],
        inputs: {},
        enteredVerdictText: '',
        enteredVerdict: null,
        computedVerdict: null,
        verdict: null,
        verdictConflict: false,
        tampered: false,
        tamperReasons: [],
      },
    ],
    summary: { total: 3, pass: 1, fail: 1, blank: 1 },
    warnings: [{ code: 'UNKNOWN_ROW' }, { code: 'MISSING_ROW' }, { code: 'UNKNOWN_ROW' }],
  }

  it('matches rows to the version, sorts by balloon and lists missing ones', () => {
    const stored = toStoredResults(returned, expected)
    expect(stored.rows.map((r) => r.balloon)).toEqual(['1', '10', '99'])
    expect(stored.rows[0]).toMatchObject({ tampered: true, verdictConflict: true, unknown: false, verdict: 'fail' })
    expect(stored.rows[0].requirement).toContain('10.00')
    expect(stored.rows[2].unknown).toBe(true)
    expect(stored.missing).toEqual(['2'])
    expect(stored.warnings).toEqual(['UNKNOWN_ROW', 'MISSING_ROW'])
    expect(summarizeStored(stored)).toEqual({ total: 3, pass: 1, fail: 1, blank: 1 })
  })

  it('round-trips through the database column', () => {
    const stored = toStoredResults(returned, expected)
    expect(parseStoredResults(storedResultsJson(stored))).toEqual(stored)
    expect(parseStoredResults(null)).toBeNull()
    expect(parseStoredResults({ format: 'other', rows: [] })).toBeNull()
  })
})

describe('importVerdict', () => {
  const own = { id: 'r1', fileId: 'f', fileVersionId: 'v1' }
  const parsed = (over: Partial<Pick<ReturnedResults, 'reportId' | 'fileId' | 'fileVersionId' | 'warnings'>>) => ({
    reportId: 'r1',
    fileId: 'f',
    fileVersionId: 'v1',
    warnings: [],
    ...over,
  })

  it('allows the report’s own workbook', () => {
    expect(importVerdict(own, parsed({}))).toEqual({ blocked: false, reason: null, reportIdMismatch: false })
  })

  it('allows another report of the same version, flagged', () => {
    expect(importVerdict(own, parsed({ reportId: 'r2', warnings: [{ code: 'REPORT_ID_MISMATCH' }] }))).toEqual({
      blocked: false,
      reason: null,
      reportIdMismatch: true,
    })
  })

  it('blocks a workbook of another version or drawing', () => {
    expect(importVerdict(own, parsed({ reportId: 'r9', fileVersionId: 'v2' })).reason).toBe('other_version')
    expect(importVerdict(own, parsed({ fileId: 'g' })).blocked).toBe(true)
    expect(importVerdict(own, parsed({ fileVersionId: null })).blocked).toBe(true)
  })

  it('blocks a workbook that is not a readable report', () => {
    expect(importVerdict(own, parsed({ warnings: [{ code: 'NOT_A_REPORT' }] })).reason).toBe('not_a_report')
  })
})
