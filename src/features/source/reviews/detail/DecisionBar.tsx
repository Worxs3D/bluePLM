/**
 * Decide the current file: Approve, Approve with comments, Request changes, Reject, and Approve
 * remaining. A comment is required for every decision except Approve. Nothing is sent from here:
 * the pane queues each decision in the undo window (`usePendingDecisions`), so a stray key never
 * sends an irreversible decision (review UX audit F1).
 *
 * When the viewer cannot decide this file the buttons give way to one line saying why
 * (`decisionBarState`), and when they owe nothing more, to "Next review" (F15).
 *
 * Keyboard (registry `reviews.*`, rebindable): A approves, Shift+A / C / R open the comment box,
 * Ctrl+Enter sends a comment, Escape closes it. J / K belong to the detail pane.
 */

import { useEffect, useRef, useState } from 'react'

import { Button, TextArea } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { useShortcutLabel, useShortcuts, type ShortcutHandler } from '@/lib/keybindings'
import type { ReviewDecision } from '@/types/reviews'

import {
  describeDecisionBarState,
  prefilledDecisionComment,
  type DecisionBarState,
} from '../lib/decisionState'
import { restoreApplies, type DecisionRestore } from '../lib/pendingDecisions'

type Pending = ReviewDecision | 'approve_all'

const COMMENTED: ReadonlySet<Pending> = new Set<Pending>([
  'approved_with_comments',
  'changes_requested',
  'rejected',
])

interface DecisionBarProps {
  /** The file this bar decides: an undone decision reopens only on its own file. */
  itemId: string
  state: DecisionBarState
  /** "bracket.slddrw · v5" */
  context: string
  /** "You decide 4 of 12" */
  moveText: string | null
  /** Files the viewer still owes across the review (after queued decisions). */
  owedCount: number
  /** The viewer's open comments on this file this round (prefills Request changes / Reject). */
  myOpenComments: number
  /** The viewer owes nothing more here and is a reviewer: offer the next review. */
  done: { waiting: number; onNext: (() => void) | null; onBack: () => void } | null
  restore: DecisionRestore | null
  onDecide: (decision: ReviewDecision, comment: string | null) => void
  onApproveAll: (comment: string | null) => void
}

/** Below this width the key hints go, so the four decisions stay on one line. */
const COMPACT_BAR_PX = 520

function KeyHint({ id }: { id: Parameters<typeof useShortcutLabel>[0] }) {
  const label = useShortcutLabel(id)
  return label ? (
    <span className="text-[12px] font-normal opacity-60 group-data-[compact=true]/bar:hidden">
      {label}
    </span>
  ) : null
}

export function DecisionBar({
  itemId,
  state,
  context,
  moveText,
  owedCount,
  myOpenComments,
  done,
  restore,
  onDecide,
  onApproveAll,
}: DecisionBarProps) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [comment, setComment] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const canDecide = state.kind === 'decide'

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT_BAR_PX))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const open = (decision: Pending) => {
    setPending(decision)
    setComment(decision === 'approve_all' ? '' : prefilledDecisionComment(decision, myOpenComments))
  }

  // Undo brought a decision back to this file: reopen it with its comment.
  useEffect(() => {
    if (!restore || !restoreApplies(restore, itemId)) return
    setPending(restore.decision)
    setComment(restore.comment ?? '')
  }, [restore, itemId])

  const decideBy =
    (decision: ReviewDecision): ShortcutHandler =>
    () => {
      if (!canDecide) return
      if (decision === 'approved') onDecide('approved', null)
      else open(decision)
    }
  useShortcuts(
    'reviews',
    {
      'reviews.approve': decideBy('approved'),
      'reviews.approveWithComments': decideBy('approved_with_comments'),
      'reviews.requestChanges': decideBy('changes_requested'),
      'reviews.reject': decideBy('rejected'),
    },
    { blockedByModal: true, enabled: canDecide && !pending },
  )

  useEffect(() => {
    if (pending) textRef.current?.focus()
  }, [pending])

  // A file the viewer can no longer decide drops an unsent comment box.
  useEffect(() => {
    if (!canDecide && pending !== 'approve_all') setPending(null)
  }, [canDecide]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsComment = pending !== null && COMMENTED.has(pending)
  const sendDisabled = needsComment && !comment.trim()

  const send = () => {
    if (!pending || sendDisabled) return
    const text = comment.trim() || null
    if (pending === 'approve_all') onApproveAll(text)
    else onDecide(pending, text)
    setPending(null)
    setComment('')
  }

  const reason = describeDecisionBarState(state)

  return (
    <div
      ref={barRef}
      data-compact={compact}
      className="group/bar flex-shrink-0 space-y-2.5 border-t border-ui-border bg-ui-bg px-4 py-3 font-ui"
    >
      {done ? (
        <div className="space-y-2">
          {reason && state.kind !== 'sending' && (
            <p className="text-[13px] text-ui-fg-secondary">
              {context} · {reason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-[14px] text-ui-fg">
              {t('reviewDetail.done.title')}
              {!done.onNext && (
                <span className="text-ui-fg-secondary"> {t('reviewDetail.done.nothing')}</span>
              )}
            </span>
            {done.onNext && (
              <Button variant="primary" onClick={done.onNext}>
                {done.waiting > 0
                  ? t('reviewDetail.done.next', { count: done.waiting })
                  : t('reviewDetail.done.nextOne')}
                <KeyHint id="reviews.nextReview" />
              </Button>
            )}
            <Button variant="ghost" onClick={done.onBack}>
              {t('reviewDetail.done.back')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-baseline gap-2 text-[13px]">
            <span className="truncate font-medium text-ui-fg">{context}</span>
            {moveText && <span className="flex-shrink-0 text-ui-fg-secondary">· {moveText}</span>}
            {owedCount > 1 && canDecide && !pending && (
              <Button
                size="sm"
                variant="ghost"
                className="-my-1 ml-auto"
                onClick={() => open('approve_all')}
              >
                {t('reviewDetail.decision.approveAll', { count: owedCount })}
              </Button>
            )}
          </div>

          {pending && (
            <div className="space-y-1.5">
              <label htmlFor="decision-comment" className="block text-[13px] text-ui-fg-secondary">
                {pending === 'approve_all'
                  ? t('reviewDetail.prompt.approve_all', { count: owedCount })
                  : t(`reviewDetail.prompt.${pending}`)}
              </label>
              <TextArea
                id="decision-comment"
                ref={textRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    send()
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    setPending(null)
                  }
                }}
                rows={3}
                placeholder={
                  needsComment
                    ? t('reviewDetail.decision.commentRequired')
                    : t('reviewDetail.decision.commentOptional')
                }
              />
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ui-fg-tertiary">
                  {t('reviewDetail.decision.sendHint')}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  {t('reviewQueue.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant={pending === 'rejected' ? 'danger' : 'primary'}
                  disabled={sendDisabled}
                  onClick={send}
                >
                  {pending === 'approve_all'
                    ? t('reviewDetail.decision.approveAllConfirm', { count: owedCount })
                    : t(`reviewDetail.decision.${pending}`)}
                </Button>
              </div>
            </div>
          )}

          {!pending &&
            (reason ? (
              <p className="text-[13px] text-ui-fg-secondary">{reason}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  aria-label={t('reviewDetail.decision.approved')}
                  data-decision="approved"
                  onClick={() => onDecide('approved', null)}
                >
                  {t('reviewDetail.decision.approved')}
                  <KeyHint id="reviews.approve" />
                </Button>
                <Button
                  size="sm"
                  aria-label={t('reviewDetail.decision.approved_with_comments')}
                  data-decision="approved_with_comments"
                  onClick={() => open('approved_with_comments')}
                >
                  {t('reviewDetail.decision.approved_with_comments')}
                </Button>
                <Button
                  size="sm"
                  aria-label={t('reviewDetail.decision.changes_requested')}
                  data-decision="changes_requested"
                  onClick={() => open('changes_requested')}
                >
                  {t('reviewDetail.decision.changes_requested')}
                  <KeyHint id="reviews.requestChanges" />
                </Button>
                <Button
                  size="sm"
                  variant="danger-subtle"
                  aria-label={t('reviewDetail.decision.rejected')}
                  data-decision="rejected"
                  onClick={() => open('rejected')}
                >
                  {t('reviewDetail.decision.rejected')}
                  <KeyHint id="reviews.reject" />
                </Button>
              </div>
            ))}
        </>
      )}
    </div>
  )
}
