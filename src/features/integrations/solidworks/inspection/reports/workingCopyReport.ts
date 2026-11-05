/**
 * A report of a drawing the user has checked out and changed (extracted, ballooned, edited rows):
 * built from the live inspection table and a PDF exported from the local drawing, so it shows the
 * balloons the user just placed. It is opened as a workbook and never recorded: a recorded report
 * belongs to a checked-in version (its inspection snapshot and its stored drawing PDF), and the
 * checked-out copy is not one yet.
 */
import type { DrawingPageImage, InspectionReportRow } from '@/lib/inspection/excel'
import { rasterizePdf } from '@/lib/inspection/excel'
import type { DrawingOmittedReason } from '@/lib/inspection/issueText'
import { changedCharacteristics } from '@/lib/inspection/reportTypes'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { pdfRenderUnavailableReason } from '@/lib/reviewPackage/pdf'
import { getInspectionRows, getInspectionRowsAtVersion, toRowInput } from '@/lib/supabase'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import type { VersionInfo } from './reportModel'

/** What a working-copy report is built from instead of the version's snapshot and stored PDF. */
export interface WorkingCopySource {
  /** The live inspection table, in table order. */
  rows: InspectionReportRow[]
  /** Local path of the checked-out drawing. */
  drawingPath: string
}

const RENDER_FILE = 'working-copy.pdf'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Whether the checked-out copy holds something the version does not: the drawing file changed
 * (balloons are saved into it), or the live table has other rows, requirements or balloon numbers
 * than the version's snapshot. Pure.
 */
export function workingCopyDiffers(input: {
  modified: boolean
  liveRows: readonly InspectionReportRow[]
  versionRows: readonly InspectionReportRow[]
}): boolean {
  if (input.modified) return true
  if (input.liveRows.length !== input.versionRows.length) return true
  if (changedCharacteristics(input.versionRows, input.liveRows).length > 0) return true
  // The requirement print leaves the balloon out (renumbering changes no part), but the report
  // prints it: a renumbered table is a different report.
  return balloonPrint(input.liveRows) !== balloonPrint(input.versionRows)
}

function balloonPrint(rows: readonly InspectionReportRow[]): string {
  return rows
    .map((r) => JSON.stringify([(r.source_key ?? '').trim(), (r.balloon_number ?? '').trim()]))
    .sort()
    .join(',')
}

/**
 * The working copy to report on, or null when the report should be of the version: the drawing is
 * not checked out by this user on this desktop, has no local file, or holds nothing the version
 * does not.
 */
export async function workingCopySource(file: LocalFile, version: VersionInfo): Promise<WorkingCopySource | null> {
  const userId = usePDMStore.getState().user?.id
  const fileId = file.pdmData?.id
  if (!hasDesktop() || !userId || !fileId || file.pdmData?.checked_out_by !== userId) return null
  if (!file.path || file.diffStatus === 'cloud' || file.diffStatus === 'moved_away' || file.diffStatus === 'deleted') return null

  const live = await getInspectionRows(fileId)
  if (!live.success) throw new Error(live.error ?? 'The inspection table could not be read')
  const liveRows = (live.rows ?? []).map((r) => toRowInput(r))
  const at = await getInspectionRowsAtVersion(fileId, version.id)
  const versionRows = at.rows.map((r) => toRowInput(r))
  const pendingMetadata = !!file.pendingMetadata && Object.keys(file.pendingMetadata).length > 0
  const modified = file.diffStatus === 'modified' || pendingMetadata
  if (!workingCopyDiffers({ modified, liveRows, versionRows })) return null
  return { rows: liveRows, drawingPath: file.path }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The local drawing as page images: exported to a PDF in a staging folder by the SOLIDWORKS
 * service (the drawing may be open there; the service exports that document), read, rasterized,
 * and the folder removed. Nothing is uploaded or recorded.
 */
export async function workingCopyDrawingPages(
  drawingPath: string,
): Promise<{ pages: DrawingPageImage[]; omitted: DrawingOmittedReason | null }> {
  const api = window.electronAPI
  if (!api?.solidworks || !api.reviewPackage) return { pages: [], omitted: 'needs_solidworks' }
  if (await pdfRenderUnavailableReason()) return { pages: [], omitted: 'needs_solidworks' }

  const staging = await api.reviewPackage.createStagingDir()
  if (!staging.success || !staging.path) {
    log.warn('[InspectionReports]', 'Working-copy PDF: no staging folder', { error: staging.error })
    return { pages: [], omitted: 'render_failed' }
  }
  const stagingDir = staging.path
  try {
    const sep = stagingDir.includes('\\') ? '\\' : '/'
    const exported = await api.solidworks.exportPdf(drawingPath, { outputPath: `${stagingDir}${sep}${RENDER_FILE}` })
    if (!exported.success || !exported.data?.outputFile) {
      log.warn('[InspectionReports]', 'Working-copy PDF export failed', { errorCode: exported.errorCode, error: exported.error })
      return { pages: [], omitted: exported.errorCode === 'SW_NOT_INSTALLED' ? 'needs_solidworks' : 'render_failed' }
    }
    const read = await api.reviewPackage.readStagedFile(exported.data.outputFile)
    if (!read.success || read.data === undefined) {
      log.warn('[InspectionReports]', 'Working-copy PDF unreadable', { error: read.error })
      return { pages: [], omitted: 'render_failed' }
    }
    try {
      return { pages: await rasterizePdf(base64ToBytes(read.data)), omitted: null }
    } catch (err) {
      log.warn('[InspectionReports]', 'Working-copy PDF could not be rasterized', { error: errorText(err) })
      return { pages: [], omitted: 'rasterize_failed' }
    }
  } finally {
    const removed = await api.reviewPackage.removeStagingDir(stagingDir)
    if (!removed.success) log.warn('[InspectionReports]', 'Could not remove the working-copy PDF folder', { error: removed.error })
  }
}
