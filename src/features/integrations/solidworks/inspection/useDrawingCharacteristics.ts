import { useState, useCallback, useEffect, useRef } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import { getHighestUsedBalloonNumber, type InspectionRowInput } from '@/lib/supabase'
import { hasLocalContent } from '@/lib/fileOperations/assemblyResolver'
import {
  checkSwServiceFeature,
  SW_SERVICE_VERSION_NATIVE_INSPECTION,
} from '@/lib/swServiceVersion'
import {
  applyCharacteristicMerge,
  planCharacteristicMerge,
} from '@/lib/inspection/characteristicMerge'
import type { GeneralToleranceBasis } from '@/lib/inspection/generalTolerance'
import type { ExtractedDrawingCharacteristics } from '@/lib/inspection/types'

import {
  buildExtractPreview,
  buildSheetContext,
  defaultRemoveIds,
  generalBasisByKey,
  inspectionErrorKey,
  planBalloonRequests,
} from './drawingCharacteristicsFlow'

interface UseDrawingCharacteristicsOptions {
  file: LocalFile
  fileId: string | undefined
  /** The version shown (`current` or a version id). */
  version: string
  /** Current view, checked out by me, a drawing. */
  enabled: boolean
  serviceRunning: boolean
  /** Version the running service reports, when known. */
  serviceVersion: string | undefined
  /** The table as it is now. */
  getRows: () => InspectionRowInput[]
  /** Write pending table edits now; false when the save failed. */
  flushPendingSave: () => Promise<boolean>
  /** Replace the table with the merged rows and persist them; false when the save failed. */
  commitMergedRows: (next: InspectionRowInput[]) => Promise<boolean>
}

/** File and version a flow started on. A flow whose scope no longer matches stops silently. */
interface FlowScope {
  fileId: string
  version: string
  filePath: string
}

/** Outcome of reading the drawing and merging it into the table. */
interface MergeOutcome {
  data: ExtractedDrawingCharacteristics
  /** The table before the merge, for Undo. */
  previous: InspectionRowInput[]
  /** The table after it (equal to `previous` when nothing changed). */
  next: InspectionRowInput[]
  changed: boolean
  counts: { added: number; updated: number; removed: number; kept: number }
}

const UNDO_TOAST_MS = 10000

/**
 * The "Extract from drawing" and "Balloon drawing" flows of the Inspection tab. Both run straight
 * through, with no preview or confirm (plan `inspection-tables-system.plan.md`):
 * - Extract reads the drawing, merges it into the table (rows gone from the drawing are removed
 *   by `defaultRemoveIds`, rows on sheets not fully read are kept), saves, and toasts a summary
 *   with Undo.
 * - Balloon does the same merge, then balloons every row linked to the drawing and saves the
 *   drawing.
 */
export function useDrawingCharacteristics({
  file,
  fileId,
  version,
  enabled,
  serviceRunning,
  serviceVersion,
  getRows,
  flushPendingSave,
  commitMergedRows,
}: UseDrawingCharacteristicsOptions) {
  const addToast = usePDMStore((s) => s.addToast)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isBallooning, setIsBallooning] = useState(false)
  // The general tolerance rule behind each row filled from it, from the latest extraction (for
  // the GT marker's tooltip). Not stored: the row keeps only `tolerance_source`.
  const [generalBasis, setGeneralBasis] = useState<Map<string, GeneralToleranceBasis>>(
    () => new Map(),
  )

  const busy = isExtracting || isBallooning

  // The tab is not keyed by file: the same instance shows the next file or version. Flows read
  // this after every await and stop when the user has moved on.
  const liveRef = useRef({ fileId, version, enabled })
  useEffect(() => {
    liveRef.current = { fileId, version, enabled }
  }, [fileId, version, enabled])
  const isCurrent = useCallback(
    (scope: FlowScope) =>
      liveRef.current.fileId === scope.fileId && liveRef.current.version === scope.version,
    [],
  )

  useEffect(() => {
    setGeneralBasis(new Map())
  }, [fileId])

  /** Shared preconditions; toasts the reason and returns false when the flow cannot run. */
  const checkReady = useCallback((): boolean => {
    if (!enabled || !fileId) return false
    if (!serviceRunning) {
      addToast('info', t('source.inspection.extractServiceOffline'))
      return false
    }
    // Both commands arrived in one service release; an older service fails on the first call.
    const feature = checkSwServiceFeature(serviceVersion ?? null, SW_SERVICE_VERSION_NATIVE_INSPECTION)
    if (feature.status === 'incompatible') {
      addToast(
        'error',
        t('source.inspection.serviceTooOld', {
          version: serviceVersion ?? '?',
          required: SW_SERVICE_VERSION_NATIVE_INSPECTION,
        }),
      )
      return false
    }
    if (!hasLocalContent(file)) {
      addToast('info', t('source.inspection.notLocal'))
      return false
    }
    return true
  }, [enabled, fileId, serviceRunning, serviceVersion, file, addToast])

  /** Read the drawing; toasts the failure and returns null (silently when the scope moved on). */
  const extract = useCallback(
    async (scope: FlowScope): Promise<ExtractedDrawingCharacteristics | null> => {
      const result = await window.electronAPI?.solidworks?.extractDrawingCharacteristics(
        scope.filePath,
      )
      if (!isCurrent(scope)) return null
      if (!result?.success || !result.data) {
        const key = inspectionErrorKey(result?.errorCode)
        addToast('error', key ? t(key) : result?.error || t('source.inspection.extractFailed'))
        return null
      }
      if (result.data.skipped.length > 0) {
        log.info('[InspectionTab]', 'Extraction skipped annotations', {
          skipped: result.data.skipped,
        })
      }
      return result.data
    },
    [isCurrent, addToast],
  )

  /**
   * Flush, read the drawing, merge it into the table and save the result. Null when the flow
   * stopped (a toast already says why, or the scope moved on).
   */
  const extractAndMerge = useCallback(
    async (scope: FlowScope): Promise<MergeOutcome | null> => {
      if (!(await flushPendingSave()) || !isCurrent(scope)) return null
      const data = await extract(scope)
      if (!data) return null
      // An empty read removes nothing: it is far more likely a reading problem than a drawing
      // whose every annotation was deleted.
      if (data.characteristics.length === 0) {
        const rows = getRows()
        const counts = { added: 0, updated: 0, removed: 0, kept: 0 }
        return { data, previous: rows, next: rows, changed: false, counts }
      }
      const highest = await getHighestUsedBalloonNumber(scope.fileId)
      if (!isCurrent(scope) || !liveRef.current.enabled) return null
      if (!highest.success) {
        addToast('error', highest.error || t('source.inspection.extractFailed'))
        return null
      }
      const sheetContext = buildSheetContext(data)
      setGeneralBasis(generalBasisByKey(data, sheetContext))
      const previous = getRows()
      const plan = planCharacteristicMerge({
        rows: previous,
        extracted: data.characteristics,
        sheets: data.sheets,
        highestUsedNumber: highest.highest ?? 0,
        skipped: data.skipped,
        sheetContext,
        units: data.units,
        newId: () => crypto.randomUUID(),
      })
      const incompleteSheets = data.incompleteSheets ?? []
      const preview = buildExtractPreview(plan, incompleteSheets)
      const removeIds = defaultRemoveIds(plan, incompleteSheets)
      const counts = {
        added: preview.counts.added,
        updated: preview.counts.updated + preview.counts.adopted,
        removed: removeIds.size,
        kept: plan.missing.length - removeIds.size,
      }
      if (preview.isNoOp) return { data, previous, next: previous, changed: false, counts }
      const next = applyCharacteristicMerge(previous, plan, removeIds)
      if (!(await commitMergedRows(next))) return null
      log.info('[InspectionTab]', 'Drawing merged into the table', {
        ...counts,
        unreadable: preview.counts.unreadable,
        incompleteSheets,
      })
      return { data, previous, next, changed: true, counts }
    },
    [flushPendingSave, isCurrent, extract, addToast, getRows, commitMergedRows],
  )

  /** Undo of an extraction: restores the previous rows unless the table changed since. */
  const undoMerge = useCallback(
    (scope: FlowScope, outcome: MergeOutcome) => {
      if (!isCurrent(scope) || !liveRef.current.enabled) return
      if (getRows() !== outcome.next) {
        addToast('info', t('source.inspection.undoUnavailable'))
        return
      }
      void commitMergedRows(outcome.previous).then((ok) => {
        if (ok) addToast('info', t('source.inspection.extractUndone'))
      })
    },
    [isCurrent, getRows, commitMergedRows, addToast],
  )

  const handleExtract = useCallback(async () => {
    if (busy || !checkReady() || !fileId) return
    const scope: FlowScope = { fileId, version, filePath: file.path }
    setIsExtracting(true)
    try {
      const outcome = await extractAndMerge(scope)
      if (!outcome) return
      if (outcome.data.characteristics.length === 0) {
        addToast('info', t('source.inspection.extractNone'))
        return
      }
      if (!outcome.changed) {
        addToast('info', t('source.inspection.extractUpToDate'))
        return
      }
      const { added, updated, removed, kept } = outcome.counts
      const keptNote = kept > 0 ? ` ${t('source.inspection.extractKeptIncomplete', { count: kept })}` : ''
      addToast(
        'success',
        `${t('source.inspection.extractApplied', { added, updated, removed })}${keptNote}`,
        UNDO_TOAST_MS,
        { label: t('source.inspection.undo'), onClick: () => undoMerge(scope, outcome) },
      )
    } catch (error) {
      log.error('[InspectionTab]', 'Extract from drawing failed', { error: String(error) })
      addToast('error', t('source.inspection.extractFailed'))
    } finally {
      setIsExtracting(false)
    }
  }, [busy, checkReady, fileId, version, file.path, extractAndMerge, undoMerge, addToast])

  const handleBalloon = useCallback(async () => {
    if (busy || !checkReady() || !fileId) return
    const scope: FlowScope = { fileId, version, filePath: file.path }
    setIsBallooning(true)
    try {
      // Rows do not store the persist reference, so the drawing is read again; the same read
      // brings the table up to date first, so every balloon matches the drawing as it is.
      const outcome = await extractAndMerge(scope)
      if (!outcome) return
      if (outcome.changed) {
        const { added, updated, removed } = outcome.counts
        addToast(
          'info',
          t('source.inspection.extractApplied', { added, updated, removed }),
          UNDO_TOAST_MS,
          { label: t('source.inspection.undo'), onClick: () => undoMerge(scope, outcome) },
        )
      }
      const plan = planBalloonRequests(outcome.next, outcome.data.characteristics)
      if (plan.balloons.length === 0) {
        addToast('info', t('source.inspection.balloonNothing'))
        return
      }
      const result = await window.electronAPI?.solidworks?.applyInspectionBalloons(
        scope.filePath,
        plan.balloons,
      )
      if (!isCurrent(scope)) return
      if (!result?.success || !result.data) {
        const key = inspectionErrorKey(result?.errorCode)
        if (key) {
          addToast('error', t(key))
        } else if (result?.data && !result.data.saved) {
          // The balloons went in but the save failed; the service attaches its report.
          log.warn('[InspectionTab]', 'Balloons placed but the drawing was not saved', {
            error: result.error,
            data: result.data,
          })
          addToast('error', t('source.inspection.balloonNotSaved', { placed: result.data.placed }))
        } else {
          addToast('error', result?.error || t('source.inspection.balloonFailed'))
        }
        return
      }
      const { placed, missing, removedPrevious, saved, keptPositions } = result.data
      log.info('[InspectionTab]', 'Balloons applied', {
        placed,
        missing,
        removedPrevious,
        keptPositions,
        saved,
        unkeyed: plan.unkeyed,
      })
      if (!saved) {
        addToast('warning', t('source.inspection.balloonNotSaved', { placed }))
      } else {
        const kept =
          keptPositions > 0
            ? ` ${t('source.inspection.balloonKeptPositions', { count: keptPositions })}`
            : ''
        addToast(
          'success',
          `${t('source.inspection.balloonApplied', { placed, removedPrevious })}${kept}`,
        )
      }
      if (missing.length > 0) {
        addToast('warning', t('source.inspection.balloonMissing', { count: missing.length }))
      }
    } catch (error) {
      log.error('[InspectionTab]', 'Balloon drawing failed', { error: String(error) })
      addToast('error', t('source.inspection.balloonFailed'))
    } finally {
      setIsBallooning(false)
    }
  }, [busy, checkReady, fileId, version, file.path, extractAndMerge, undoMerge, isCurrent, addToast])

  return {
    isExtracting,
    isBallooning,
    busy,
    generalBasis,
    handleExtract,
    handleBalloon,
  }
}
