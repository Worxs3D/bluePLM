import { describe, expect, it } from 'vitest'

import {
  closesAfterSend,
  emptyGateDraft,
  gateSubmitState,
  missingChecks,
  type GateDraft,
} from './gateDecision'

const checklist = [
  { id: 'dims', label: 'Dimensions checked', required: true },
  { id: 'notes', label: 'Notes read', required: false },
]

describe('gate decisions', () => {
  it('never sends one decision with another decision’s comment', () => {
    const draft: GateDraft = {
      ...emptyGateDraft(),
      comments: { kicked_back: 'Fix hole', rejected: '', approved: '' },
    }
    expect(gateSubmitState(draft, 'kicked_back', []).payload).toMatchObject({
      decision: 'kicked_back',
      comment: 'Fix hole',
    })
    expect(gateSubmitState(draft, 'rejected', []).blocker).toBe('comment_required')
  })

  it('waits for the required checklist items before approving', () => {
    const draft = emptyGateDraft()
    expect(missingChecks(checklist, draft.checks).map((c) => c.id)).toEqual(['dims'])
    expect(gateSubmitState(draft, 'approved', checklist).blocker).toBe('checklist_incomplete')
    const ticked = { ...draft, checks: { dims: true } }
    expect(gateSubmitState(ticked, 'approved', checklist).payload).toEqual({
      decision: 'approved',
      comment: undefined,
      checklistResponses: { dims: true, notes: false },
    })
  })
})

describe('closing the gate after its decision is sent', () => {
  it('closes only the gate still on screen', () => {
    expect(closesAfterSend('gate-a', 'gate-a')).toBe(true)
    expect(closesAfterSend('gate-b', 'gate-a')).toBe(false)
    expect(closesAfterSend(null, 'gate-a')).toBe(false)
  })
})
