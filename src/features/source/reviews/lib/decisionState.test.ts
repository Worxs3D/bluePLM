import { describe, expect, it } from 'vitest'

import {
  decisionBarState,
  describeDecisionBarState,
  prefilledDecisionComment,
} from './decisionState'
import { KIM, ME, testDetail, testItem, testRound } from './testDetail'

const decided = (reviewerId: string, decidedAt = '2026-11-03T10:00:00Z') => ({
  reviewerId,
  decision: 'approved' as const,
  comment: null,
  decidedAt,
  legacy: false,
})

describe('decisionBarState', () => {
  it('shows the buttons only for an item I owe', () => {
    const item = testItem('a')
    expect(decisionBarState(testDetail({ me: { owedItemIds: ['a'] } }), item, null).kind).toBe(
      'decide',
    )
  })

  it('shows a queued decision as sending', () => {
    const item = testItem('a')
    const state = decisionBarState(testDetail({ me: { owedItemIds: ['a'] } }), item, {
      decision: 'approved',
    })
    expect(state).toEqual({ kind: 'sending', decision: 'approved' })
  })

  it('says I already decided, and when', () => {
    const item = testItem('a', { rounds: [testRound({ decisions: [decided(ME)] })] })
    const state = decisionBarState(testDetail(), item, null)
    expect(state.kind).toBe('decided_by_me')
    expect(describeDecisionBarState(state)).toMatch(/^You approved this on /)
  })

  it('names who decided first in first-to-decide mode', () => {
    const item = testItem('a', { rounds: [testRound({ decisions: [decided(KIM.id)] })] })
    const state = decisionBarState(testDetail({ review: { mode: 'any' } }), item, null)
    expect(state).toMatchObject({ kind: 'decided_by_other', name: 'Kim Li' })
    expect(describeDecisionBarState(state)).toBe(
      'Kim Li approved this first (first decision stands).',
    )
  })

  it('says a carried-forward file was approved in its earlier round', () => {
    const item = testItem('a', {
      rounds: [
        testRound({ roundNumber: 1, outcome: 'approved' }),
        testRound({ roundNumber: 2, carriedForward: true, outcome: 'approved' }),
      ],
    })
    const state = decisionBarState(testDetail({ review: { currentRound: 2 } }), item, null)
    expect(state).toEqual({ kind: 'carried_forward', round: 1 })
    expect(describeDecisionBarState(state)).toBe('Approved in round 1 and carried forward.')
  })

  it('treats a file approved earlier with no entry this round as carried forward', () => {
    const item = testItem('a', {
      outcome: 'approved',
      rounds: [testRound({ roundNumber: 1, outcome: 'approved' })],
    })
    const state = decisionBarState(testDetail({ review: { currentRound: 2 } }), item, null)
    expect(state).toEqual({ kind: 'carried_forward', round: 1 })
  })

  it('tells a non-reviewer and a closed review apart', () => {
    const item = testItem('a')
    expect(
      decisionBarState(testDetail({ me: { isReviewer: false, canRespond: false } }), item, null)
        .kind,
    ).toBe('not_reviewer')
    expect(decisionBarState(testDetail({ review: { status: 'approved' } }), item, null).kind).toBe(
      'closed',
    )
  })
})

describe('prefilledDecisionComment', () => {
  it('points at my comments for a commented decision, and is empty otherwise', () => {
    expect(prefilledDecisionComment('changes_requested', 3)).toBe(
      'See the 3 comments on the drawing.',
    )
    expect(prefilledDecisionComment('changes_requested', 0)).toBe('')
    expect(prefilledDecisionComment('approved', 3)).toBe('')
  })
})
