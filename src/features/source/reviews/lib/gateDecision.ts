/**
 * A workflow gate decision before it is sent (review UX audit F8). The old sidebar card shared one
 * comment between Kick back and Reject, so typing a kick-back reason and then pressing Reject sent
 * a rejection with it. Here each commented decision keeps its own text, only the chosen decision is
 * ever sent, and Approve waits for the gate's required checklist items.
 *
 * Pure: the gate detail view owns the state and sends through `submitReviewDecision`.
 */

import type { ChecklistItem } from '@/types/workflow'

export type GateDecision = 'approved' | 'kicked_back' | 'rejected'

export interface GateDraft {
  /** The decision being written; null while none is chosen. */
  decision: GateDecision | null
  /** Each commented decision's own text. */
  comments: { kicked_back: string; rejected: string; approved: string }
  /** Checklist item id -> ticked. */
  checks: Record<string, boolean>
}

export function emptyGateDraft(): GateDraft {
  return { decision: null, comments: { kicked_back: '', rejected: '', approved: '' }, checks: {} }
}

export type GateBlocker = 'comment_required' | 'checklist_incomplete'

export interface GateSubmitState {
  blocker: GateBlocker | null
  payload: {
    decision: GateDecision
    comment: string | undefined
    checklistResponses: Record<string, boolean>
  } | null
}

/** Required items not ticked yet. */
export function missingChecks(
  checklist: readonly ChecklistItem[],
  checks: Readonly<Record<string, boolean>>,
): ChecklistItem[] {
  return checklist.filter((c) => c.required && !checks[c.id])
}

/** Whether `decision` can be sent now, and exactly what would be sent. */
export function gateSubmitState(
  draft: GateDraft,
  decision: GateDecision,
  checklist: readonly ChecklistItem[],
): GateSubmitState {
  const comment = draft.comments[decision].trim()
  if (decision !== 'approved' && !comment) return { blocker: 'comment_required', payload: null }
  if (decision === 'approved' && missingChecks(checklist, draft.checks).length > 0) {
    return { blocker: 'checklist_incomplete', payload: null }
  }
  const checklistResponses: Record<string, boolean> = {}
  for (const item of checklist) checklistResponses[item.id] = draft.checks[item.id] === true
  return { blocker: null, payload: { decision, comment: comment || undefined, checklistResponses } }
}

/**
 * After a gate decision went through, close the gate only if it is still the one on screen: a
 * decision flushed on leaving can land after another gate was opened, and must not close that one.
 */
export function closesAfterSend(activeGateId: string | null, sentGateId: string): boolean {
  return activeGateId === sentGateId
}
