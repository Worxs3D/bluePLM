/**
 * Pure parts of the Inspection tab's two native-inspection flows: the preview view model for
 * "Extract from drawing" and the request builder for "Balloon drawing". The tab and its dialogs
 * render what these return; nothing here talks to the service or the database.
 */
import type { InspectionRowInput, InspectionRowValues } from '@/lib/supabase'
import type { CharacteristicMergePlan } from '@/lib/inspection/characteristicMerge'
import {
  INSPECTION_BALLOON_ERROR_CODES,
  type ExtractedCharacteristic,
  type InspectionBalloonRequest,
} from '@/lib/inspection/types'

/** One row of the preview lists. */
export interface PreviewItem {
  rowId: string
  balloon: string
  /** `Dimension · Diameter · Ø10 +0.1/-0.05`, for recognising the row. */
  summary: string
  sheet: string | null
}

export interface PreviewMissingItem extends PreviewItem {
  /** The row's sheet could not be fully read, so "gone" is not certain. Not ticked by default. */
  onIncompleteSheet: boolean
}

export interface PreviewUpdatedItem extends PreviewItem {
  changedFields: (keyof InspectionRowValues)[]
  adopted: boolean
}

export interface ExtractPreview {
  added: PreviewItem[]
  updated: PreviewUpdatedItem[]
  missing: PreviewMissingItem[]
  /** Rows whose annotation was found but could not be read; kept as they are. */
  unreadable: PreviewItem[]
  /** Sheets the service could not read completely. */
  incompleteSheets: string[]
  counts: {
    added: number
    updated: number
    adopted: number
    unchanged: number
    missing: number
    unreadable: number
    manual: number
  }
  /** Nothing would change: no additions, updates or missing rows. */
  isNoOp: boolean
}

/** Short text identifying a row: type, sub-type, nominal and tolerances. */
export function rowSummary(row: InspectionRowValues): string {
  const tol =
    row.plus_tolerance || row.minus_tolerance
      ? ` ${row.plus_tolerance ?? ''}/${row.minus_tolerance ?? ''}`
      : ''
  const value = row.nominal_value ? `${row.nominal_value}${tol}` : ''
  return [row.char_type, row.sub_type, value].filter((part) => !!part).join(' · ')
}

function toItem(row: InspectionRowInput): PreviewItem {
  return {
    rowId: row.id,
    balloon: row.balloon_number ?? '',
    summary: rowSummary(row),
    sheet: row.source_sheet,
  }
}

/** The preview dialog's view of a merge plan. */
export function buildExtractPreview(
  plan: CharacteristicMergePlan,
  incompleteSheets: string[] = [],
): ExtractPreview {
  const incomplete = new Set(incompleteSheets)
  const adoptedIds = new Set(plan.adopted.map((a) => a.rowId))
  const updated = plan.updated.map((u) => ({
    ...toItem(u.after),
    changedFields: u.changedFields,
    adopted: adoptedIds.has(u.rowId),
  }))
  return {
    added: plan.added.map(toItem),
    updated,
    missing: plan.missing.map((row) => ({
      ...toItem(row),
      onIncompleteSheet: !!row.source_sheet && incomplete.has(row.source_sheet),
    })),
    unreadable: plan.unreadable.map(toItem),
    incompleteSheets: [...incomplete],
    counts: {
      added: plan.added.length,
      updated: updated.filter((u) => !u.adopted).length,
      adopted: plan.adopted.length,
      unchanged: plan.unchanged.length,
      missing: plan.missing.length,
      unreadable: plan.unreadable.length,
      manual: plan.manual.length,
    },
    isNoOp: plan.added.length === 0 && plan.updated.length === 0 && plan.missing.length === 0,
  }
}

/**
 * Missing rows are removed unless the user unticks them. Every missing row starts ticked, except
 * rows on a sheet the service could not fully read: their annotation may still be there.
 */
export function defaultRemoveIds(
  plan: CharacteristicMergePlan,
  incompleteSheets: string[] = [],
): Set<string> {
  const incomplete = new Set(incompleteSheets)
  return new Set(
    plan.missing
      // A row with no recorded sheet could sit on an incomplete one, so it is not ticked either.
      .filter((row) =>
        row.source_sheet ? !incomplete.has(row.source_sheet) : incomplete.size === 0,
      )
      .map((row) => row.id),
  )
}

export interface BalloonRequestPlan {
  /** One request per row whose key is still in the drawing, in table order. */
  balloons: InspectionBalloonRequest[]
  /** Rows with a key and a number whose annotation is gone from the drawing. Not ballooned. */
  stale: InspectionRowInput[]
  /** Rows without a key or a balloon number (manual rows). Not ballooned. */
  unkeyed: number
}

/**
 * Balloon requests for the table against a fresh extraction. Rows do not store the persist
 * reference, so it comes from the extraction, matched by `source_key`.
 */
export function planBalloonRequests(
  rows: InspectionRowInput[],
  extracted: ExtractedCharacteristic[],
): BalloonRequestPlan {
  const byKey = new Map<string, ExtractedCharacteristic>()
  for (const c of extracted) if (!byKey.has(c.sourceKey)) byKey.set(c.sourceKey, c)

  const balloons: InspectionBalloonRequest[] = []
  const stale: InspectionRowInput[] = []
  let unkeyed = 0
  for (const row of rows) {
    const key = row.source_key?.trim() ?? ''
    const label = row.balloon_number?.trim() ?? ''
    if (!key || !label) {
      unkeyed++
      continue
    }
    const c = byKey.get(key)
    if (!c) {
      stale.push(row)
      continue
    }
    balloons.push({ sourceKey: key, label, persistRef: c.persistRef })
  }
  return { balloons, stale, unkeyed }
}

/** i18n key (under `source.inspection`) for a service error code of either command, or null. */
export function inspectionErrorKey(errorCode: string | undefined): string | null {
  switch (errorCode) {
    case INSPECTION_BALLOON_ERROR_CODES.readOnly:
      return 'source.inspection.errorReadOnly'
    case INSPECTION_BALLOON_ERROR_CODES.openInSolidWorks:
      return 'source.inspection.errorOpenInSolidWorks'
    case INSPECTION_BALLOON_ERROR_CODES.unsavedChanges:
      return 'source.inspection.errorUnsavedChanges'
    case INSPECTION_BALLOON_ERROR_CODES.notADrawing:
      return 'source.inspection.errorNotADrawing'
    case INSPECTION_BALLOON_ERROR_CODES.modifiedNotSaved:
      return 'source.inspection.errorModifiedNotSaved'
    default:
      return null
  }
}
