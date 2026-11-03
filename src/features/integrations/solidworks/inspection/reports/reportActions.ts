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
  nextReportNumber,
  reportFileName,
  storedResultsJson,
  summarizeStored,
  importVerdict,
  toStoredResults,
  type StoredResults,
  type TemplateChoice,
  type VersionInfo,
} from './reportModel'

export type GeneratePhase = 'rows' | 'template' | 'drawing' | 'workbook' | 'upload' | 'record'

export interface GenerateReportParams {
  orgId: string
  orgName: string
  fileId: string
  /** Drawing file name (`BRK-100.SLDDRW`). */
  drawingName: string
  version: VersionInfo
  template: TemplateChoice
  /** The drawing's existing reports, for the next report number. */
  existingReports: readonly InspectionReport[]
  onPhase?: (phase: GeneratePhase) => void
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
  const { orgId, fileId, version, onPhase } = params

  onPhase?.('rows')
  const rows = await rowsAtVersion(fileId, version.id)

  onPhase?.('template')
  const template = await templateBytes(orgId, params.template)

  onPhase?.('drawing')
  const drawing = await drawingPages(orgId, version.id)

  // The report number is printed in the workbook, so each attempt fills the workbook with the
  // number it then tries to record. Another user can take that number first (unique per drawing):
  // re-read the drawing's reports, take the next number, and fill the workbook again.
  const reportId = crypto.randomUUID()
  let existingNumbers = params.existingReports.map((r) => r.reportNumber)
  let report: InspectionReport | null = null
  for (let attempt = 1; report === null; attempt++) {
    onPhase?.('workbook')
    const reportNumber = nextReportNumber(version.partNumber, version.revision, params.drawingName, existingNumbers)
    const workbook = await generateInspectionReport({
      template: template.bytes,
      templateHash: template.hash,
      reportId,
      fileId,
      fileVersionId: version.id,
      rows: rows.rows,
      scalars: {
        PART_NUMBER: version.partNumber ?? '',
        REVISION: version.revision ?? '',
        DESCRIPTION: version.description ?? '',
        DRAWING_NAME: params.drawingName,
        DRAWING_VERSION: String(version.version),
        REPORT_NUMBER: reportNumber,
        ORG_NAME: params.orgName,
      },
      drawingPages: drawing.pages,
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
        title: [version.partNumber, version.description].filter(Boolean).join(' ') || params.drawingName,
        status: 'issued',
        storageHash: uploaded.hash,
        fileSize: uploaded.size,
        characteristicCount: rows.rows.length,
        drawingPdfHash: drawing.pdfHash,
      })
    } catch (err) {
      if (!isReportNumberTaken(err) || attempt >= MAX_NUMBER_ATTEMPTS) throw err
      log.info('[InspectionReports]', 'Report number taken; retrying with the next one', { reportNumber, attempt })
      existingNumbers = [...(await listInspectionReports(fileId)).map((r) => r.reportNumber), reportNumber]
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
