import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  InspectionReport,
  InspectionReportCreate,
  InspectionTemplate,
} from '@/types/inspectionReports'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string }>,
  created: [] as InspectionReportCreate[],
  scalars: [] as Array<Record<string, string> | undefined>,
  logos: [] as unknown[],
  captions: [] as Array<((i: number, n: number, name: string) => string) | undefined>,
  takenOnce: false,
  listed: [] as InspectionReport[],
  samples: [] as Array<number | null>,
  resultCount: 3,
  generatedRows: [] as Array<Array<{ id: string }>>,
  entries: [] as Array<Record<string, string> | undefined>,
  reportIds: [] as Array<string | undefined>,
}))

vi.mock('@/lib/supabase', () => ({
  getInspectionRowsAtVersion: vi.fn(async () => ({
    rows: mocks.rows,
    sourceFileVersionId: 'v2',
    sourceVersion: 2,
    exact: true,
  })),
  toRowInput: (r: { id: string }) => r,
  downloadInspectionContent: vi.fn(async () => new Uint8Array([1])),
  uploadInspectionContent: vi.fn(async () => ({ hash: 'c'.repeat(64), size: 10 })),
  listInspectionReports: vi.fn(async () => mocks.listed),
  updateInspectionReport: vi.fn(),
  createInspectionReport: vi.fn(async (input: InspectionReportCreate) => {
    mocks.created.push(input)
    if (mocks.takenOnce) {
      mocks.takenOnce = false
      throw Object.assign(new Error('taken'), { code: 'REPORT_NUMBER_TAKEN' })
    }
    return {
      ...input,
      id: input.id ?? 'r',
      sequence: input.sequence ?? null,
    } as unknown as InspectionReport
  }),
}))
vi.mock('@/lib/supabase/reviews', () => ({ getDrawingPdf: vi.fn(async () => null) }))
vi.mock('./workingCopyReport', () => ({
  workingCopyDrawingPages: vi.fn(async () => ({ pages: [], omitted: null })),
}))
vi.mock('@/lib/reviewPackage', () => ({ ensureDrawingPdf: vi.fn() }))
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  hasDesktop: () => false,
}))
vi.mock('@/lib/inspection/excel', () => ({
  MAX_SAMPLE_COLUMNS: 10,
  analyzeTemplate: vi.fn(async () => ({ resultCount: mocks.resultCount })),
  buildBuiltInTemplate: vi.fn(async (_key: string, options: { samples?: number }) => {
    mocks.samples.push(options.samples ?? null)
    return new Uint8Array([9])
  }),
  specFingerprint: (r: { nominal_value?: string | null }) => String(r.nominal_value ?? ''),
  sha256Hex: vi.fn(async () => 'd'.repeat(64)),
  rasterizePdf: vi.fn(async () => []),
  readReturnedResults: vi.fn(),
  formatSpec: () => '',
  generateInspectionReport: vi.fn(
    async (input: {
      reportId?: string
      scalars?: Record<string, string>
      rows: Array<{ id: string }>
      entryValues?: Record<string, string>
      logo?: unknown
      drawingCaption?: (i: number, n: number, name: string) => string
    }) => {
      mocks.reportIds.push(input.reportId)
      mocks.captions.push(input.drawingCaption)
      mocks.generatedRows.push(input.rows)
      mocks.entries.push(input.entryValues)
      mocks.scalars.push(input.scalars)
      mocks.logos.push(input.logo)
      return new Uint8Array([2])
    },
  ),
}))

import {
  generateReport,
  isReportNumberTaken,
  ReportHasNoRowsError,
  ReportSamplingError,
  ReportSelectionEmptyError,
  type GenerateReportParams,
} from './reportActions'
import { DEFAULT_REPORT_NAMING } from './reportModel'
import { getInspectionRowsAtVersion } from '@/lib/supabase'
import { workingCopyDrawingPages } from './workingCopyReport'

function params(over: Partial<GenerateReportParams> = {}): GenerateReportParams {
  const version = {
    id: 'v2',
    version: 2,
    revision: 'A',
    partNumber: null,
    description: null,
    createdAt: null,
  }
  return {
    orgId: 'o',
    orgName: 'Org',
    fileId: 'f',
    drawingName: 'BRK.SLDDRW',
    version,
    versions: [version, { ...version, id: 'v1', version: 1 }],
    template: { kind: 'builtin', key: 'dim', name: 'Dimensional', reportTypes: [], defaultFor: [] },
    type: { reportType: 'production', sampling: { plan: 'fixed', n: 3 }, lotScope: 'all' },
    existingReports: [],
    naming: DEFAULT_REPORT_NAMING,
    identity: { partNumber: 'BR-103849-201', description: 'Bracket', revision: 'A' },
    logo: { bytes: new Uint8Array([0x89]), extension: 'png' },
    ...over,
  }
}

function existing(
  reportNumber: string,
  fileVersionId: string,
  sequence: number | null,
): InspectionReport {
  return { reportNumber, fileVersionId, sequence } as InspectionReport
}

beforeEach(() => {
  mocks.rows = [{ id: 'c1' }]
  mocks.created = []
  mocks.scalars = []
  mocks.logos = []
  mocks.captions = []
  mocks.takenOnce = false
  mocks.listed = []
  mocks.samples = []
  mocks.generatedRows = []
  mocks.entries = []
  mocks.reportIds = []
})

describe('isReportNumberTaken', () => {
  it('recognises the database refusal by code or message', () => {
    expect(
      isReportNumberTaken(Object.assign(new Error('taken'), { code: 'REPORT_NUMBER_TAKEN' })),
    ).toBe(true)
    expect(isReportNumberTaken(new Error('REPORT_NUMBER_TAKEN: X-IR2'))).toBe(true)
    expect(isReportNumberTaken(new Error('permission denied'))).toBe(false)
    expect(isReportNumberTaken(null)).toBe(false)
  })
})

describe('generateReport', () => {
  it('refuses a version without inspection rows before generating anything', async () => {
    mocks.rows = []
    await expect(generateReport(params())).rejects.toBeInstanceOf(ReportHasNoRowsError)
    expect(mocks.scalars).toHaveLength(0)
    expect(mocks.created).toHaveLength(0)
  })

  it('names the report by the org pattern and records its sequence', async () => {
    const naming = { ...DEFAULT_REPORT_NAMING, numberPattern: '{partNumber}_Rev{rev}_IRv{n}' }
    const outcome = await generateReport(
      params({ naming, existingReports: [existing('BRK-A-IR4', 'v1', null)] }),
    )
    expect(outcome.report.reportNumber).toBe('BR-103849-201_RevA_IRv5')
    expect(mocks.created[0]).toMatchObject({
      reportNumber: 'BR-103849-201_RevA_IRv5',
      sequence: 5,
      title: 'BR-103849-201 Bracket',
    })
    expect(mocks.scalars[0]).toMatchObject({
      PART_NUMBER: 'BR-103849-201',
      REVISION: 'A',
      REPORT_NUMBER: 'BR-103849-201_RevA_IRv5',
    })
    expect(mocks.logos[0]).toEqual({ bytes: new Uint8Array([0x89]), extension: 'png' })
    expect(mocks.captions[0]?.(0, 3, 'BRK.SLDDRW')).toBe('Drawing sheet 1 of 3: BRK.SLDDRW')
  })

  it('restarts the sequence per revision when the org counts per revision', async () => {
    await generateReport(
      params({
        naming: {
          ...DEFAULT_REPORT_NAMING,
          numberPattern: '{partNumber}_Rev{rev}_IRv{n}',
          sequenceScope: 'revision',
        },
        version: {
          id: 'v3',
          version: 3,
          revision: 'B',
          partNumber: null,
          description: null,
          createdAt: null,
        },
        identity: { partNumber: 'P', description: null, revision: 'B' },
        existingReports: [existing('P_RevA_IRv1', 'v1', 1), existing('P_RevA_IRv2', 'v2', 2)],
      }),
    )
    expect(mocks.created[0]).toMatchObject({ reportNumber: 'P_RevB_IRv1', sequence: 1 })
  })

  it('rebuilds an existing report with its id and number, recording nothing (overwrite)', async () => {
    const naming = { ...DEFAULT_REPORT_NAMING, numberPattern: '{partNumber}_Rev{rev}_IRv{n}' }
    const outcome = await generateReport({
      ...params({ naming, existingReports: [existing('BR-103849-201_RevA_IRv4', 'v2', 4)] }),
      localOnly: true,
      reuse: { reportId: 'old-report', reportNumber: 'BR-103849-201_RevA_IRv4' },
    })
    expect(outcome.reportNumber).toBe('BR-103849-201_RevA_IRv4')
    expect(mocks.reportIds[0]).toBe('old-report')
    expect(mocks.scalars[0]).toMatchObject({ REPORT_NUMBER: 'BR-103849-201_RevA_IRv4' })
    expect(mocks.created).toHaveLength(0)
    expect(outcome).toMatchObject({
      templateId: null,
      templateName: 'Dimensional',
      templateHash: 'd'.repeat(64),
      drawingPdfHash: null,
      characteristicCount: 1,
      sampleColumns: 10,
    })
  })

  it('leaves the logo out when the org turned it off', async () => {
    await generateReport(params({ naming: { ...DEFAULT_REPORT_NAMING, includeLogo: false } }))
    expect(mocks.logos[0]).toBeNull()
  })

  it('takes the next number when another user recorded this one first', async () => {
    mocks.takenOnce = true
    mocks.listed = [{ ...existing('BR-103849-201_RevA_PIR', 'v2', 1), reportType: 'production' }]
    const outcome = await generateReport(params())
    expect(mocks.created.map((c) => c.reportNumber)).toEqual([
      'BR-103849-201_RevA_PIR',
      'BR-103849-201_RevA_PIR_2',
    ])
    expect(outcome.report.sequence).toBe(2)
  })

  it('counts {n} per type with a counted pattern and records the type columns', async () => {
    mocks.rows = [{ id: 'c1' }, { id: 'c2' }]
    await generateReport(
      params({
        naming: { ...DEFAULT_REPORT_NAMING, numberPattern: '{partNumber}_Rev{rev}_{type}{n}' },
        existingReports: [
          { ...existing('BR-103849-201_RevA_FAIR1', 'v1', 1), reportType: 'fai' },
          { ...existing('BR-103849-201_RevA_PIR4', 'v1', 4), reportType: 'production' },
        ],
        type: {
          reportType: 'production',
          lotNumber: ' L-9 ',
          lotSize: 40,
          sampling: { plan: 'fixed', n: 3 },
          lotScope: 'all',
        },
      }),
    )
    expect(mocks.created[0]).toMatchObject({
      reportNumber: 'BR-103849-201_RevA_PIR5',
      characteristicCount: 2,
      type: {
        sampleColumns: 10,
        reportType: 'production',
        lotNumber: 'L-9',
        lotSize: 40,
        sampling: { plan: 'fixed', n: 3 },
        characteristicIds: ['c1', 'c2'],
        faiScope: null,
        ncrReference: null,
      },
    })
    // The lot built-in gets one result column per part; the lot number is written into its entry.
    expect(mocks.samples).toEqual([3])
    expect(mocks.entries[0]).toEqual({ lot_number: 'L-9' })
    expect(mocks.scalars[0]).toMatchObject({ LOT_SIZE: '40', SAMPLE_SIZE: '3' })
  })

  it('lays a large sample out as one row per part', async () => {
    mocks.rows = [{ id: 'c1' }]
    await generateReport(
      params({
        type: {
          reportType: 'production',
          lotSize: 40,
          sampling: { plan: 'fixed', n: 12 },
          lotScope: 'all',
        },
      }),
    )
    expect(mocks.generatedRows[0].map((r) => r.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `c1#${i + 1}`),
    )
    expect(mocks.created[0]).toMatchObject({
      characteristicCount: 1,
      type: { characteristicIds: ['c1'] },
    })
  })

  it('refuses an empty selection and an impossible plan before generating anything', async () => {
    await expect(
      generateReport(
        params({ type: { reportType: 'reinspection', ncrReference: 'NCR-1', chosenIds: [] } }),
      ),
    ).rejects.toBeInstanceOf(ReportSelectionEmptyError)
    await expect(
      generateReport(
        params({
          type: {
            reportType: 'production',
            lotSize: 2,
            sampling: { plan: 'fixed', n: 5 },
            lotScope: 'all',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ReportSamplingError)
    expect(mocks.created).toHaveLength(0)
  })

  it("lays parts out up to an organization template's own result columns, and records that", async () => {
    mocks.rows = [{ id: 'c1' }]
    const org = {
      kind: 'org' as const,
      template: {
        id: 't',
        name: 'Org PIR',
        storageHash: 'e'.repeat(64),
      } as unknown as InspectionTemplate,
    }
    await generateReport(
      params({
        template: org,
        type: {
          reportType: 'production',
          lotSize: 40,
          sampling: { plan: 'fixed', n: 5 },
          lotScope: 'all',
        },
      }),
    )
    // 5 parts, 3 result columns: one row per part.
    expect(mocks.generatedRows[0].map((r) => r.id)).toEqual([
      'c1#1',
      'c1#2',
      'c1#3',
      'c1#4',
      'c1#5',
    ])
    expect(mocks.created[0]).toMatchObject({ templateId: 't', type: { sampleColumns: 3 } })
    expect(mocks.samples).toEqual([])
  })

  it('refuses a partial FAI without a baseline', async () => {
    await expect(
      generateReport(
        params({
          type: {
            reportType: 'fai',
            faiScope: 'partial',
            faiReason: 'design_change',
            baseline: null,
          },
        }),
      ),
    ).rejects.toMatchObject({ note: 'no_baseline' })
    expect(mocks.created).toHaveLength(0)
  })

  it('takes every row for a full FAI and records no set', async () => {
    mocks.rows = [{ id: 'c1' }, { id: 'c2' }]
    await generateReport(
      params({ type: { reportType: 'fai', faiScope: 'full', faiReason: 'new_part' } }),
    )
    expect(mocks.created[0]).toMatchObject({
      reportNumber: 'BR-103849-201_RevA_FAIR',
      type: {
        reportType: 'fai',
        faiScope: 'full',
        faiReason: 'new_part',
        characteristicIds: null,
        lotSize: null,
      },
    })
    expect(mocks.scalars[0]).toMatchObject({
      FAI_TYPE: 'Full FAI',
      FAI_REASON: 'New part',
      LOT_SIZE: '',
    })
    expect(mocks.samples).toEqual([null])
  })
})

describe('generateReport of a checked-out copy', () => {
  const workingCopy = { rows: [{ id: 'live1' }, { id: 'live2' }] as never, drawingPath: 'C:/vault/BRK.SLDDRW' }

  it('builds from the live rows and the local drawing, and records nothing', async () => {
    mocks.rows = []
    vi.mocked(getInspectionRowsAtVersion).mockClear()
    vi.mocked(workingCopyDrawingPages).mockClear()
    const outcome = await generateReport({ ...params(), localOnly: true, workingCopy })
    expect(getInspectionRowsAtVersion).not.toHaveBeenCalled()
    expect(workingCopyDrawingPages).toHaveBeenCalledWith('C:/vault/BRK.SLDDRW')
    expect(mocks.generatedRows[0]?.map((r) => r.id)).toEqual(expect.arrayContaining(['live1', 'live2']))
    expect(mocks.scalars[0]?.DRAWING_VERSION).not.toBe('2')
    expect(mocks.scalars[0]?.DRAWING_VERSION).toContain('2')
    expect(outcome.drawingPdfHash).toBeNull()
    expect(outcome.characteristicCount).toBe(2)
    expect(mocks.created).toHaveLength(0)
  })

  it('refuses to record a report of a checked-out copy', async () => {
    await expect(generateReport({ ...params(), workingCopy })).rejects.toThrow(/never recorded/)
    expect(mocks.created).toHaveLength(0)
  })

  it('refuses a copy without inspection rows', async () => {
    await expect(
      generateReport({ ...params(), localOnly: true, workingCopy: { ...workingCopy, rows: [] } }),
    ).rejects.toBeInstanceOf(ReportHasNoRowsError)
  })
})
