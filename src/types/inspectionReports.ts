/**
 * Canonical types for inspection templates and inspection reports (schema 504).
 *
 * A template is an organization's Excel workbook (stored in the vault bucket by SHA-256) that the
 * report generator fills in; administrators manage the library. A report is a generated workbook
 * attached to one checked-in drawing version, sent to a supplier and imported back with measured
 * results. `src/lib/supabase/inspectionTemplates.ts` and `inspectionReports.ts` read and write the
 * tables and map their snake_case rows to these shapes.
 */

import type { Json } from './supabase'

/** Where a characteristic's tolerance came from: the drawing itself, or the title block's general tolerances. */
export type ToleranceSource = 'drawing' | 'general'

export type InspectionReportStatus = 'issued' | 'sent' | 'returned' | 'accepted' | 'rejected'

export const INSPECTION_REPORT_STATUSES: readonly InspectionReportStatus[] = [
  'issued',
  'sent',
  'returned',
  'accepted',
  'rejected',
]

export interface InspectionTemplate {
  id: string
  orgId: string
  name: string
  description: string | null
  /** SHA-256 (hex) of the .xlsx in the vault bucket. */
  storageHash: string
  fileSize: number
  originalFilename: string | null
  /** Raised each time the workbook is replaced. */
  revision: number
  isDefault: boolean
  /** Output of `analyzeTemplate()` (src/lib/inspection/excel). */
  layout: Json
  archivedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedBy: string | null
  updatedAt: string
}

export interface InspectionTemplateCreate {
  orgId: string
  name: string
  description?: string | null
  storageHash: string
  fileSize: number
  originalFilename?: string | null
  isDefault?: boolean
  layout?: Json
}

/** Fields an administrator may change. Replacing the workbook passes storageHash, fileSize and revision together. */
export interface InspectionTemplateUpdate {
  name?: string
  description?: string | null
  storageHash?: string
  fileSize?: number
  originalFilename?: string | null
  revision?: number
  isDefault?: boolean
  layout?: Json
  archivedAt?: string | null
}

/** Tally of a returned report's results. */
export interface InspectionResultsSummary {
  total: number
  pass: number
  fail: number
  blank: number
}

export interface InspectionReport {
  id: string
  orgId: string
  fileId: string
  /** The checked-in drawing version the report was generated from. */
  fileVersionId: string
  templateId: string | null
  templateName: string | null
  templateHash: string | null
  reportNumber: string | null
  /**
   * The report's number within its naming scope (the `{n}` of the organization's report number
   * pattern), schema 505. Null on reports from before 505.
   */
  sequence: number | null
  title: string | null
  status: InspectionReportStatus
  /** SHA-256 of the generated workbook in the vault bucket. */
  storageHash: string
  fileSize: number
  characteristicCount: number
  /** SHA-256 of the drawing PDF embedded in the workbook. */
  drawingPdfHash: string | null
  /** SHA-256 of the workbook the supplier returned. */
  returnedHash: string | null
  returnedAt: string | null
  returnedBy: string | null
  results: Json | null
  resultsSummary: InspectionResultsSummary | null
  notes: string | null
  /** Set by the database to the signed-in user; never written by the client. */
  createdBy: string | null
  createdAt: string
  updatedBy: string | null
  updatedAt: string
}

export interface InspectionReportCreate {
  /**
   * Id chosen by the client, so the generated workbook's `_blueplm` sheet can name the report
   * before the row exists. The database generates one when omitted.
   */
  id?: string
  orgId: string
  fileId: string
  fileVersionId: string
  templateId?: string | null
  templateName?: string | null
  templateHash?: string | null
  reportNumber?: string | null
  /** The `{n}` the report number was built with (schema 505). */
  sequence?: number | null
  title?: string | null
  status?: InspectionReportStatus
  storageHash: string
  fileSize: number
  characteristicCount?: number
  drawingPdfHash?: string | null
  results?: Json | null
  resultsSummary?: InspectionResultsSummary | null
  notes?: string | null
}

/**
 * Fields that may change after a report is issued. The organization, file, version and creator
 * are fixed by the database; returnedBy / returnedAt are stamped when returnedHash changes.
 */
export interface InspectionReportUpdate {
  reportNumber?: string | null
  sequence?: number | null
  title?: string | null
  status?: InspectionReportStatus
  storageHash?: string
  fileSize?: number
  characteristicCount?: number
  drawingPdfHash?: string | null
  returnedHash?: string | null
  results?: Json | null
  resultsSummary?: InspectionResultsSummary | null
  notes?: string | null
}

/** One inspection characteristic as snapshotted at a drawing version (inspection_characteristic_version). */
export interface InspectionSnapshotRow {
  id: string
  file_version_id: string
  org_id: string
  sort_order: number
  balloon_number: string | null
  char_id: string | null
  zone: string | null
  char_type: string | null
  sub_type: string | null
  nominal_value: string | null
  unit: string | null
  plus_tolerance: string | null
  minus_tolerance: string | null
  upper_limit: string | null
  lower_limit: string | null
  classification: string | null
  inspection_method: string | null
  operation: string | null
  aql: string | null
  sample_size: number | null
  supplier_inspection_rate: number | null
  internal_inspection_rate: number | null
  reference: string | null
  comments: string | null
  created_at: string | null
  source_key: string | null
  source_sheet: string | null
  source_view: string | null
  tolerance_source: ToleranceSource | null
}

/**
 * The inspection rows a report of a version is built from. `exact` is true when the rows are the
 * version's own snapshot (or the version had no inspection table); false when the version has no
 * snapshot and the rows are the newest snapshot of an older version of the same file
 * (`sourceFileVersionId`, `sourceVersion`).
 */
export interface InspectionRowsAtVersion {
  rows: InspectionSnapshotRow[]
  sourceFileVersionId: string | null
  sourceVersion: number | null
  exact: boolean
}
