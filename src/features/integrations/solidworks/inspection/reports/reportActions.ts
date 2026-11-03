/**
 * Inspection report operations: generate a report from one checked-in drawing version, open or
 * download a report, read a returned workbook and record its results.
 *
 * A report's inputs are immutable (the version's inspection snapshot and its stored drawing PDF),
 * so the same version and template give the same report. Nothing here reads the live table or a
 * local copy of the drawing.
 */
import {
  builtInTemplates,
  generateInspectionReport,
  rasterizePdf,
  readReturnedResults,
  sha256Hex,
  type DrawingPageImage,
  type InspectionReportRow,
  type ReturnedResults,
} from '@/lib/inspection/excel'
import type { DrawingOmittedReason } from '@/lib/inspection/issueText'
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
import type { InspectionReport, InspectionReportStatus } from '@/types/inspectionReports'

import { openWorkbook, saveWorkbook, type DeliverOutcome } from '@/lib/inspection/reportFiles'
import {
  nextReportName,
  nextReportSequence,
  pathNextTo,
  reportFileName,
  reportNumberValues,
  storedResultsJson,
  summarizeStored,
  importVerdict,
  toStoredResults,
  type ReportIdentity,
  type ReportNaming,
  type StoredResults,
  type TemplateChoice,
  type VersionInfo,
} from './reportModel'
import type { ReportLogo } from './reportSources'

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
  onPhase?: (phase: GeneratePhase) => void
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
}

/** The inspection rows of a version, as the Excel engine takes them. */
export async function rowsAtVersion(
  fileId: string,
  fileVersionId: string,
): Promise<{ rows: InspectionReportRow[]; exact: boolean; sourceVersion: number | null }> {
  const at = await getInspectionRowsAtVersion(fileId, fileVersionId)
  return { rows: at.rows.map((r) => toRowInput(r)), exact: at.exact, sourceVersion: at.sourceVersion }
}

async function templateBytes(
  orgId: string,
  choice: TemplateChoice,
): Promise<{ bytes: Uint8Array; hash: string; name: string; id: string | null }> {
  if (choice.kind === 'org') {
    const bytes = await downloadInspectionContent(orgId, choice.template.storageHash)
    return { bytes, hash: choice.template.storageHash, name: choice.template.name, id: choice.template.id }
  }
  const builtIn = (await builtInTemplates()).find((b) => b.key === choice.key)
  if (!builtIn) throw new Error(`Unknown built-in template: ${choice.key}`)
  return { bytes: builtIn.bytes, hash: await sha256Hex(builtIn.bytes), name: choice.name, id: null }
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

export async function generateReport(params: GenerateReportParams): Promise<GenerateReportOutcome> {
  const { orgId, fileId, version, onPhase, identity, naming } = params

  onPhase?.('rows')
  const rows = await rowsAtVersion(fileId, version.id)
  if (rows.rows.length === 0) throw new ReportHasNoRowsError(version.version)

  onPhase?.('template')
  const template = await templateBytes(orgId, params.template)

  onPhase?.('drawing')
  const drawing = await drawingPages(orgId, version.id)

  const generatedAt = new Date()
  const values = reportNumberValues(identity, params.drawingName, version.version, generatedAt)
  const revisionOf = new Map(params.versions.map((v) => [v.id, v.revision]))
  revisionOf.set(version.id, version.revision)

  // The report number is printed in the workbook, so each attempt fills the workbook with the
  // number it then tries to record. Another user can take that number first (unique per drawing):
  // re-read the drawing's reports, take the next number, and fill the workbook again.
  const reportId = crypto.randomUUID()
  let existing: ReadonlyArray<Pick<InspectionReport, 'reportNumber' | 'fileVersionId'> & { sequence?: number | null }> =
    params.existingReports
  let report: InspectionReport | null = null
  for (let attempt = 1; report === null; attempt++) {
    onPhase?.('workbook')
    const start = nextReportSequence(existing, naming.sequenceScope, identity.revision ?? version.revision, revisionOf)
    const { reportNumber, sequence } = nextReportName(
      naming.numberPattern,
      values,
      start,
      existing.map((r) => r.reportNumber),
    )
    const workbook = await generateInspectionReport({
      template: template.bytes,
      templateHash: template.hash,
      reportId,
      fileId,
      fileVersionId: version.id,
      rows: rows.rows,
      scalars: {
        PART_NUMBER: identity.partNumber ?? '',
        REVISION: identity.revision ?? '',
        DESCRIPTION: identity.description ?? '',
        DRAWING_NAME: params.drawingName,
        DRAWING_VERSION: String(version.version),
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
        characteristicCount: rows.rows.length,
        drawingPdfHash: drawing.pdfHash,
      })
    } catch (err) {
      if (!isReportNumberTaken(err) || attempt >= MAX_NUMBER_ATTEMPTS) throw err
      log.info('[InspectionReports]', 'Report number taken; retrying with the next one', { reportNumber, attempt })
      existing = [
        ...(await listInspectionReports(fileId)),
        { reportNumber, fileVersionId: version.id, sequence },
      ]
    }
  }
  log.info('[InspectionReports]', 'Report generated', {
    reportId,
    fileId,
    fileVersionId: version.id,
    rows: rows.rows.length,
    exact: rows.exact,
    drawingPages: drawing.pages.length,
  })
  return {
    report,
    rowsExact: rows.exact,
    rowsSourceVersion: rows.exact ? null : rows.sourceVersion,
    drawingOmitted: drawing.omitted,
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
}

/** Read a returned workbook against the report's version. Nothing is written. */
export async function readReturned(report: InspectionReport, bytes: Uint8Array): Promise<ReadReturnedOutcome> {
  const rows = await rowsAtVersion(report.fileId, report.fileVersionId)
  const parsed = await readReturnedResults(bytes, { reportId: report.id, rows: rows.rows })
  return { bytes, parsed, stored: toStoredResults(parsed, rows.rows), rowsExact: rows.exact }
}

/** Store the returned workbook and its results on the report (status `returned`). */
export async function applyReturned(report: InspectionReport, read: ReadReturnedOutcome): Promise<InspectionReport> {
  const verdict = importVerdict(report, read.parsed)
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
