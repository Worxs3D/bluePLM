/**
 * The report-type workbooks (5.6.0) for `xlsxFixtures.ts`: each built-in for its type, filled the
 * way Generate fills it (the same selection, sampling, scalars and entries as
 * `reportActions.generateReport`), with the English labels of `inspectionReportTypeStrings`.
 */
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

import {
  buildBuiltInTemplate,
  generateInspectionReport,
  MAX_SAMPLE_COLUMNS,
  type DrawingPageImage,
  type InspectionReportRow,
  type ReportLogo,
  type ScalarName,
} from '../../src/lib/inspection/excel'
import { changedCharacteristics, selectCharacteristics } from '../../src/lib/inspection/reportTypes'
import { inspectionReportTypeStrings as S } from '../../src/lib/i18n/locales/inspectionReportTypes'
import {
  typeEntryValues,
  typeFieldsForRecord,
  typeScalars,
  workbookRows,
  type ReportTypeRequest,
  type TypeLabels,
} from '../../src/features/integrations/solidworks/inspection/reports/reportTypeModel'

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''))

const LABELS: TypeLabels = {
  type: (type) => S[`rptType_${type}`],
  faiScope: (scope) => S[`rptFaiScope_${scope}`],
  faiReason: (reason) => S[`rptFaiReason_${reason}`],
  baseline: (v) => (v.revision ? `Version ${v.version} · Rev ${v.revision}` : `Version ${v.version}`),
  sampling: (plan) => (plan.plan === '100' ? S.rptSampling_100 : fill(S.rptSampling_fixed, { n: plan.n })),
  scope: ({ count, total, scope }) => fill(S[`rptScopeText_${scope}`], { count, total }),
}

const BASELINE = { id: 'look-version-2', version: 2, revision: 'B', partNumber: null, description: null, createdAt: null }

interface Case {
  key: string
  template: string
  number: string
  request: ReportTypeRequest
  /** The version's rows as this case sees them (default: the fixture rows). */
  rows?: InspectionReportRow[]
}

/** Generate each type's workbook; returns the written paths. */
export async function typeWorkbooks(
  out: string,
  rows: InspectionReportRow[],
  pages: DrawingPageImage[],
  logo: ReportLogo,
  baseScalars: Partial<Record<ScalarName, string>>,
  generatedAt: Date,
): Promise<string[]> {
  // Version 2 had 21 characteristics; version 3 added four and changed the tolerance of one.
  const baselineRows = rows.slice(0, 21).map((r) => (r.balloon_number === '6' ? { ...r, plus_tolerance: '0.20', minus_tolerance: '0.20' } : r))
  const cases: Case[] = [
    {
      key: 'fai-full',
      template: 'first-article-as9102',
      number: 'BR-103849-201_RevB_FAIR1',
      request: { reportType: 'fai', faiScope: 'full', faiReason: 'new_part' },
    },
    {
      key: 'fai-partial',
      template: 'first-article-as9102',
      number: 'BR-103849-201_RevB_FAIR3',
      request: { reportType: 'fai', faiScope: 'partial', faiReason: 'design_change', baseline: BASELINE },
    },
    {
      key: 'production',
      template: 'production-lot',
      number: 'BR-103849-201_RevB_PIR2',
      request: { reportType: 'production', lotNumber: 'L-2611', lotSize: 120, sampling: { plan: 'fixed', n: 5 }, lotScope: 'classified' },
    },
    {
      key: 'production-per-part',
      template: 'production-lot',
      number: 'BR-103849-201_RevB_PIR3',
      request: {
        reportType: 'production',
        lotNumber: 'L-2612',
        lotSize: 24,
        sampling: { plan: '100' },
        lotScope: 'classified',
        chosenIds: rows.filter((r) => r.classification === 'Critical').map((r) => r.id),
      },
      // No per-characteristic sample sizes or rates: every part of the lot, one row per part.
      rows: rows.map((r) => ({ ...r, sample_size: null, supplier_inspection_rate: null })),
    },
    {
      key: 'receiving',
      template: 'receiving-inspection',
      number: 'BR-103849-201_RevB_RIR1',
      request: {
        reportType: 'receiving',
        lotNumber: 'L-2611',
        lotSize: 120,
        sampling: { plan: 'fixed', n: 3 },
        poNumber: 'PO-48813',
        supplierName: 'Precision Machining Co.',
        lotScope: 'classified',
      },
    },
    {
      key: 'reinspection',
      template: 'reinspection',
      number: 'BR-103849-201_RevB_RIN1',
      request: {
        reportType: 'reinspection',
        ncrReference: 'NCR-0042',
        chosenIds: rows.filter((r) => ['2', '3', '4'].includes(r.balloon_number ?? '')).map((r) => r.id),
      },
    },
  ]

  const written: string[] = []
  for (const c of cases) {
    const caseRows = c.rows ?? rows
    const changedIds = c.request.faiScope === 'partial' ? changedCharacteristics(baselineRows, rows) : undefined
    const selection = selectCharacteristics({
      type: c.request.reportType,
      faiScope: c.request.faiScope,
      rows: caseRows,
      changedIds,
      scope: c.request.lotScope,
      chosenIds: c.request.chosenIds,
    })
    const fields = typeFieldsForRecord(c.request, selection)
    const laid = workbookRows(
      { reportType: c.request.reportType, sampling: fields.sampling ?? null, lotSize: fields.lotSize ?? null },
      selection.rows,
      MAX_SAMPLE_COLUMNS,
    )
    if ('error' in laid) throw new Error(`${c.key}: ${laid.error}`)
    const template = await buildBuiltInTemplate(c.template, laid.samples !== null ? { samples: laid.samples } : {})
    const path = join(out, `type-${c.key}.xlsx`)
    writeFileSync(
      path,
      await generateInspectionReport({
        template,
        reportId: `look-${c.key}`,
        fileId: 'look-file',
        fileVersionId: 'look-version-3',
        rows: laid.rows,
        entryValues: typeEntryValues(c.request, LABELS),
        scalars: {
          ...baseScalars,
          ...typeScalars(c.request, { selection, totalRows: rows.length, samples: laid.samples, labels: LABELS }),
          REPORT_NUMBER: c.number,
        },
        logo,
        drawingPages: pages,
        generatedAt,
      }),
    )
    console.log(`${c.key}: ${selection.rows.length} characteristics, ${laid.rows.length} rows, samples ${laid.samples ?? '-'}`)
    written.push(path)
  }
  return written
}
