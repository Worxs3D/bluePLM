import { describe, expect, it } from 'vitest'

import type { InspectionReportRow, ReturnedResults } from '@/lib/inspection/excel'
import {
  NO_REPORT_TYPE_FIELDS,
  type InspectionReport,
  type InspectionTemplate,
} from '@/types/inspectionReports'

import {
  nextReportStep,
  canDeleteReport,
  DEFAULT_REPORT_NUMBER_PATTERN,
  defaultTemplateChoice,
  formatReportNumber,
  groupReportsByVersion,
  hasChangesNotCheckedIn,
  importVerdict,
  newerVersionThan,
  nextReportName,
  nextReportSequence,
  parseStoredResults,
  pathNextTo,
  patternHasSequence,
  patternHasType,
  regenerateTemplateChoice,
  reportNamingFromSettings,
  reportNumberValues,
  reportSequence,
  resolveReportIdentity,
  unknownPatternTokens,
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
    sequence: null,
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
    supersedesReportId: null,
    workingCopy: false,
    ...NO_REPORT_TYPE_FIELDS,
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
    reportTypes: [],
    defaultFor: [],
    layout: {},
    archivedAt: null,
    createdBy: null,
    createdAt: '',
    updatedBy: null,
    updatedAt: '',
    ...over,
  }
}

function row(
  id: string,
  balloon: string,
  over: Partial<InspectionReportRow> = {},
): InspectionReportRow {
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

/** 5.6.0's default: a counter per type. */
const COUNTED = '{partNumber}_Rev{rev}_{type}{n}'
const VALUES = {
  partNumber: 'BR-103849-201',
  rev: 'A',
  version: '3',
  drawing: 'BR-103849-201',
  type: 'PIR',
  date: '2026-11-03',
}

describe('report naming settings', () => {
  it('defaults when unset or malformed', () => {
    expect(reportNamingFromSettings(undefined)).toEqual({
      numberPattern: DEFAULT_REPORT_NUMBER_PATTERN,
      sequenceScope: 'drawing',
      includeLogo: true,
      lotScope: 'classified',
      defaultSampleSize: 5,
    })
    expect(
      reportNamingFromSettings({
        number_pattern: '   ',
        sequence_scope: 'x',
        include_logo: 'no',
        lot_characteristics: 'some',
        default_sample_size: 0,
      }),
    ).toEqual({
      numberPattern: DEFAULT_REPORT_NUMBER_PATTERN,
      sequenceScope: 'drawing',
      includeLogo: true,
      lotScope: 'classified',
      defaultSampleSize: 5,
    })
    expect(reportNamingFromSettings({ default_sample_size: 2.5 }).defaultSampleSize).toBe(5)
    expect(reportNamingFromSettings({ default_sample_size: 9999 }).defaultSampleSize).toBe(5)
    expect(reportNamingFromSettings([1, 2])).toMatchObject({
      numberPattern: DEFAULT_REPORT_NUMBER_PATTERN,
    })
  })

  it('keeps a stored pattern, scope and logo choice', () => {
    expect(
      reportNamingFromSettings({
        number_pattern: ' IR-{n} ',
        sequence_scope: 'revision',
        include_logo: false,
      }),
    ).toMatchObject({ numberPattern: 'IR-{n}', sequenceScope: 'revision', includeLogo: false })
    expect(
      reportNamingFromSettings({ lot_characteristics: 'all', default_sample_size: 8 }),
    ).toMatchObject({
      lotScope: 'all',
      defaultSampleSize: 8,
    })
  })

  it('caps the pattern length', () => {
    expect(
      reportNamingFromSettings({ number_pattern: 'x'.repeat(500) }).numberPattern,
    ).toHaveLength(200)
  })

  it('flags patterns without {n} and unknown tokens', () => {
    expect(patternHasSequence(DEFAULT_REPORT_NUMBER_PATTERN)).toBe(false)
    expect(patternHasSequence(COUNTED)).toBe(true)
    expect(patternHasSequence('{partNumber}_{rev}')).toBe(false)
    expect(unknownPatternTokens('{partNumber}_{foo}_{N}_{foo}_{ bar }')).toEqual(['foo', 'bar'])
  })
})

describe('formatReportNumber', () => {
  it('fills the default pattern the organization style asks for', () => {
    expect(formatReportNumber(DEFAULT_REPORT_NUMBER_PATTERN, { ...VALUES, n: '3' })).toBe(
      'BR-103849-201_RevA_PIR',
    )
    // 5.6.0's default, with a counter per type.
    expect(formatReportNumber(COUNTED, { ...VALUES, n: '3' })).toBe('BR-103849-201_RevA_PIR3')
    // 5.5.0's default, which organizations that saved it keep.
    expect(formatReportNumber('{partNumber}_Rev{rev}_IRv{n}', { ...VALUES, n: '3' })).toBe(
      'BR-103849-201_RevA_IRv3',
    )
  })

  it('fills every token, case-insensitively', () => {
    expect(
      formatReportNumber('{PartNumber}-{REV}-v{version}-{drawing}-{TYPE}-{date}-{n}', {
        ...VALUES,
        n: '7',
      }),
    ).toBe('BR-103849-201-A-v3-BR-103849-201-PIR-2026-11-03-7')
  })

  it('replaces characters a file name cannot hold and collapses empty values', () => {
    expect(
      formatReportNumber('{partNumber}_{rev}_IR{n}', {
        ...VALUES,
        partNumber: 'A/B:C d',
        rev: '',
        n: '1',
      }),
    ).toBe('A_B_C_d_IR1')
  })

  it('keeps unknown tokens as text and never returns empty', () => {
    expect(formatReportNumber('{foo}-{n}', { ...VALUES, n: '2' })).toBe('foo-2')
    expect(formatReportNumber('{rev}', { ...VALUES, rev: '', n: '4' })).toBe('4')
  })
})

describe('report sequence', () => {
  it('uses the stored sequence, else the legacy IR<n> / IRv<n> suffix', () => {
    expect(reportSequence({ reportNumber: 'whatever', sequence: 9 })).toBe(9)
    expect(reportSequence({ reportNumber: 'BRK-100-B-IR4', sequence: null })).toBe(4)
    expect(reportSequence({ reportNumber: 'BR-1_RevA_IRv12' })).toBe(12)
    expect(reportSequence({ reportNumber: 'custom', sequence: null })).toBeNull()
    expect(reportSequence({ reportNumber: null })).toBeNull()
  })

  const revisions = new Map<string, string | null>([
    ['v1', 'A'],
    ['v2', 'A'],
    ['v3', 'B'],
  ])
  const reports = [
    { reportNumber: 'X-A-IR1', fileVersionId: 'v1', sequence: null },
    { reportNumber: 'X_RevA_IRv2', fileVersionId: 'v2', sequence: 2 },
    { reportNumber: 'X_RevB_IRv1', fileVersionId: 'v3', sequence: 1 },
    { reportNumber: 'X_IRv8', fileVersionId: 'gone', sequence: 8 },
  ]

  it('counts every report of the drawing in drawing scope', () => {
    expect(nextReportSequence(reports, 'drawing', 'B', revisions)).toBe(9)
    expect(nextReportSequence([], 'drawing', 'A', revisions)).toBe(1)
  })

  it('counts per type when asked (a pattern with {type}); a report from before types is its own type', () => {
    const typed = [
      {
        reportNumber: 'X_RevA_FAIR1',
        fileVersionId: 'v1',
        sequence: 1,
        reportType: 'fai' as const,
      },
      {
        reportNumber: 'X_RevA_PIR1',
        fileVersionId: 'v2',
        sequence: 1,
        reportType: 'production' as const,
      },
      {
        reportNumber: 'X_RevA_PIR2',
        fileVersionId: 'v2',
        sequence: 2,
        reportType: 'production' as const,
      },
      { reportNumber: 'X_RevA_IRv5', fileVersionId: 'v2', sequence: 5, reportType: null },
    ]
    expect(nextReportSequence(typed, 'drawing', 'A', revisions, 'production')).toBe(3)
    expect(nextReportSequence(typed, 'drawing', 'A', revisions, 'fai')).toBe(2)
    expect(nextReportSequence(typed, 'drawing', 'A', revisions, 'receiving')).toBe(1)
    expect(nextReportSequence(typed, 'drawing', 'A', revisions, null)).toBe(6)
    // Without {type} every report counts, as before.
    expect(nextReportSequence(typed, 'drawing', 'A', revisions)).toBe(6)
    expect(patternHasType(DEFAULT_REPORT_NUMBER_PATTERN)).toBe(true)
    expect(patternHasType('{partNumber}_Rev{rev}_IRv{n}')).toBe(false)
  })

  it('restarts per revision in revision scope, leaving out reports of unknown versions', () => {
    expect(nextReportSequence(reports, 'revision', 'A', revisions)).toBe(3)
    expect(nextReportSequence(reports, 'revision', 'b', revisions)).toBe(2)
    expect(nextReportSequence(reports, 'revision', 'C', revisions)).toBe(1)
  })
})

describe('nextReportName', () => {
  it('takes the next number when the computed one is taken', () => {
    expect(
      nextReportName(COUNTED, VALUES, 3, ['BR-103849-201_RevA_PIR3', 'br-103849-201_reva_pir4']),
    ).toEqual({
      reportNumber: 'BR-103849-201_RevA_PIR5',
      sequence: 5,
    })
  })

  it('appends _2, _3 to a pattern without {n} once its plain number is taken, counted on that number', () => {
    expect(nextReportName('{partNumber}_Rev{rev}', VALUES, 1, [])).toEqual({
      reportNumber: 'BR-103849-201_RevA',
      sequence: 1,
    })
    expect(nextReportName('{partNumber}_Rev{rev}', VALUES, 2, ['BR-103849-201_RevA'])).toEqual({
      reportNumber: 'BR-103849-201_RevA_2',
      sequence: 2,
    })
    // A drawing-wide sequence of 7 does not leak into the suffix.
    expect(
      nextReportName('{partNumber}_Rev{rev}', VALUES, 7, [
        'BR-103849-201_RevA',
        'br-103849-201_reva_2',
      ]),
    ).toEqual({ reportNumber: 'BR-103849-201_RevA_3', sequence: 7 })
  })

  it('names the first report of a type and revision plainly with the default pattern', () => {
    const fai = { ...VALUES, type: 'FAIR' }
    expect(
      nextReportName(DEFAULT_REPORT_NUMBER_PATTERN, fai, 4, ['BR-103849-201_RevA_PIR']),
    ).toEqual({
      reportNumber: 'BR-103849-201_RevA_FAIR',
      sequence: 4,
    })
  })
})

describe('report identity', () => {
  it('takes each field from the first source that has it', () => {
    expect(
      resolveReportIdentity(
        { partNumber: '  ', description: null, revision: 'B' },
        { partNumber: 'BR-1', description: '', revision: 'C' },
        { partNumber: 'MODEL', description: 'Bracket', revision: 'D' },
      ),
    ).toEqual({ partNumber: 'BR-1', description: 'Bracket', revision: 'B' })
  })

  it('leaves a field blank when no source has it', () => {
    expect(resolveReportIdentity(null, undefined, {})).toEqual({
      partNumber: null,
      description: null,
      revision: null,
    })
  })

  it('numbers by the drawing name when there is no part number', () => {
    const values = reportNumberValues(
      { partNumber: null, description: null, revision: null },
      'Bracket plate.SLDDRW',
      2,
      new Date(2026, 10, 3),
    )
    expect(values).toEqual({
      partNumber: 'Bracket plate',
      rev: '',
      version: '2',
      drawing: 'Bracket plate',
      type: 'IR',
      date: '2026-11-03',
    })
    expect(formatReportNumber(DEFAULT_REPORT_NUMBER_PATTERN, { ...values, n: '1' })).toBe(
      'Bracket_plate_Rev_IR',
    )
    const fai = reportNumberValues(
      { partNumber: 'P', description: null, revision: 'B' },
      'P.SLDDRW',
      2,
      new Date(2026, 10, 3),
      'fai',
    )
    expect(formatReportNumber(DEFAULT_REPORT_NUMBER_PATTERN, { ...fai, n: '1' })).toBe(
      'P_RevB_FAIR',
    )
  })
})

describe('regenerate', () => {
  const versions = [version('v1', 1, 'A'), version('v3', 3, 'B'), version('v2', 2, 'A')]

  it('offers the latest version only when it is newer than the report', () => {
    expect(newerVersionThan(report({ fileVersionId: 'v1' }), versions)?.id).toBe('v3')
    expect(newerVersionThan(report({ fileVersionId: 'v3' }), versions)).toBeNull()
    expect(newerVersionThan(report({ fileVersionId: 'v1' }), [])).toBeNull()
  })

  it('keeps the report template when live, else a built-in of that name, else the default', () => {
    const org = template({ id: 't1', name: 'Ours' })
    const def = template({ id: 't2', name: 'Default', isDefault: true })
    const choices = templateChoices([org, def], [{ key: 'dim', name: 'Dimensional' }])
    expect(
      templateChoiceId(
        regenerateTemplateChoice({ templateId: 't1', templateName: 'Ours' }, choices)!,
      ),
    ).toBe('org:t1')
    expect(
      templateChoiceId(
        regenerateTemplateChoice({ templateId: 'gone', templateName: 'Old' }, choices)!,
      ),
    ).toBe('org:t2')
    expect(
      templateChoiceId(
        regenerateTemplateChoice({ templateId: null, templateName: 'Dimensional' }, choices)!,
      ),
    ).toBe('builtin:dim')
  })

  it('saves next to the drawing in its folder', () => {
    expect(pathNextTo('C:\\Vault\\Parts\\BRK.SLDDRW', 'BRK_RevA_IRv1.xlsx')).toBe(
      'C:\\Vault\\Parts\\BRK_RevA_IRv1.xlsx',
    )
    expect(pathNextTo('/vault/parts/BRK.SLDDRW', 'r.xlsx')).toBe('/vault/parts/r.xlsx')
  })
})

describe('changes not checked in', () => {
  it('warns only for the user who has the drawing checked out', () => {
    expect(
      hasChangesNotCheckedIn({
        checkedOutByMe: false,
        modified: true,
        liveRows: 5,
        versionRows: 0,
      }),
    ).toBe(false)
    expect(
      hasChangesNotCheckedIn({
        checkedOutByMe: true,
        modified: true,
        liveRows: null,
        versionRows: 3,
      }),
    ).toBe(true)
    expect(
      hasChangesNotCheckedIn({
        checkedOutByMe: true,
        modified: false,
        liveRows: 4,
        versionRows: 3,
      }),
    ).toBe(true)
    expect(
      hasChangesNotCheckedIn({
        checkedOutByMe: true,
        modified: false,
        liveRows: 3,
        versionRows: 3,
      }),
    ).toBe(false)
    expect(
      hasChangesNotCheckedIn({
        checkedOutByMe: true,
        modified: false,
        liveRows: null,
        versionRows: 3,
      }),
    ).toBe(false)
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
    expect(reportActions('issued')).toEqual({
      markSent: true,
      importResults: true,
      accept: false,
      reject: false,
    })
    expect(reportActions('returned')).toEqual({
      markSent: false,
      importResults: true,
      accept: true,
      reject: true,
    })
    expect(reportActions('accepted')).toEqual({
      markSent: false,
      importResults: false,
      accept: false,
      reject: true,
    })
  })
})

describe('file names', () => {
  it('sanitises and adds .xlsx', () => {
    expect(safeFileName('a/b:c*?.xlsx')).toBe('a_b_c_.xlsx')
    expect(safeFileName('   ')).toBe('inspection-report')
    expect(reportFileName({ reportNumber: 'P-A-IR2', title: 't' })).toBe('P-A-IR2.xlsx')
    expect(reportFileName({ reportNumber: null, title: null }, true)).toBe(
      'inspection-report-returned.xlsx',
    )
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
    expect(choices.map(templateChoiceId)).toEqual([
      'org:d',
      'org:b',
      'builtin:dimensional-inspection',
    ])
    expect(templateChoiceId(defaultTemplateChoice(choices)!)).toBe('org:d')
  })

  it('preselects the first org template, else the first built-in', () => {
    expect(
      templateChoiceId(defaultTemplateChoice(templateChoices([template({ id: 'x' })], builtIns))!),
    ).toBe('org:x')
    expect(templateChoiceId(defaultTemplateChoice(templateChoices([], builtIns))!)).toBe(
      'builtin:dimensional-inspection',
    )
    expect(defaultTemplateChoice([])).toBeNull()
  })

  it('preselects per type: the org default for the type, its general default, the type built-in', () => {
    const typed = [
      { key: 'dimensional-inspection', name: 'Dimensional' },
      {
        key: 'first-article-as9102',
        name: 'FAI',
        reportTypes: ['fai' as const],
        defaultFor: ['fai' as const],
      },
      {
        key: 'production-lot',
        name: 'PIR',
        reportTypes: ['production' as const],
        defaultFor: ['production' as const],
      },
    ]
    // No org templates: the type's built-in.
    expect(templateChoiceId(defaultTemplateChoice(templateChoices([], typed), 'fai')!)).toBe(
      'builtin:first-article-as9102',
    )
    // A 5.5.0 organization default (any type) keeps being used.
    const general = template({ id: 'g', isDefault: true })
    expect(
      templateChoiceId(defaultTemplateChoice(templateChoices([general], typed), 'production')!),
    ).toBe('org:g')
    // ... unless it serves other types only.
    const faiOnly = template({ id: 'g', isDefault: true, reportTypes: ['fai'] })
    expect(
      templateChoiceId(defaultTemplateChoice(templateChoices([faiOnly], typed), 'production')!),
    ).toBe('builtin:production-lot')
    // An org default for the type wins over everything.
    const pir = template({ id: 'p', reportTypes: ['production'], defaultFor: ['production'] })
    expect(
      templateChoiceId(
        defaultTemplateChoice(templateChoices([general, pir], typed), 'production')!,
      ),
    ).toBe('org:p')
    // Regenerate falls back to the report's type.
    expect(
      templateChoiceId(
        regenerateTemplateChoice(
          { templateId: 'gone', templateName: null, reportType: 'fai' },
          templateChoices([pir], typed),
        )!,
      ),
    ).toBe('builtin:first-article-as9102')
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
    expect(stored.rows[0]).toMatchObject({
      tampered: true,
      verdictConflict: true,
      unknown: false,
      verdict: 'fail',
    })
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
  const parsed = (
    over: Partial<Pick<ReturnedResults, 'reportId' | 'fileId' | 'fileVersionId' | 'warnings'>>,
  ) => ({
    reportId: 'r1',
    fileId: 'f',
    fileVersionId: 'v1',
    warnings: [],
    ...over,
  })

  it('allows the report’s own workbook', () => {
    expect(importVerdict(own, parsed({}))).toEqual({
      blocked: false,
      reason: null,
      reportIdMismatch: false,
    })
  })

  it('allows another report of the same version, flagged', () => {
    expect(
      importVerdict(own, parsed({ reportId: 'r2', warnings: [{ code: 'REPORT_ID_MISMATCH' }] })),
    ).toEqual({
      blocked: false,
      reason: null,
      reportIdMismatch: true,
    })
  })

  it('blocks a workbook of another version or drawing', () => {
    expect(importVerdict(own, parsed({ reportId: 'r9', fileVersionId: 'v2' })).reason).toBe(
      'other_version',
    )
    expect(importVerdict(own, parsed({ fileId: 'g' })).blocked).toBe(true)
    expect(importVerdict(own, parsed({ fileVersionId: null })).blocked).toBe(true)
  })

  it('blocks a workbook that is not a readable report', () => {
    expect(importVerdict(own, parsed({ warnings: [{ code: 'NOT_A_REPORT' }] })).reason).toBe(
      'not_a_report',
    )
  })

  it('blocks another report of the version that holds other characteristics', () => {
    const rows = (ids: string[]) => ids.map((rowId) => ({ rowId }))
    expect(
      importVerdict(own, { ...parsed({ reportId: 'r2' }), rows: rows(['a', 'b']) }, ['a', 'b']),
    ).toMatchObject({
      blocked: false,
      reportIdMismatch: true,
    })
    expect(
      importVerdict(own, { ...parsed({ reportId: 'r2' }), rows: rows(['a', 'c']) }, ['a', 'b'])
        .reason,
    ).toBe('other_selection')
    // Its own workbook is checked row by row instead (missing and unknown rows).
    expect(importVerdict(own, { ...parsed({}), rows: rows(['a']) }, ['a', 'b']).blocked).toBe(false)
  })
})

describe('nextReportStep', () => {
  it('offers the step each status waits for, and none once decided', () => {
    expect(nextReportStep('issued')).toBe('markSent')
    expect(nextReportStep('sent')).toBe('importResults')
    expect(nextReportStep('returned')).toBe('accept')
    expect(nextReportStep('accepted')).toBeNull()
    expect(nextReportStep('rejected')).toBeNull()
  })
})
