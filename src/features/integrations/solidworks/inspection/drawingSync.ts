/**
 * Change detection for a drawing's "Extract from drawing" and "Balloon drawing", and the decision
 * whether the Inspection tab's Auto mode runs them. Pure: the hook `useDrawingSync` feeds it.
 *
 * The signal is the drawing's content hash (`hashFile`, streamed in the main process), recorded
 * per file after each successful run:
 * - Extract records the hash it read. Extract is offered again when the file's hash differs.
 * - Balloon extracts first and then saves the drawing, so it records the hash after its own save
 *   as both the extracted and the ballooned state: its own save never reads as a change.
 * - A different service version counts as a change (it may read the drawing differently).
 * - A drawing never extracted counts as changed.
 * The hash is taken only when the file's modified time or size moved, so an unchanged drawing is
 * not hashed again on every render.
 */

import type { InspectionDrawingSyncStamp } from '@/stores/types'

/** What BluePLM last did to one drawing, on this machine (persisted in the UI slice). */
export type DrawingSyncStamp = InspectionDrawingSyncStamp

export type DrawingSyncStamps = Record<string, DrawingSyncStamp>

/** Stamps kept per machine; the oldest go first. */
export const MAX_DRAWING_SYNC_STAMPS = 500

/**
 * Why a flow is (or is not) offered:
 * - `never`: no run recorded for this drawing
 * - `changed`: the drawing's content differs from the last run
 * - `service`: the last run was made by another service version
 * - `unknown`: the current hash is not known yet (still hashing, or hashing failed)
 * - `inSync`: nothing changed since the last run; the button is disabled
 */
export type DrawingSyncReason = 'never' | 'changed' | 'service' | 'unknown' | 'inSync'

export interface DrawingSyncStatus {
  extract: DrawingSyncReason
  balloon: DrawingSyncReason
}

function reasonFor(
  recorded: string | null,
  stamp: DrawingSyncStamp | undefined,
  currentHash: string | null,
  serviceVersion: string | null,
): DrawingSyncReason {
  if (!stamp || !recorded) return 'never'
  if (!currentHash) return 'unknown'
  if (recorded !== currentHash) return 'changed'
  if (serviceVersion && stamp.serviceVersion && stamp.serviceVersion !== serviceVersion) {
    return 'service'
  }
  return 'inSync'
}

export function drawingSyncStatus(
  stamp: DrawingSyncStamp | undefined,
  currentHash: string | null,
  serviceVersion: string | null,
): DrawingSyncStatus {
  return {
    extract: reasonFor(stamp?.extractHash ?? null, stamp, currentHash, serviceVersion),
    balloon: reasonFor(stamp?.balloonHash ?? null, stamp, currentHash, serviceVersion),
  }
}

/** A flow is offered unless nothing changed since its last run. */
export function isOffered(reason: DrawingSyncReason): boolean {
  return reason !== 'inSync'
}

/** Keep at most `max` stamps, dropping the least recently written. */
export function boundStamps(
  stamps: DrawingSyncStamps,
  max = MAX_DRAWING_SYNC_STAMPS,
): DrawingSyncStamps {
  const ids = Object.keys(stamps)
  if (ids.length <= max) return stamps
  const keep = ids.sort((a, b) => stamps[b].at - stamps[a].at).slice(0, max)
  const next: DrawingSyncStamps = {}
  for (const id of keep) next[id] = stamps[id]
  return next
}

/** After a successful extraction of the drawing at `hash`. */
export function recordExtract(
  stamps: DrawingSyncStamps,
  fileId: string,
  hash: string,
  serviceVersion: string | null,
  now: number,
): DrawingSyncStamps {
  const prev = stamps[fileId]
  return boundStamps({
    ...stamps,
    [fileId]: {
      extractHash: hash,
      // An unchanged drawing keeps its balloons in sync; a changed one never had them.
      balloonHash: prev?.balloonHash === hash ? hash : null,
      serviceVersion,
      at: now,
    },
  })
}

/** After a successful balloon run whose save left the drawing at `hashAfter`. */
export function recordBalloon(
  stamps: DrawingSyncStamps,
  fileId: string,
  hashAfter: string,
  serviceVersion: string | null,
  now: number,
): DrawingSyncStamps {
  return boundStamps({
    ...stamps,
    [fileId]: { extractHash: hashAfter, balloonHash: hashAfter, serviceVersion, at: now },
  })
}

/** An extraction was undone: the table no longer matches the drawing. */
export function clearExtract(
  stamps: DrawingSyncStamps,
  fileId: string,
  now: number,
): DrawingSyncStamps {
  const prev = stamps[fileId]
  if (!prev || prev.extractHash === null) return stamps
  return { ...stamps, [fileId]: { ...prev, extractHash: null, at: now } }
}

/** Debounce after the last change on disk before Auto runs. */
export const AUTO_DEBOUNCE_MS = 2500

/**
 * After BluePLM's own balloon save, a change seen this soon is taken as that save (a late second
 * write) and adopted as in sync instead of starting another run: Auto never loops on itself.
 */
export const AUTO_SETTLE_MS = 5000

export interface AutoRunInput {
  autoEnabled: boolean
  /** Live table of a drawing checked out by this user. */
  editable: boolean
  /** The table has rows read from this drawing: Auto never starts inspecting a drawing on its own. */
  hasLinkedRows: boolean
  /** Service running and new enough, file present locally. */
  ready: boolean
  /** An extract or balloon run (manual or auto) is in progress. */
  inFlight: boolean
  /** Hash of the drawing now; null when not known. */
  currentHash: string | null
  stamp: DrawingSyncStamp | undefined
  serviceVersion: string | null
  /** Hash at which the last auto run failed; Auto waits for a different one. */
  failedHash: string | null
  /** Epoch ms until which a change is attributed to BluePLM's own save (0 = none). */
  settleUntil: number
  now: number
}

export type AutoRunDecision =
  | { action: 'run' }
  | { action: 'adopt' }
  | {
      action: 'skip'
      reason:
        | 'off'
        | 'notEditable'
        | 'notStarted'
        | 'notReady'
        | 'inFlight'
        | 'unknown'
        | 'inSync'
        | 'failed'
    }

/** Whether a change on disk starts extract + balloon. */
export function decideAutoRun(input: AutoRunInput): AutoRunDecision {
  if (!input.autoEnabled) return { action: 'skip', reason: 'off' }
  if (!input.editable) return { action: 'skip', reason: 'notEditable' }
  if (!input.hasLinkedRows) return { action: 'skip', reason: 'notStarted' }
  if (!input.ready) return { action: 'skip', reason: 'notReady' }
  if (input.inFlight) return { action: 'skip', reason: 'inFlight' }
  if (!input.currentHash) return { action: 'skip', reason: 'unknown' }
  const status = drawingSyncStatus(input.stamp, input.currentHash, input.serviceVersion)
  if (status.balloon === 'inSync') return { action: 'skip', reason: 'inSync' }
  if (input.failedHash === input.currentHash) return { action: 'skip', reason: 'failed' }
  // Only a drawing BluePLM has ballooned before can have a late second write of its own save.
  if (status.balloon === 'changed' && input.now < input.settleUntil) return { action: 'adopt' }
  return { action: 'run' }
}

/** Tooltip key for a disabled or enabled Extract / Balloon button. */
export function syncReasonKey(flow: 'extract' | 'balloon', reason: DrawingSyncReason): string {
  if (reason === 'inSync') {
    return flow === 'extract'
      ? 'source.inspection.extractUpToDateTitle'
      : 'source.inspection.balloonUpToDateTitle'
  }
  return flow === 'extract' ? 'source.inspection.extractTitle' : 'source.inspection.balloonTitle'
}
