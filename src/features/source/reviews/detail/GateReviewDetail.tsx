/**
 * A workflow gate waiting on the viewer, in the main area (review UX audit F8). The old sidebar
 * card decided with one click and shared one comment between Kick back and Reject; here the file,
 * the transition and the gate's checklist come first, Approve waits for the required checklist
 * items, each commented decision keeps its own text with a Cancel, and every decision gets the
 * same undo window as package decisions before `submitReviewDecision` sends it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FolderOpen } from 'lucide-react'

import {
  Button,
  Callout,
  EmptyState,
  IconButton,
  RowGroup,
  Section,
  TextArea,
} from '@/components/core/ui'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { registerPendingDecisionFlush } from '@/lib/reviewDecisionFlush'
import { listReviewQueue } from '@/lib/supabase/reviews'
import { submitReviewDecision } from '@/lib/workflows'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewQueueRow } from '@/types/reviews'
import { parseChecklistItems } from '@/types/workflow'

import { describeReviewError } from '../lib/reviewErrors'
import {
  closesAfterSend,
  emptyGateDraft,
  gateSubmitState,
  missingChecks,
  type GateDecision,
  type GateDraft,
} from '../lib/gateDecision'
import { UNDO_WINDOW_MS } from '../lib/pendingDecisions'
import { displayName } from '../lib/reviewState'
import { relativeTime } from '../lib/reviewDates'
import { showFileInVault } from './itemActions'

function useGateRow(gateId: string): {
  row: ReviewQueueRow | null
  loading: boolean
  error: string | null
  retry: () => void
} {
  const refreshTick = usePDMStore((s) => s.reviewQueueRefreshTick)
  const [row, setRow] = useState<ReviewQueueRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listReviewQueue({ bucket: 'awaiting_me', limit: 200 })
      .then((page) => {
        if (cancelled) return
        setRow(page.rows.find((r) => r.kind === 'gate' && r.id === gateId) ?? null)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(describeReviewError(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gateId, refreshTick, tick])
  return { row, loading, error, retry: () => setTick((n) => n + 1) }
}

const DECISIONS: GateDecision[] = ['approved', 'kicked_back', 'rejected']

export function GateReviewDetail({ gateId }: { gateId: string }) {
  const setActiveGateReviewId = usePDMStore((s) => s.setActiveGateReviewId)
  const addToast = usePDMStore((s) => s.addToast)
  const refreshQueue = usePDMStore((s) => s.requestReviewQueueRefresh)
  const { row, loading, error, retry } = useGateRow(gateId)
  const [draft, setDraft] = useState<GateDraft>(emptyGateDraft)
  const [queued, setQueued] = useState<GateDecision | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendRef = useRef<(() => Promise<void>) | null>(null)
  const toastId = useRef<string | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const gate = row?.gate ?? null
  const checklist = useMemo(
    () => parseChecklistItems(gate?.checklistItems ?? []),
    [gate?.checklistItems],
  )

  const back = () => setActiveGateReviewId(null)

  const send = useCallback(
    async (decision: GateDecision, snapshot: GateDraft) => {
      if (!gate) return
      const state = gateSubmitState(snapshot, decision, checklist)
      if (!state.payload) return
      const { data, error: sendError } = await submitReviewDecision(
        gate.pendingReviewId,
        state.payload.decision,
        state.payload.comment,
        state.payload.checklistResponses,
      )
      if (sendError || !data?.success) {
        log.warn('[Reviews]', 'Gate decision failed', {
          error: sendError,
          gate: gate.pendingReviewId,
        })
        addToast('error', sendError?.message ?? data?.error_message ?? t('reviewQueue.gate.failed'))
        setQueued(null)
        return
      }
      addToast(
        'success',
        data.new_state_name
          ? t('reviewQueue.gate.advanced', { state: data.new_state_name })
          : t('reviewQueue.gate.recorded'),
      )
      // A flush on leaving sends after another gate (or nothing) is open: close only this one.
      if (closesAfterSend(usePDMStore.getState().activeGateReviewId, gateId)) {
        setActiveGateReviewId(null)
      }
      refreshQueue()
    },
    [gate, gateId, checklist, addToast, setActiveGateReviewId, refreshQueue],
  )

  // The undo window: queued, then sent when it ends or when this view goes away.
  const queue = (decision: GateDecision) => {
    if (!gate || !gateSubmitState(draft, decision, checklist).payload) return
    const snapshot = draft
    setQueued(decision)
    const fire = () => {
      sendRef.current = null
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      // Sent early (leaving, signing out): its Undo no longer does anything, so it goes.
      if (toastId.current) usePDMStore.getState().removeToast(toastId.current)
      toastId.current = null
      const sending = send(decision, snapshot)
      inFlight.current = sending
      return sending
    }
    sendRef.current = fire
    timer.current = setTimeout(fire, UNDO_WINDOW_MS)
    addToast(
      'info',
      t('reviewDetail.undo.decided', {
        decision: t(`reviewDetail.gateDecided.${decision}`),
        file: displayFileName(gate.fileName),
      }),
      UNDO_WINDOW_MS,
      {
        label: t('reviewDetail.undo.action'),
        onClick: () => {
          if (!sendRef.current) return
          if (timer.current) clearTimeout(timer.current)
          timer.current = null
          sendRef.current = null
          toastId.current = null
          setQueued(null)
        },
      },
    )
    toastId.current = usePDMStore.getState().toasts.at(-1)?.id ?? null
  }
  useEffect(() => () => void sendRef.current?.(), [])
  // Sign-out, an organization switch and closing the window send a queued gate decision first.
  useEffect(
    () =>
      registerPendingDecisionFlush({
        hasPending: () => !!sendRef.current,
        flush: async () => {
          await (sendRef.current?.() ?? inFlight.current ?? Promise.resolve())
        },
      }),
    [],
  )

  if (loading && !row) {
    return (
      <div className="flex-1 bg-ui-bg p-8 text-[14px] text-ui-fg-secondary">
        {t('reviewQueue.loading')}
      </div>
    )
  }
  if (error || !gate || !row) {
    return (
      <div className="flex-1 bg-ui-bg p-8 font-ui">
        <EmptyState
          title={error ? t('reviewDetail.loadError.title') : t('reviewDetail.gate.gone')}
          description={error ?? t('reviewDetail.gate.goneHint')}
          actions={
            <>
              {error && (
                <Button variant="primary" onClick={retry}>
                  {t('reviewDetail.loadError.retry')}
                </Button>
              )}
              <Button onClick={back}>{t('reviewDetail.loadError.back')}</Button>
            </>
          }
        />
      </div>
    )
  }

  const pending = draft.decision
  const missing = missingChecks(checklist, draft.checks)
  const requester = displayName(row.requestedBy)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ui-bg font-ui">
      <div className="flex flex-shrink-0 items-start gap-2 border-b border-ui-border px-4 py-3">
        <IconButton label={t('reviewDetail.back')} icon={<ArrowLeft size={16} />} onClick={back} />
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-[16px] font-semibold leading-7 text-ui-fg"
            title={gate.filePath}
          >
            {displayFileName(gate.fileName)}
          </h2>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ui-fg-secondary">
            <span className="inline-flex items-center gap-1 text-ui-fg">
              {gate.fromStateName}
              <ArrowRight size={12} aria-hidden />
              {gate.toStateName}
            </span>
            <span>· {t('reviewDetail.gate.gateName', { name: gate.gateName })}</span>
            {requester && (
              <span>
                ·{' '}
                {t('reviewDetail.gate.requestedBy', {
                  name: requester,
                  time: relativeTime(row.requestedAt),
                })}
              </span>
            )}
          </p>
        </div>
        <Button icon={<FolderOpen size={14} />} onClick={() => showFileInVault(gate.fileId)}>
          {t('reviewDetail.items.showInVault')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-8">
          <Section
            title={t('reviewDetail.gate.checklist')}
            description={checklist.length === 0 ? t('reviewDetail.gate.checklistEmpty') : undefined}
          >
            {checklist.length > 0 && (
              <RowGroup className="mt-2">
                {checklist.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-3 py-3 text-[14px] text-ui-fg"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ui-accent"
                      checked={!!draft.checks[item.id]}
                      disabled={!!queued}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          checks: { ...d.checks, [item.id]: e.target.checked },
                        }))
                      }
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.required && (
                      <span className="text-[13px] text-ui-fg-secondary">
                        {t('reviewDetail.gate.required')}
                      </span>
                    )}
                  </label>
                ))}
              </RowGroup>
            )}
          </Section>
          <Section title={t('reviewDetail.gate.decision')} className="mt-10">
            <div className="mt-3 space-y-2">
              {queued ? (
                <p className="text-[13px] text-ui-fg-secondary">
                  {t('reviewDetail.bar.sending', {
                    decision: t(`reviewDetail.gateDecided.${queued}`),
                  })}
                </p>
              ) : (
                <>
                  {pending && (
                    <div className="space-y-1.5">
                      <label
                        className="block text-[13px] text-ui-fg-secondary"
                        htmlFor="gate-comment"
                      >
                        {t(`reviewDetail.gatePrompt.${pending}`)}
                      </label>
                      <TextArea
                        id="gate-comment"
                        rows={3}
                        autoFocus
                        value={draft.comments[pending]}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            comments: { ...d.comments, [pending]: e.target.value },
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            queue(pending)
                          } else if (e.key === 'Escape') {
                            e.stopPropagation()
                            setDraft((d) => ({ ...d, decision: null }))
                          }
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-[12px] text-ui-fg-tertiary">
                          {t('reviewDetail.decision.sendHint')}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDraft((d) => ({ ...d, decision: null }))}
                        >
                          {t('reviewQueue.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant={pending === 'rejected' ? 'danger' : 'primary'}
                          disabled={!!gateSubmitState(draft, pending, checklist).blocker}
                          onClick={() => queue(pending)}
                        >
                          {t(
                            `reviewQueue.gate.${pending === 'approved' ? 'approve' : pending === 'kicked_back' ? 'kickBack' : 'reject'}`,
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                  {!pending && (
                    <div className="flex flex-wrap items-center gap-2">
                      {DECISIONS.map((decision) => (
                        <Button
                          key={decision}
                          variant={
                            decision === 'approved'
                              ? 'primary'
                              : decision === 'rejected'
                                ? 'danger-subtle'
                                : 'secondary'
                          }
                          disabled={decision === 'approved' && missing.length > 0}
                          onClick={() =>
                            decision === 'approved'
                              ? queue('approved')
                              : setDraft((d) => ({ ...d, decision }))
                          }
                        >
                          {t(
                            `reviewQueue.gate.${decision === 'approved' ? 'approve' : decision === 'kicked_back' ? 'kickBack' : 'reject'}`,
                          )}
                        </Button>
                      ))}
                      {missing.length > 0 && (
                        <span className="text-[13px] text-ui-fg-secondary">
                          {t('reviewDetail.gateBlocker.checklist_incomplete')}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
              {pending &&
                gateSubmitState(draft, pending, checklist).blocker === 'checklist_incomplete' && (
                  <Callout tone="warning">
                    {t('reviewDetail.gateBlocker.checklist_incomplete')}
                  </Callout>
                )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
