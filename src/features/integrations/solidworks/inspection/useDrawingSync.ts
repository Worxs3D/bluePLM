import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { INSPECTION_BALLOON_ERROR_CODES } from '@/lib/inspection/types'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import {
  AUTO_DEBOUNCE_MS,
  AUTO_SETTLE_MS,
  clearExtract,
  decideAutoRun,
  drawingSyncStatus,
  recordBalloon,
  recordExtract,
  type DrawingSyncStatus,
} from './drawingSync'
import type { DrawingSyncRecorder, FlowOptions, FlowResult } from './useDrawingCharacteristics'

async function hashFile(filePath: string): Promise<string | null> {
  try {
    const result = await window.electronAPI?.hashFile(filePath)
    return result?.success && result.hash ? result.hash : null
  } catch (error) {
    log.warn('[InspectionTab]', 'Could not hash the drawing', { error: String(error) })
    return null
  }
}

/** The file as it is on disk, for "did it change" (modified time and size, then the hash). */
const diskKey = (file: LocalFile) => `${file.path}|${file.modifiedTime}|${file.size}`

/**
 * Change detection for Extract / Balloon (`drawingSync.ts`): the drawing's current hash (taken
 * again only when its modified time or size moves), its status against the stamp recorded per
 * file in the UI slice, and the recorder the flows write through.
 */
export function useDrawingSync(options: {
  file: LocalFile
  fileId: string | undefined
  /** Only a drawing the user can extract from is hashed. */
  enabled: boolean
  serviceVersion: string | undefined
}) {
  const { file, fileId, enabled, serviceVersion } = options
  const stamp = usePDMStore((s) => (fileId ? s.inspectionDrawingSync[fileId] : undefined))
  const update = usePDMStore((s) => s.updateInspectionDrawingSync)
  const [hashed, setHashed] = useState<{ key: string; hash: string | null } | null>(null)
  const key = diskKey(file)
  const version = serviceVersion ?? null

  useEffect(() => {
    if (!enabled || hashed?.key === key) return
    let cancelled = false
    void hashFile(file.path).then((hash) => {
      if (!cancelled) setHashed({ key, hash })
    })
    return () => {
      cancelled = true
    }
  }, [enabled, key, file.path, hashed?.key])

  const currentHash = hashed?.key === key ? hashed.hash : null

  const status: DrawingSyncStatus = useMemo(
    () => drawingSyncStatus(stamp, currentHash, version),
    [stamp, currentHash, version],
  )

  const recorder: DrawingSyncRecorder = useMemo(
    () => ({
      hashNow: hashFile,
      recordExtract: (id, hash) => update((s) => recordExtract(s, id, hash, version, Date.now())),
      recordBalloon: (id, hash) => update((s) => recordBalloon(s, id, hash, version, Date.now())),
      clearExtract: (id) => update((s) => clearExtract(s, id, Date.now())),
    }),
    [update, version],
  )

  return { status, currentHash, stamp, recorder }
}

/**
 * Auto: when the open drawing changes on disk (the watcher updates its modified time or size),
 * wait `AUTO_DEBOUNCE_MS`, then extract and balloon it if `decideAutoRun` says so. Never on
 * opening the tab, never while a run is in flight, never on BluePLM's own save (the post-balloon
 * hash is recorded as in sync, and a change within `AUTO_SETTLE_MS` of it is adopted), and after
 * a failure not again until the drawing's content changes.
 */
export function useAutoInspection(options: {
  file: LocalFile
  fileId: string | undefined
  autoEnabled: boolean
  editable: boolean
  hasLinkedRows: boolean
  ready: boolean
  serviceVersion: string | undefined
  isInFlight: () => boolean
  recorder: DrawingSyncRecorder
  runBalloon: (options: FlowOptions) => Promise<FlowResult>
}): void {
  const addToast = usePDMStore((s) => s.addToast)
  const latest = useRef(options)
  latest.current = options
  const failedHashRef = useRef<string | null>(null)
  const settleUntilRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenRef = useRef<{ path: string; key: string } | null>(null)

  const evaluate = useCallback(async () => {
    timerRef.current = null
    const o = latest.current
    if (!o.fileId) return
    const fileId = o.fileId
    const path = o.file.path
    const currentHash = o.autoEnabled && o.editable ? await o.recorder.hashNow(path) : null
    const now = latest.current
    if (now.fileId !== fileId || now.file.path !== path) return
    const decision = decideAutoRun({
      autoEnabled: now.autoEnabled,
      editable: now.editable,
      hasLinkedRows: now.hasLinkedRows,
      ready: now.ready,
      inFlight: now.isInFlight(),
      currentHash,
      stamp: usePDMStore.getState().inspectionDrawingSync[fileId],
      serviceVersion: now.serviceVersion ?? null,
      failedHash: failedHashRef.current,
      settleUntil: settleUntilRef.current,
      now: Date.now(),
    })
    if (decision.action === 'skip') {
      log.debug('[InspectionTab]', 'Auto skipped', { reason: decision.reason })
      // A change made while a run was going is looked at again once it is done.
      if (decision.reason === 'inFlight' && !timerRef.current) {
        timerRef.current = setTimeout(() => void evaluateRef.current(), AUTO_DEBOUNCE_MS)
      }
      return
    }
    if (!currentHash) return
    if (decision.action === 'adopt') {
      log.info('[InspectionTab]', 'Auto adopted a change right after its own save as in sync')
      now.recorder.recordBalloon(fileId, currentHash)
      return
    }
    log.info('[InspectionTab]', 'Auto extract and balloon', { fileId })
    const result = await now.runBalloon({ auto: true })
    if (result.ok) {
      failedHashRef.current = null
      settleUntilRef.current = Date.now() + AUTO_SETTLE_MS
      return
    }
    if (result.skipped) return
    failedHashRef.current = currentHash
    // Unsaved edits open in SOLIDWORKS: not an error, the next save brings Auto back.
    if (result.errorCode === INSPECTION_BALLOON_ERROR_CODES.unsavedChanges) return
    addToast('warning', t('source.inspection.autoPaused'))
  }, [addToast])
  const evaluateRef = useRef(evaluate)
  evaluateRef.current = evaluate

  const { file, fileId } = options
  const key = diskKey(file)
  useEffect(() => {
    const seen = seenRef.current
    seenRef.current = { path: file.path, key }
    // The first look at a drawing (opening the tab, switching files) is not a change.
    if (!seen || seen.path !== file.path || seen.key === key) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void evaluate(), AUTO_DEBOUNCE_MS)
  }, [file.path, key, fileId, evaluate])

  // A pending run belongs to the drawing it was scheduled for.
  useEffect(() => {
    failedHashRef.current = null
    settleUntilRef.current = 0
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [fileId])
}
