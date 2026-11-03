import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InspectionReport, InspectionReportCreate } from '@/types/inspectionReports'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string }>,
  created: [] as InspectionReportCreate[],
  scalars: [] as Array<Record<string, string> | undefined>,
  logos: [] as unknown[],
  captions: [] as Array<((i: number, n: number, name: string) => string) | undefined>,
  takenOnce: false,
  listed: [] as InspectionReport[],
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
    return { ...input, id: input.id ?? 'r', sequence: input.sequence ?? null } as unknown as InspectionReport
  }),
}))
vi.mock('@/lib/supabase/reviews', () => ({ getDrawingPdf: vi.fn(async () => null) }))
vi.mock('@/lib/reviewPackage', () => ({ ensureDrawingPdf: vi.fn() }))
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  hasDesktop: () => false,
}))
vi.mock('@/lib/inspection/excel', () => ({
  builtInTemplates: vi.fn(async () => [{ key: 'dim', name: 'Dimensional', bytes: new Uint8Array([9]) }]),
  sha256Hex: vi.fn(async () => 'd'.repeat(64)),
  rasterizePdf: vi.fn(async () => []),
  readReturnedResults: vi.fn(),
  formatSpec: () => '',
  generateInspectionReport: vi.fn(
    async (input: {
      scalars?: Record<string, string>
      logo?: unknown
      drawingCaption?: (i: number, n: number, name: string) => string
    }) => {
    mocks.captions.push(input.drawingCaption)
    mocks.scalars.push(input.scalars)
    mocks.logos.push(input.logo)
    return new Uint8Array([2])
    },
  ),
}))

import { generateReport, isReportNumberTaken, ReportHasNoRowsError, type GenerateReportParams } from './reportActions'
import { DEFAULT_REPORT_NAMING } from './reportModel'

function params(over: Partial<GenerateReportParams> = {}): GenerateReportParams {
  const version = { id: 'v2', version: 2, revision: 'A', partNumber: null, description: null, createdAt: null }
  return {
    orgId: 'o',
    orgName: 'Org',
    fileId: 'f',
    drawingName: 'BRK.SLDDRW',
    version,
    versions: [version, { ...version, id: 'v1', version: 1 }],
    template: { kind: 'builtin', key: 'dim', name: 'Dimensional' },
    existingReports: [],
    naming: DEFAULT_REPORT_NAMING,
    identity: { partNumber: 'BR-103849-201', description: 'Bracket', revision: 'A' },
    logo: { bytes: new Uint8Array([0x89]), extension: 'png' },
    ...over,
  }
}

function existing(reportNumber: string, fileVersionId: string, sequence: number | null): InspectionReport {
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
})

describe('isReportNumberTaken', () => {
  it('recognises the database refusal by code or message', () => {
    expect(isReportNumberTaken(Object.assign(new Error('taken'), { code: 'REPORT_NUMBER_TAKEN' }))).toBe(true)
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
    const outcome = await generateReport(params({ existingReports: [existing('BRK-A-IR4', 'v1', null)] }))
    expect(outcome.report.reportNumber).toBe('BR-103849-201_RevA_IRv5')
    expect(mocks.created[0]).toMatchObject({ reportNumber: 'BR-103849-201_RevA_IRv5', sequence: 5, title: 'BR-103849-201 Bracket' })
    expect(mocks.scalars[0]).toMatchObject({ PART_NUMBER: 'BR-103849-201', REVISION: 'A', REPORT_NUMBER: 'BR-103849-201_RevA_IRv5' })
    expect(mocks.logos[0]).toEqual({ bytes: new Uint8Array([0x89]), extension: 'png' })
    expect(mocks.captions[0]?.(0, 3, 'BRK.SLDDRW')).toBe('Drawing sheet 1 of 3: BRK.SLDDRW')
  })

  it('restarts the sequence per revision when the org counts per revision', async () => {
    await generateReport(
      params({
        naming: { ...DEFAULT_REPORT_NAMING, sequenceScope: 'revision' },
        version: { id: 'v3', version: 3, revision: 'B', partNumber: null, description: null, createdAt: null },
        identity: { partNumber: 'P', description: null, revision: 'B' },
        existingReports: [existing('P_RevA_IRv1', 'v1', 1), existing('P_RevA_IRv2', 'v2', 2)],
      }),
    )
    expect(mocks.created[0]).toMatchObject({ reportNumber: 'P_RevB_IRv1', sequence: 1 })
  })

  it('leaves the logo out when the org turned it off', async () => {
    await generateReport(params({ naming: { ...DEFAULT_REPORT_NAMING, includeLogo: false } }))
    expect(mocks.logos[0]).toBeNull()
  })

  it('takes the next number when another user recorded this one first', async () => {
    mocks.takenOnce = true
    mocks.listed = [existing('BR-103849-201_RevA_IRv1', 'v2', 1)]
    const outcome = await generateReport(params())
    expect(mocks.created.map((c) => c.reportNumber)).toEqual(['BR-103849-201_RevA_IRv1', 'BR-103849-201_RevA_IRv2'])
    expect(outcome.report.sequence).toBe(2)
  })
})
