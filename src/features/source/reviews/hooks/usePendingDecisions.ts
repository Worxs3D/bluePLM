/**
 * The undo window around review decisions (`lib/pendingDecisions.ts` holds the rules). A decision
 * is queued with an Undo toast and sent when its window ends, when the next decision is made, or
 * when the review leaves the screen: never dropped. A failed send toasts the error and gives the
 * item back (it is still owed on the server).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  notifyPendingReviewDecisionsChanged,
  registerPendingDecisionFlush,
} from '@/lib/reviewDecisionFlush'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewDecision } from '@/types/reviews'

import {
  UNDO_WINDOW_MS,
  cancelDecision,
  decisionsToSend,
  enqueueDecision,
  expireDecisions,
  flushDecisions,
  settleSending,
  type PendingDecision,
} from '../lib/pendingDecisions'

export interface PendingDecisionsApi {
  /** Waiting in the window. */
  queue: PendingDecision[]
  /** Item ids being sent right now. */
  sending: ReadonlySet<string>
  /** What each item in `sending` is being sent as (the list and bar keep showing it). */
  sendingDecisions: ReadonlyMap<string, ReviewDecision>
  /** Queue a decision; `label` is the toast text. */
  queueDecision: (entry: Omit<PendingDecision, 'id' | 'queuedAt'>, label: string) => void
  /** Send everything now (before navigating away). */
  flush: () => void
  /** Send everything now and wait for it (before signing out or closing the window). */
  flushAndWait: () => Promise<void>
}

interface Options {
  /** The items the server still lists as owed (the last detail load). */
  owedOnServer: ReadonlySet<string>
  send: (entry: PendingDecision) => Promise<void>
  /** After a send went through (reload the detail and queue). */
  onSent: (entry: PendingDecision) => void
  /** Undo was pressed: go back to the item with its comment. */
  onUndone: (entry: PendingDecision) => void
  /** The send failed; the item is owed again. */
  onFailed: (entry: PendingDecision, error: unknown) => void
}

let nextId = 0

/** A send that went through but whose reload never came: stop showing it as sending after this. */
const SENT_FALLBACK_MS = 10_000

export function usePendingDecisions({
  owedOnServer,
  send,
  onSent,
  onUndone,
  onFailed,
}: Options): PendingDecisionsApi {
  const [queue, setQueue] = useState<PendingDecision[]>([])
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set())
  const queueRef = useRef<PendingDecision[]>([])
  const toastIds = useRef(new Map<string, string>())
  const callbacks = useRef({ send, onSent, onUndone, onFailed })
  callbacks.current = { send, onSent, onUndone, onFailed }

  const setBoth = (next: PendingDecision[]) => {
    queueRef.current = next
    setQueue(next)
    // The desktop's quit handshake reports this window as holding decisions (or not).
    notifyPendingReviewDecisionsChanged()
  }

  const dropToast = (entryId: string) => {
    const toastId = toastIds.current.get(entryId)
    if (toastId) usePDMStore.getState().removeToast(toastId)
    toastIds.current.delete(entryId)
  }

  /** Sent ids waiting for a reload that no longer lists them as owed. */
  const sent = useRef(new Set<string>())
  const owedRef = useRef(owedOnServer)
  owedRef.current = owedOnServer
  const inFlight = useRef(new Set<Promise<void>>())
  /** The decision each dispatched item was sent as. */
  const sentAs = useRef(new Map<string, ReviewDecision>())

  const forget = useCallback((ids: readonly string[]) => {
    for (const id of ids) sent.current.delete(id)
    setSending((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])

  // A reload landed: what it no longer lists as owed has been decided on the server.
  useEffect(() => {
    setSending((prev) => {
      const next = settleSending(prev, owedOnServer, sent.current)
      for (const id of sent.current) if (!next.has(id)) sent.current.delete(id)
      return next.size === prev.size ? prev : next
    })
  }, [owedOnServer])

  const dispatch = useCallback(
    (entries: PendingDecision[]) => {
      for (const entry of entries) {
        dropToast(entry.id)
        for (const d of decisionsToSend(entry)) sentAs.current.set(d.itemId, d.decision)
        setSending((prev) => new Set([...prev, ...entry.itemIds]))
        const run = callbacks.current
          .send(entry)
          .then(() => {
            for (const id of entry.itemIds) sent.current.add(id)
            setSending((prev) => settleSending(prev, owedRef.current, sent.current))
            setTimeout(() => forget(entry.itemIds.filter((id) => sent.current.has(id))), SENT_FALLBACK_MS)
            callbacks.current.onSent(entry)
          })
          .catch((error: unknown) => {
            log.warn('[Reviews]', 'Sending a review decision failed', {
              error,
              reviewId: entry.reviewId,
            })
            // Still owed on the server: give the items back at once.
            forget(entry.itemIds)
            callbacks.current.onFailed(entry, error)
          })
          .finally(() => {
            inFlight.current.delete(run)
            notifyPendingReviewDecisionsChanged()
          })
        inFlight.current.add(run)
        notifyPendingReviewDecisionsChanged()
      }
    },
    [forget],
  )

  const undo = useCallback((entryId: string) => {
    const { queue: rest, cancelled } = cancelDecision(queueRef.current, entryId)
    if (!cancelled) return
    setBoth(rest)
    dropToast(entryId)
    callbacks.current.onUndone(cancelled)
  }, [])

  const queueDecision = useCallback(
    (entry: Omit<PendingDecision, 'id' | 'queuedAt'>, label: string) => {
      const full: PendingDecision = { ...entry, id: `decision-${++nextId}`, queuedAt: Date.now() }
      const step = enqueueDecision(queueRef.current, full)
      setBoth(step.queue)
      dispatch(step.toSend)
      const store = usePDMStore.getState()
      store.addToast('info', label, UNDO_WINDOW_MS, {
        label: t('reviewDetail.undo.action'),
        onClick: () => undo(full.id),
      })
      const added = usePDMStore.getState().toasts.at(-1)
      if (added) toastIds.current.set(full.id, added.id)
    },
    [dispatch, undo],
  )

  // The window: check once a second-ish while anything waits.
  useEffect(() => {
    if (queue.length === 0) return
    const soonest = Math.min(...queue.map((e) => e.queuedAt + UNDO_WINDOW_MS))
    const handle = setTimeout(
      () => {
        const step = expireDecisions(queueRef.current, Date.now())
        if (step.toSend.length === 0) return
        // Dispatch first, so the window never looks clear between leaving the queue and the send.
        dispatch(step.toSend)
        setBoth(step.queue)
      },
      Math.max(0, soonest - Date.now()),
    )
    return () => clearTimeout(handle)
  }, [queue, dispatch])

  const flush = useCallback(() => {
    const step = flushDecisions(queueRef.current)
    if (step.toSend.length === 0) return
    dispatch(step.toSend)
    setBoth(step.queue)
  }, [dispatch])

  const flushAndWait = useCallback(async () => {
    flush()
    await Promise.allSettled([...inFlight.current])
  }, [flush])

  // Unmount (the review closed, another opened, the view changed): send, never drop.
  useEffect(() => () => flush(), [flush])

  // Sign-out, an organization switch and closing the window wait for queued decisions first
  // (`flushPendingReviewDecisions`), while the session that made them is still signed in.
  useEffect(
    () =>
      registerPendingDecisionFlush({
        flush: flushAndWait,
        hasPending: () => queueRef.current.length > 0 || inFlight.current.size > 0,
      }),
    [flushAndWait],
  )

  const sendingDecisions = useMemo(() => {
    const map = new Map<string, ReviewDecision>()
    for (const id of sending) {
      const decision = sentAs.current.get(id)
      if (decision) map.set(id, decision)
    }
    return map
  }, [sending])

  return { queue, sending, sendingDecisions, queueDecision, flush, flushAndWait }
}
