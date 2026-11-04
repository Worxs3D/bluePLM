/**
 * Inspection report operations: generate a report from one checked-in drawing version, open or
 * download a report, read a returned workbook and record its results.
 *
 * A report's inputs are immutable (the version's inspection snapshot and its stored drawing PDF),
 * so the same version and template give the same report. The one exception is a workbook of the
 * user's checked-out copy (`workingCopy`, `workingCopyReport.ts`): live table and local drawing,
 * built only with `localOnly`, never recorded.
 */
import {
  analyzeTemplate,
  buildBuiltInTemplate,
  generateInspectionReport,
  MAX_SAMPLE_COLUMNS,
  rasterizePdf,
  readReturnedResults,
  sha256Hex,
  type DrawingPageImage,
  type InspectionReportRow,
  type ReturnedResults,
} from '@/lib/inspection/excel'
import type { DrawingOmittedReason } from '@/lib/inspection/issueText'
import {
  changedCharacteristics,
  collapseSampleRows,
  selectCharacteristics,
  type SamplePlanError,
  type SelectionNote,
} from '@/lib/inspection/reportTypes'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { ensureDrawingPdf } from '@/lib/reviewPackage'
import {
  createInspectionReport,
  downloadInspectionContent,
  getInspectionRowsAtVersion,
  listInspectionReports,
  toRowInput,
  updateInspectionReport,
  uploadInspectionContent,
} from '@/lib/supabase'
import { getDrawingPdf } from '@/lib/supabase/reviews'
import type { InspectionReport, InspectionReportStatus, SamplingPlan } from '@/types/inspectionReports'

import { openWorkbook, saveWorkbook, type DeliverOutcome } from '@/lib/inspection/reportFiles'
import {
  nextReportName,
  nextReportSequence,
  patternHasType,
  pathNextTo,
  reportFileName,
  reportNumberValues,
  storedResultsJson,
  summarizeStored,
  importVerdict,
  toStoredResults,
  type ReportIdentity,
  type ReportNaming,
  type ImportVerdict,
  type StoredResults,
  type TemplateChoice,
  type VersionInfo,
} from './reportModel'
import type { ReportLogo } from './reportSources'
import { workingCopyDrawingPages, type WorkingCopySource } from './workingCopyReport'
import {
  faiReasonKey,
  includedRows,
  isLotType,
  reportTypeKey,
  requestSampling,
  typeEntryValues,
  typeFieldsForRecord,
  typeScalars,
  workbookRows,
  type ReportTypeRequest,
  type TypeLabels,
} from './reportTypeModel'

export type GeneratePhase = 'rows' | 'template' | 'drawing' | 'workbook' | 'upload' | 'record'

export interface GenerateReportParams {
  orgId: string
  orgName: string
  fileId: string
  /** Drawing file name (`BRK-100.SLDDRW`). */
  drawingName: string
  version: VersionInfo
  /** The drawing's checked-in versions (for a sequence that restarts per revision). */
  versions: readonly VersionInfo[]
  template: TemplateChoice
  /** The drawing's existing reports, for the next report number. */
  existingReports: readonly InspectionReport[]
  /** The organization's report naming (`reportNamingFromSettings`). */
  naming: ReportNaming
  /** Part number, description and revision (`reportIdentity`: version, file, referenced model). */
  identity: ReportIdentity
  /** The organization logo, or null for none. */
  logo: ReportLogo | null
  /** What the report is (type, FAI scope, lot, sampling, chosen characteristics). */
  type: ReportTypeRequest
  /** The report this one replaces in the file list (a regeneration; schema 508). */
  supersedesReportId?: string | null
  /**
   * Rebuild an existing report's workbook (an overwrite of the same version): its id and number
   * are printed in the workbook instead of a new id and the next number. Only with `localOnly`.
   */
  reuse?: { reportId: string; reportNumber: string | null }
  /**
   * Build from the user's checked-out copy (live table, local drawing) instead of the version's
   * snapshot and stored PDF; `version` is the version it is based on. Only with `localOnly`.
   */
  workingCopy?: WorkingCopySource
  onPhase?: (phase: GeneratePhase) => void
}

/** Thrown before anything is generated when the type's selection leaves no characteristic. */
export class ReportSelectionEmptyError extends Error {
  readonly code = 'REPORT_SELECTION_EMPTY'
  constructor(readonly note: SelectionNote | null) {
    super(`The report includes no characteristic (${note ?? 'empty'})`)
    this.name = 'ReportSelectionEmptyError'
  }
}

/** Thrown before anything is generated when the sampling plan cannot be laid out. */
export class ReportSamplingError extends Error {
  readonly code = 'REPORT_SAMPLING'
  constructor(readonly reason: SamplePlanError) {
    super(`The sampling plan cannot be used: ${reason}`)
    this.name = 'ReportSamplingError'
  }
}

/** Workbook labels of the report types, in the app language. */
export function typeLabels(): TypeLabels {
  return {
    type: (type) => t(reportTypeKey(type)),
    faiScope: (scope) => t(`source.inspection.rptFaiScope_${scope}`),
    faiReason: (reason) => t(faiReasonKey(reason)),
    baseline: (v) =>
      v.revision
        ? t('source.inspection.rptVersionOptionRev', { version: v.version, revision: v.revision })
        : t('source.inspection.rptVersionOption', { version: v.version }),
    sampling: (plan: SamplingPlan) =>
      plan.plan === '100' ? t('source.inspection.rptSampling_100') : t('source.inspection.rptSampling_fixed', { n: plan.n }),
    scope: ({ count, total, scope }) => t(`source.inspection.rptScopeText_${scope}`, { count, total }),
  }
}

/**
 * Thrown before anything is generated when the version has no inspection rows: a report of it
 * would be an empty table. The user extracts the characteristics and checks the drawing in.
 */
export class ReportHasNoRowsError extends Error {
  readonly code = 'REPORT_NO_ROWS'
  constructor(readonly version: number) {
    super(`Version ${version} has no inspection characteristics`)
    this.name = 'ReportHasNoRowsError'
  }
}

export interface GenerateReportOutcome {
  report: InspectionReport
  /** False when the version had no snapshot and an older version's rows were used. */
  rowsExact: boolean
  /** The version the rows came from, when not the report's own. */
  rowsSourceVersion: number | null
  drawingOmitted: DrawingOmittedReason | null
  /** Why the selection is not what the type would normally take (nothing classified). */
  selectionNote: SelectionNote | null
  /** Partial FAI: false when the baseline version had no own snapshot (an older one was compared). */
  baselineExact: boolean
}

/** A report built as a workbook only (`localOnly`): nothing uploaded or recorded. */
export interface LocalReportOutcome extends Omit<GenerateReportOutcome, 'report'> {
  workbook: Uint8Array
  /** The number printed in it (not reserved: the next recorded report may take it). */
  reportNumber: string
  /** What an overwrite records with the workbook (`overwriteInspectionReport`). */
  templateId: string | null
  templateName: string
  templateHash: string
  drawingPdfHash: string | null
  characteristicCount: number
  /** Lot reports: part columns the workbook was laid out with; null otherwise. */
  sampleColumns: number | null
}

/** The inspection rows of a version, as the Excel engine takes them. */
export async function rowsAtVersion(
  fileId: string,
  fileVersionId: string,
): Promise<{ rows: InspectionReportRow[]; exact: boolean; sourceVersion: number | null }> {
  const at = await getInspectionRowsAtVersion(fileId, fileVersionId)
  return { rows: at.rows.map((r) => toRowInput(r)), exact: at.exact, sourceVersion: at.sourceVersion }
}

interface LoadedTemplate {
  bytes: Uint8Array
  hash: string
  name: string
  id: string | null
}

/** Result columns usable as one column per part: the template's own, at least 1, at most 10. */
export function sampleColumnsOf(resultCount: number): number {
  return Math.min(Math.max(1, resultCount), MAX_SAMPLE_COLUMNS)
}

/**
 * The version's stored drawing PDF as page images. On the desktop with SOLIDWORKS a missing PDF is
 * rendered (and stored for everyone); on the web, or without SOLIDWORKS, only an existing render
 * is used.
 */
async function drawingPages(
  orgId: string,
  fileVersionId: string,
): Promise<{ pages: DrawingPageImage[]; pdfHash: string | null; omitted: DrawingOmittedReason | null }> {
  let pdfHash: string | null = null
  if (hasDesktop()) {
    const pdf = await ensureDrawingPdf(fileVersionId)
    if (pdf.status === 'cached' || pdf.status === 'generated') pdfHash = pdf.storageHash
    else {
      log.warn('[InspectionReports]', 'Report without drawing', { fileVersionId, status: pdf.status })
      const omitted: DrawingOmittedReason =
        pdf.status === 'needs_solidworks'
          ? 'needs_solidworks'
          : pdf.status === 'not_a_drawing'
            ? 'not_a_drawing'
            : 'render_failed'
      return { pages: [], pdfHash: null, omitted }
    }
  } else {
    const stored = await getDrawingPdf(fileVersionId)
    if (!stored) return { pages: [], pdfHash: null, omitted: 'web_no_render' }
    pdfHash = stored.storageHash
  }
  try {
    const bytes = await downloadInspectionContent(orgId, pdfHash)
    return { pages: await rasterizePdf(bytes), pdfHash, omitted: null }
  } catch (err) {
    log.warn('[InspectionReports]', 'Drawing PDF could not be rasterized', {
      fileVersionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { pages: [], pdfHash: null, omitted: 'rasterize_failed' }
  }
}

/** Attempts at recording a report number before giving up (each lost race re-reads the list). */
export const MAX_NUMBER_ATTEMPTS = 3

/** The database refused the report number because another report of the drawing has it. */
export function isReportNumberTaken(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === 'REPORT_NUMBER_TAKEN' || (err instanceof Error && err.message.includes('REPORT_NUMBER_TAKEN'))
}

export async function generateReport(params: GenerateReportParams & { localOnly: true }): Promise<LocalReportOutcome>
export async function generateReport(params: GenerateReportParams): Promise<GenerateReportOutcome>
/**
 * Build a report workbook from a version's inspection rows and a template, upload it and record
 * it. `localOnly` (Generate > Local) stops once the workbook is built and returns it instead.
 */
export async function generateReport(
  params: GenerateReportParams & { localOnly?: boolean },
): Promise<GenerateReportOutcome | LocalReportOutcome> {
  const { orgId, fileId, version, onPhase, identity, naming } = params
  const request: ReportTypeRequest = isLotType(params.type.reportType)
    ? {
        ...params.type,
        sampling: requestSampling(params.type, naming.defaultSampleSize),
        lotScope: params.type.lotScope ?? naming.lotScope,
      }
    : params.type

  const { workingCopy } = params
  if (workingCopy && !params.localOnly) throw new Error('A report of a checked-out copy is never recorded')

  onPhase?.('rows')
  const rows = workingCopy
    ? { rows: workingCopy.rows, exact: true, sourceVersion: null }
    : await rowsAtVersion(fileId, version.id)
  if (rows.rows.length === 0) throw new ReportHasNoRowsError(version.version)

  // Partial FAI: the characteristics changed since the baseline version's snapshot. Without a
  // baseline it would compare against nothing and cover everything under a partial label.
  let changedIds: string[] | undefined
  let baselineExact = true
  if (request.reportType === 'fai' && request.faiScope === 'partial') {
    if (!request.baseline) throw new ReportSelectionEmptyError('no_baseline')
    const baseline = await rowsAtVersion(fileId, request.baseline.id)
    baselineExact = baseline.exact
    if (!request.chosenIds) changedIds = changedCharacteristics(baseline.rows, rows.rows)
  }
  const selection = selectCharacteristics({
    type: request.reportType,
    faiScope: request.faiScope,
    rows: rows.rows,
    changedIds,
    scope: request.lotScope,
    chosenIds: request.chosenIds,
  })
  if (selection.rows.length === 0) throw new ReportSelectionEmptyError(selection.note)

  // A lot report lays parts out as result columns up to what the template has (an organization
  // template may have fewer than the built-ins' 10); the count is recorded for the import.
  onPhase?.('template')
  const lot = isLotType(request.reportType)
  let template: LoadedTemplate | null = null
  let sampleColumns = MAX_SAMPLE_COLUMNS
  if (params.template.kind === 'org') {
    const org = params.template.template
    const bytes = await downloadInspectionContent(orgId, org.storageHash)
    template = { bytes, hash: org.storageHash, name: org.name, id: org.id }
    if (lot) sampleColumns = sampleColumnsOf((await analyzeTemplate(bytes)).resultCount)
  }
  const fields = { ...typeFieldsForRecord(request, selection), sampleColumns: lot ? sampleColumns : null }
  const laidOut = workbookRows(
    { reportType: request.reportType, sampling: fields.sampling ?? null, lotSize: fields.lotSize ?? null },
    selection.rows,
    sampleColumns,
  )
  if ('error' in laidOut) throw new ReportSamplingError(laidOut.error)
  if (!template) {
    // A lot built-in has one result column per part (one row per part above the column limit).
    const choice = params.template as Extract<TemplateChoice, { kind: 'builtin' }>
    const bytes = await buildBuiltInTemplate(choice.key, laidOut.samples !== null ? { samples: laidOut.samples } : {})
    template = { bytes, hash: await sha256Hex(bytes), name: choice.name, id: null }
  }

  onPhase?.('drawing')
  const drawing = workingCopy
    ? { ...(await workingCopyDrawingPages(workingCopy.drawingPath)), pdfHash: null }
    : await drawingPages(orgId, version.id)

  const generatedAt = new Date()
  const values = reportNumberValues(identity, params.drawingName, version.version, generatedAt, request.reportType)
  const labels = typeLabels()
  const perType = patternHasType(naming.numberPattern) ? request.reportType : undefined
  const revisionOf = new Map(params.versions.map((v) => [v.id, v.revision]))
  revisionOf.set(version.id, version.revision)

  // The report number is printed in the workbook, so each attempt fills the workbook with the
  // number it then tries to record. Another user can take that number first (unique per drawing):
  // re-read the drawing's reports, take the next number, and fill the workbook again.
  const reportId = params.reuse?.reportId ?? crypto.randomUUID()
  let existing: ReadonlyArray<
    Pick<InspectionReport, 'reportNumber' | 'fileVersionId'> & {
      sequence?: number | null
      reportType?: InspectionReport['reportType']
    }
  > = params.existingReports
  let report: InspectionReport | null = null
  for (let attempt = 1; report === null; attempt++) {
    onPhase?.('workbook')
    const start = nextReportSequence(
      existing,
      naming.sequenceScope,
      identity.revision ?? version.revision,
      revisionOf,
      perType,
    )
    const { reportNumber, sequence } = params.reuse
      ? { reportNumber: params.reuse.reportNumber ?? '', sequence: null }
      : nextReportName(naming.numberPattern, values, start, existing.map((r) => r.reportNumber))
    const workbook = await generateInspectionReport({
      template: template.bytes,
      templateHash: template.hash,
      reportId,
      fileId,
      fileVersionId: version.id,
      rows: laidOut.rows,
      entryValues: typeEntryValues(request, labels),
      scalars: {
        ...typeScalars(request, { selection, totalRows: rows.rows.length, samples: laidOut.samples, labels }),
        PART_NUMBER: identity.partNumber ?? '',
        REVISION: identity.revision ?? '',
        DESCRIPTION: identity.description ?? '',
        DRAWING_NAME: params.drawingName,
        DRAWING_VERSION: workingCopy
          ? t('source.inspection.rptWorkingCopyVersion', { version: version.version })
          : String(version.version),
        REPORT_NUMBER: reportNumber,
        ORG_NAME: params.orgName,
      },
      drawingPages: drawing.pages,
      logo: naming.includeLogo ? params.logo : null,
      drawingCaption: (index, total, name) =>
        name
          ? t('source.inspection.rptDrawingCaption', { index: index + 1, total, name })
          : t('source.inspection.rptDrawingCaptionNoName', { index: index + 1, total }),
      noRowsText: t('source.inspection.rptNoRowsText'),
      generatedAt,
    })

    if (params.localOnly) {
      return {
        workbook,
        reportNumber,
        templateId: template.id,
        templateName: template.name,
        templateHash: template.hash,
        drawingPdfHash: drawing.pdfHash,
        characteristicCount: selection.rows.length,
        sampleColumns: fields.sampleColumns ?? null,
        rowsExact: rows.exact,
        rowsSourceVersion: rows.exact ? null : rows.sourceVersion,
        drawingOmitted: drawing.omitted,
        selectionNote: selection.note,
        baselineExact,
      }
    }

    onPhase?.('upload')
    const uploaded = await uploadInspectionContent(orgId, workbook)

    onPhase?.('record')
    try {
      report = await createInspectionReport({
        id: reportId,
        orgId,
        fileId,
        fileVersionId: version.id,
        templateId: template.id,
        templateName: template.name,
        templateHash: template.hash,
        reportNumber,
        sequence,
        title: [identity.partNumber, identity.description].filter(Boolean).join(' ') || params.drawingName,
        status: 'issued',
        storageHash: uploaded.hash,
        fileSize: uploaded.size,
        characteristicCount: selection.rows.length,
        drawingPdfHash: drawing.pdfHash,
        supersedesReportId: params.supersedesReportId ?? null,
        type: fields,
      })
    } catch (err) {
      if (!isReportNumberTaken(err) || attempt >= MAX_NUMBER_ATTEMPTS) throw err
      log.info('[InspectionReports]', 'Report number taken; retrying with the next one', { reportNumber, attempt })
      existing = [
        ...(await listInspectionReports(fileId)),
        { reportNumber, fileVersionId: version.id, sequence, reportType: request.reportType },
      ]
    }
  }
  log.info('[InspectionReports]', 'Report generated', {
    reportId,
    fileId,
    fileVersionId: version.id,
    rows: selection.rows.length,
    workbookRows: laidOut.rows.length,
    reportType: request.reportType,
    exact: rows.exact,
    drawingPages: drawing.pages.length,
  })
  return {
    report,
    rowsExact: rows.exact,
    rowsSourceVersion: rows.exact ? null : rows.sourceVersion,
    drawingOmitted: drawing.omitted,
    selectionNote: selection.note,
    baselineExact,
  }
}

/** Open the generated workbook (desktop: default app; web: download). */
export async function openReport(report: InspectionReport): Promise<DeliverOutcome> {
  const bytes = await downloadInspectionContent(report.orgId, report.storageHash)
  return openWorkbook(reportFileName(report), bytes)
}

/** Save the generated workbook, to send it to a supplier. */
export async function downloadReport(report: InspectionReport): Promise<DeliverOutcome> {
  const bytes = await downloadInspectionContent(report.orgId, report.storageHash)
  return saveWorkbook(reportFileName(report), bytes)
}

export type SaveNextOutcome = { kind: 'saved'; path: string } | { kind: 'exists'; path: string }

/**
 * Save the workbook as an ordinary local file in the drawing's folder, named by the report number
 * (desktop). An existing file of that name is never overwritten: it may hold entered results.
 * Checking the copy in is the user's choice.
 */
export async function saveReportNextToDrawing(report: InspectionReport, drawingPath: string): Promise<SaveNextOutcome> {
  const api = hasDesktop() ? window.electronAPI : undefined
  if (!api) throw new Error('Saving next to the drawing needs the desktop app')
  const path = pathNextTo(drawingPath, reportFileName(report))
  if (await api.fileExists(path)) return { kind: 'exists', path }
  const bytes = await downloadInspectionContent(report.orgId, report.storageHash)
  const result = await api.writeFile(path, bytesToBase64(bytes))
  if (!result.success) throw new Error(result.error ?? 'Could not write the workbook')
  return { kind: 'saved', path }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Open the workbook the supplier returned (desktop: default app; web: download). */
export async function openReturned(report: InspectionReport): Promise<DeliverOutcome> {
  if (!report.returnedHash) throw new Error('No returned workbook')
  const bytes = await downloadInspectionContent(report.orgId, report.returnedHash)
  return openWorkbook(reportFileName(report, true), bytes)
}

/** Save the workbook the supplier returned. */
export async function downloadReturned(report: InspectionReport): Promise<DeliverOutcome> {
  if (!report.returnedHash) throw new Error('No returned workbook')
  const bytes = await downloadInspectionContent(report.orgId, report.returnedHash)
  return saveWorkbook(reportFileName(report, true), bytes)
}

export interface ReadReturnedOutcome {
  bytes: Uint8Array
  parsed: ReturnedResults
  stored: StoredResults
  /** False when the report's version had no own snapshot (rows from an older version). */
  rowsExact: boolean
  /** Row ids the report's workbook holds, as laid out (one per part above the column limit). */
  workbookRowIds: string[]
  /** Row ids the returned workbook holds, before folding parts back per characteristic. */
  rawRowIds: string[]
}

/** Whether a returned workbook may be recorded on the report, comparing rows as laid out. */
export function returnedVerdict(report: InspectionReport, read: ReadReturnedOutcome): ImportVerdict {
  return importVerdict(report, { ...read.parsed, rows: read.rawRowIds.map((rowId) => ({ rowId })) }, read.workbookRowIds)
}

/**
 * Read a returned workbook against the report: the characteristics it includes (its recorded set)
 * laid out as its workbook was (one row per sampled part above the column limit), then folded back
 * to one result per characteristic. Nothing is written.
 */
export async function readReturned(report: InspectionReport, bytes: Uint8Array): Promise<ReadReturnedOutcome> {
  const rows = await rowsAtVersion(report.fileId, report.fileVersionId)
  const included = includedRows(report, rows.rows)
  const laidOut = workbookRows(report, included, report.sampleColumns ?? MAX_SAMPLE_COLUMNS)
  const layout = 'error' in laidOut ? null : laidOut
  const expected = layout?.rows ?? included
  const raw = await readReturnedResults(bytes, {
    reportId: report.id,
    rows: expected,
    expectedValues: layout?.expectedValues,
  })
  const parsed = collapseSampleRows(raw, layout?.counts)
  return {
    bytes,
    parsed,
    stored: toStoredResults(parsed, included, report.reportType !== null),
    rowsExact: rows.exact,
    workbookRowIds: expected.map((r) => r.id),
    rawRowIds: raw.rows.map((r) => r.rowId).filter((id): id is string => !!id),
  }
}

/** Store the returned workbook and its results on the report (status `returned`). */
export async function applyReturned(report: InspectionReport, read: ReadReturnedOutcome): Promise<InspectionReport> {
  const verdict = returnedVerdict(report, read)
  if (verdict.blocked) throw new Error('The workbook does not belong to this drawing version')
  const uploaded = await uploadInspectionContent(report.orgId, read.bytes)
  return updateInspectionReport(report.id, {
    returnedHash: uploaded.hash,
    results: storedResultsJson(read.stored),
    resultsSummary: summarizeStored(read.stored),
    status: 'returned',
  })
}

export function setReportStatus(report: InspectionReport, status: InspectionReportStatus): Promise<InspectionReport> {
  return updateInspectionReport(report.id, { status })
}
