import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { INSPECTION_BALLOON_ERROR_CODES } from '@/lib/inspection/types'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import {
  AUTO_DEBOUNCE_MS,
  AUTO_OPEN_DELAY_MS,
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
 * Auto keeps an open drawing and its table in sync: when the drawing changes on disk (the watcher
 * updates its modified time or size) it waits `AUTO_DEBOUNCE_MS`, and when a drawing is opened, or
 * Auto turned on or able to run again, it waits `AUTO_OPEN_DELAY_MS`; then it extracts and
 * balloons the drawing if `decideAutoRun` says so. Never while a run is in flight, never on
 * BluePLM's own save (the post-balloon hash is recorded as in sync, and a change within
 * `AUTO_SETTLE_MS` of it is adopted), never on a drawing nothing was read from yet, and after a
 * failure not again until the drawing's content changes or the user retries (`paused`, `retry`).
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
  /**
   * The service keeps matching balloons and does not save a drawing it did not change
   * (`SW_SERVICE_VERSION_INCREMENTAL_BALLOONS`): only then does Auto run on opening a drawing.
   */
  catchUp: boolean
}): { failedHash: string | null; retry: () => void } {
  const addToast = usePDMStore((s) => s.addToast)
  const latest = useRef(options)
  latest.current = options
  const failedHashRef = useRef<string | null>(null)
  // Mirrors failedHashRef for rendering: Auto is paused while the drawing still has this content.
  const [failedHash, setFailedHashState] = useState<string | null>(null)
  const setFailedHash = useCallback((hash: string | null) => {
    failedHashRef.current = hash
    setFailedHashState(hash)
  }, [])
  // An evaluation that outlives the tab (a hash or a run still going) must not start anything.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
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
    if (!mountedRef.current || now.fileId !== fileId || now.file.path !== path) return
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
    if (!mountedRef.current) return
    if (result.ok) {
      setFailedHash(null)
      settleUntilRef.current = Date.now() + AUTO_SETTLE_MS
      return
    }
    if (result.skipped) return
    setFailedHash(currentHash)
    // Unsaved edits open in SOLIDWORKS: not an error, the next save brings Auto back.
    if (result.errorCode === INSPECTION_BALLOON_ERROR_CODES.unsavedChanges) return
    addToast('warning', t('source.inspection.autoPaused'))
  }, [addToast, setFailedHash])
  const evaluateRef = useRef(evaluate)
  evaluateRef.current = evaluate

  const schedule = useCallback(
    (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void evaluate(), delay)
    },
    [evaluate],
  )

  const { file, fileId, autoEnabled, editable, hasLinkedRows, ready, catchUp } = options
  const key = diskKey(file)
  useEffect(() => {
    const seen = seenRef.current
    seenRef.current = { path: file.path, key }
    // A change on disk: wait for the save to settle. The first look is handled below.
    if (!seen || seen.path !== file.path || seen.key === key) return
    schedule(AUTO_DEBOUNCE_MS)
  }, [file.path, key, fileId, schedule])

  // Opening a drawing, turning Auto on, or Auto becoming able to run (checked out, service up,
  // first rows read): bring a drawing that changed while nobody was watching back in sync.
  const canRun = autoEnabled && editable && hasLinkedRows && ready && catchUp
  useEffect(() => {
    if (canRun) schedule(AUTO_OPEN_DELAY_MS)
  }, [canRun, fileId, schedule])

  // A pending run belongs to the drawing it was scheduled for.
  useEffect(() => {
    setFailedHash(null)
    settleUntilRef.current = 0
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [fileId, setFailedHash])

  const retry = useCallback(() => {
    setFailedHash(null)
    schedule(0)
  }, [schedule, setFailedHash])

  return { failedHash, retry }
}
