import { useState, useCallback, useEffect, useRef } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import { getHighestUsedBalloonNumber, type InspectionRowInput } from '@/lib/supabase'
import { hasLocalContent } from '@/lib/fileOperations/assemblyResolver'
import { checkSwServiceFeature, SW_SERVICE_VERSION_NATIVE_INSPECTION } from '@/lib/swServiceVersion'
import {
  applyCharacteristicMerge,
  planCharacteristicMerge,
} from '@/lib/inspection/characteristicMerge'
import type { GeneralToleranceBasis } from '@/lib/inspection/generalTolerance'
import {
  INSPECTION_BALLOON_ERROR_CODES,
  type ExtractedDrawingCharacteristics,
} from '@/lib/inspection/types'

import {
  buildExtractPreview,
  buildSheetContext,
  defaultRemoveIds,
  generalBasisByKey,
  inspectionErrorKey,
  planBalloonRequests,
} from './drawingCharacteristicsFlow'
import { balloonOutcome } from './balloonOutcome'

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
  /** Records what each successful run saw, for change detection (`useDrawingSync`). */
  sync: DrawingSyncRecorder
}

/** The change-detection side of the flows (see `drawingSync.ts`). */
export interface DrawingSyncRecorder {
  /** Content hash of the file now; null when it cannot be read. */
  hashNow: (filePath: string) => Promise<string | null>
  recordExtract: (fileId: string, hash: string) => void
  recordBalloon: (fileId: string, hashAfter: string) => void
  clearExtract: (fileId: string) => void
}

/** Options of one run. `auto`: started by Auto, so "nothing to do" stays quiet. */
export interface FlowOptions {
  auto?: boolean
}

/** Outcome of one run: `ok` false with the service's error code when it failed. */
export type FlowResult = { ok: true } | { ok: false; errorCode?: string; skipped?: boolean }

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
  sync,
}: UseDrawingCharacteristicsOptions) {
  const addToast = usePDMStore((s) => s.addToast)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isBallooning, setIsBallooning] = useState(false)
  // Set synchronously, so Auto and a click in the same tick never start two runs.
  const inFlightRef = useRef(false)
  // Error code of the latest failure inside a run (the toast already said why).
  const lastErrorCodeRef = useRef<string | undefined>(undefined)
  // While Auto runs, an unsaved-changes refusal is not an error: Auto waits for the next save.
  const quietUnsavedRef = useRef(false)
  const toastError = useCallback(
    (errorCode: string | undefined, message: string) => {
      lastErrorCodeRef.current = errorCode
      if (quietUnsavedRef.current && errorCode === INSPECTION_BALLOON_ERROR_CODES.unsavedChanges) {
        return
      }
      addToast('error', message)
    },
    [addToast],
  )
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
    const feature = checkSwServiceFeature(
      serviceVersion ?? null,
      SW_SERVICE_VERSION_NATIVE_INSPECTION,
    )
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
        toastError(
          result?.errorCode,
          key ? t(key) : result?.error || t('source.inspection.extractFailed'),
        )
        return null
      }
      if (result.data.skipped.length > 0) {
        log.info('[InspectionTab]', 'Extraction skipped annotations', {
          skipped: result.data.skipped,
        })
      }
      return result.data
    },
    [isCurrent, toastError],
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
        if (!ok) return
        // The table no longer matches the drawing: Extract is offered again.
        sync.clearExtract(scope.fileId)
        addToast('info', t('source.inspection.extractUndone'))
      })
    },
    [isCurrent, getRows, commitMergedRows, addToast, sync],
  )

  /** Claim the single run slot; false when a run is already going or the flow cannot run. */
  const begin = useCallback((): boolean => {
    if (inFlightRef.current || !checkReady() || !fileId) return false
    inFlightRef.current = true
    lastErrorCodeRef.current = undefined
    return true
  }, [checkReady, fileId])

  const failed = useCallback(
    (): FlowResult => ({ ok: false, errorCode: lastErrorCodeRef.current }),
    [],
  )

  const handleExtract = useCallback(
    async (options: FlowOptions = {}): Promise<FlowResult> => {
      if (!fileId || !begin()) return { ok: false, skipped: true }
      const scope: FlowScope = { fileId, version, filePath: file.path }
      quietUnsavedRef.current = !!options.auto
      setIsExtracting(true)
      try {
        // Hashed before the read: a save during the read leaves the drawing "changed".
        const hashBefore = await sync.hashNow(scope.filePath)
        const outcome = await extractAndMerge(scope)
        if (!outcome) return failed()
        if (hashBefore && isCurrent(scope)) sync.recordExtract(scope.fileId, hashBefore)
        if (outcome.data.characteristics.length === 0) {
          if (!options.auto) addToast('info', t('source.inspection.extractNone'))
          return { ok: true }
        }
        if (!outcome.changed) {
          if (!options.auto) addToast('info', t('source.inspection.extractUpToDate'))
          return { ok: true }
        }
        const { added, updated, removed, kept } = outcome.counts
        const keptNote =
          kept > 0 ? ` ${t('source.inspection.extractKeptIncomplete', { count: kept })}` : ''
        addToast(
          'success',
          `${t('source.inspection.extractApplied', { added, updated, removed })}${keptNote}`,
          UNDO_TOAST_MS,
          { label: t('source.inspection.undo'), onClick: () => undoMerge(scope, outcome) },
        )
        return { ok: true }
      } catch (error) {
        log.error('[InspectionTab]', 'Extract from drawing failed', { error: String(error) })
        addToast('error', t('source.inspection.extractFailed'))
        return { ok: false }
      } finally {
        quietUnsavedRef.current = false
        inFlightRef.current = false
        setIsExtracting(false)
      }
    },
    [
      begin,
      failed,
      fileId,
      version,
      file.path,
      sync,
      extractAndMerge,
      isCurrent,
      undoMerge,
      addToast,
    ],
  )

  const handleBalloon = useCallback(
    async (options: FlowOptions = {}): Promise<FlowResult> => {
      if (!fileId || !begin()) return { ok: false, skipped: true }
      const scope: FlowScope = { fileId, version, filePath: file.path }
      quietUnsavedRef.current = !!options.auto
      setIsBallooning(true)
      try {
        const hashBefore = await sync.hashNow(scope.filePath)
        // Rows do not store the persist reference, so the drawing is read again; the same read
        // brings the table up to date first, so every balloon matches the drawing as it is.
        const outcome = await extractAndMerge(scope)
        if (!outcome) return failed()
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
          // Nothing to balloon, and the drawing was not touched: it is in sync as it is.
          if (hashBefore && isCurrent(scope)) sync.recordBalloon(scope.fileId, hashBefore)
          if (!options.auto) addToast('info', t('source.inspection.balloonNothing'))
          return { ok: true }
        }
        const result = await window.electronAPI?.solidworks?.applyInspectionBalloons(
          scope.filePath,
          plan.balloons,
        )
        if (!isCurrent(scope)) return { ok: false, skipped: true }
        if (!result?.success || !result.data) {
          const key = inspectionErrorKey(result?.errorCode)
          if (key) {
            toastError(result?.errorCode, t(key))
          } else if (result?.data && !result.data.saved) {
            // The balloons went in but the save failed; the service attaches its report.
            log.warn('[InspectionTab]', 'Balloons placed but the drawing was not saved', {
              error: result.error,
              data: result.data,
            })
            toastError(
              result?.errorCode,
              t('source.inspection.balloonNotSaved', { placed: result.data.placed }),
            )
          } else {
            toastError(result?.errorCode, result?.error || t('source.inspection.balloonFailed'))
          }
          return failed()
        }
        const { placed, missing, removedPrevious, saved, keptPositions, kept, unchanged } =
          result.data
        log.info('[InspectionTab]', 'Balloons applied', {
          placed,
          missing,
          removedPrevious,
          keptPositions,
          kept,
          unchanged,
          saved,
          unkeyed: plan.unkeyed,
          auto: !!options.auto,
        })
        const reply = balloonOutcome(result.data, !!options.auto)
        const showToasts = () => {
          for (const toast of reply.toasts) {
            addToast(
              toast.kind,
              toast.parts.map((p) => t(`source.inspection.${p.key}`, p.values)).join(' '),
            )
          }
        }
        if (reply.status === 'notSaved') {
          showToasts()
          return { ok: false }
        }
        // The service's own save (or, from service 1.29.0, the untouched file when nothing had to
        // change) is the new in-sync state, so it never reads as a change.
        const hashAfter = await sync.hashNow(scope.filePath)
        if (hashAfter && isCurrent(scope)) sync.recordBalloon(scope.fileId, hashAfter)
        showToasts()
        return { ok: true }
      } catch (error) {
        log.error('[InspectionTab]', 'Balloon drawing failed', { error: String(error) })
        addToast('error', t('source.inspection.balloonFailed'))
        return { ok: false }
      } finally {
        quietUnsavedRef.current = false
        inFlightRef.current = false
        setIsBallooning(false)
      }
    },
    [
      begin,
      failed,
      fileId,
      version,
      file.path,
      sync,
      extractAndMerge,
      undoMerge,
      isCurrent,
      addToast,
      toastError,
    ],
  )

  return {
    isExtracting,
    isBallooning,
    busy,
    /** True from the moment a run is claimed (before React state catches up). */
    isInFlight: () => inFlightRef.current,
    generalBasis,
    handleExtract,
    handleBalloon,
  }
}
