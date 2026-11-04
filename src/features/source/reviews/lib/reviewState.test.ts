import { describe, expect, it } from 'vitest'

import type { ReviewStageSummary } from './reviewStage'
import {
  describeNextMove,
  isViewersMove,
  nextMoveForDetail,
  nextMoveForRow,
  nextMoveTone,
  nextRowAfter,
} from './reviewState'
import {
  KIM,
  ME,
  MEUSER,
  SAM,
  reviewer,
  testDetail,
  testItem,
  testRound,
  testRow,
} from './testDetail'

const stage = (extra: Partial<ReviewStageSummary> = {}): ReviewStageSummary => ({
  inStage: 2,
  approvedWaiting: 2,
  packageReady: true,
  partialMoveAllowed: false,
  heldForPackage: false,
  moved: [],
  nextStates: ['Released'],
  stages: ['In Review'],
  relevant: true,
  ...extra,
})

describe('nextMoveForRow', () => {
  it('says the reviewer decides what they owe, of the whole review', () => {
    const move = nextMoveForRow(testRow({ itemsOwedByMe: 3, itemCount: 12 }), ME)
    expect(move).toEqual({ kind: 'you_decide', owed: 3, total: 12 })
    expect(describeNextMove(move)).toBe('You decide 3 of 12')
    expect(nextMoveTone(move)).toBe('strong')
  })

  it('never says "Open": an open review nobody asks of me waits on reviewers', () => {
    const move = nextMoveForRow(testRow({ itemsDecided: 3, itemCount: 8 }), ME)
    expect(move.kind).toBe('waiting_on')
    expect(describeNextMove(move)).toBe('Waiting on reviewers · 3 of 8 decided')
  })

  it("is the requester's move after changes are requested, and the author's for everyone else", () => {
    const mine = testRow({ status: 'changes_requested', requestedBy: MEUSER })
    expect(nextMoveForRow(mine, ME).kind).toBe('your_move_changes')
    expect(nextMoveTone(nextMoveForRow(mine, ME))).toBe('warning')
    const theirs = testRow({ status: 'changes_requested', requestedBy: SAM })
    expect(nextMoveForRow(theirs, ME)).toEqual({ kind: 'waiting_on_author', author: 'Sam Rivera' })
  })

  it('treats a rejected request as the requester’s move only in My requests', () => {
    const row = testRow({
      status: 'rejected',
      requestedBy: MEUSER,
      completedAt: '2026-11-02T10:00:00Z',
    })
    expect(nextMoveForRow(row, ME, 'requested_by_me').kind).toBe('your_move_rejected')
    expect(nextMoveForRow(row, ME, 'done').kind).toBe('closed')
  })

  it('describes gates by their transition and closed reviews by outcome', () => {
    const gate = testRow({
      kind: 'gate',
      gate: {
        pendingReviewId: 'p1',
        fileId: 'f1',
        fileName: 'plate.sldprt',
        filePath: 'plate.sldprt',
        gateId: 'g1',
        gateName: 'Checker',
        gateType: null,
        transitionId: 't1',
        transitionName: null,
        fromStateName: 'In work',
        toStateName: 'Checked',
        checklistItems: [],
      },
    })
    expect(describeNextMove(nextMoveForRow(gate, ME))).toBe('Workflow gate · In work → Checked')
    const closed = nextMoveForRow(testRow({ status: 'cancelled' }), ME)
    expect(closed.kind).toBe('closed')
    expect(nextMoveTone(closed)).toBe('neutral')
  })
})

describe('nextMoveForDetail', () => {
  it('counts what I owe against every file', () => {
    const detail = testDetail({ me: { owedItemIds: ['a'] } })
    expect(nextMoveForDetail(detail)).toEqual({ kind: 'you_decide', owed: 1, total: 2 })
  })

  it('names how many reviewers still owe', () => {
    const detail = testDetail({
      reviewers: [reviewer(MEUSER, { status: 'approved' }), reviewer(KIM)],
      items: [testItem('a', { outcome: 'approved' }), testItem('b')],
    })
    expect(nextMoveForDetail(detail)).toEqual({
      kind: 'waiting_on',
      people: 1,
      decided: 1,
      total: 2,
    })
  })

  it('sees a stuck review when every reviewer who owed was withdrawn', () => {
    const detail = testDetail({
      me: { isRequester: true, isReviewer: false, userId: SAM.id },
      reviewers: [reviewer(KIM, { status: 'cancelled', withdrawnReason: 'left_org' })],
    })
    const move = nextMoveForDetail(detail)
    expect(move).toEqual({ kind: 'nobody_left', items: 2 })
    expect(nextMoveTone(move)).toBe('danger')
    expect(isViewersMove(move)).toBe(true)
  })

  it('counts the files that came back for the author', () => {
    const detail = testDetail({
      review: { status: 'changes_requested' },
      me: { isRequester: true, isReviewer: false, canResubmit: true },
      items: [
        testItem('a', { outcome: 'changes_requested' }),
        testItem('b', { outcome: 'approved' }),
      ],
    })
    expect(nextMoveForDetail(detail)).toEqual({ kind: 'your_move_changes', items: 1 })
    expect(describeNextMove(nextMoveForDetail(detail))).toBe('Changes requested on 1 file · your move')
  })

  it('names who rejected first for the author', () => {
    const detail = testDetail({
      review: { status: 'rejected' },
      me: { isRequester: true, canResubmit: true },
      items: [
        testItem('a', {
          outcome: 'rejected',
          rounds: [
            testRound({
              outcome: 'rejected',
              decisions: [
                {
                  reviewerId: KIM.id,
                  decision: 'rejected',
                  comment: 'Wrong part',
                  decidedAt: '2026-11-02T10:00:00Z',
                  legacy: false,
                },
              ],
            }),
          ],
        }),
      ],
    })
    expect(nextMoveForDetail(detail)).toEqual({ kind: 'your_move_rejected', by: 'Kim Li' })
  })

  it('offers the move only to someone who may make it, once files wait in a stage', () => {
    const approved = testDetail({ review: { status: 'approved' }, me: { isRequester: true } })
    expect(nextMoveForDetail(approved, stage())).toEqual({
      kind: 'ready_to_move',
      files: 2,
      state: 'Released',
    })
    const reviewerView = testDetail({ review: { status: 'approved' } })
    expect(nextMoveForDetail(reviewerView, stage()).kind).toBe('closed')
    expect(
      nextMoveForDetail(approved, stage({ packageReady: false, approvedWaiting: 0 })).kind,
    ).toBe('closed')
  })
})

describe('nextRowAfter', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('takes the next row, wrapping, and the first when the current one dropped out', () => {
    expect(nextRowAfter(rows, 'b')?.id).toBe('c')
    expect(nextRowAfter(rows, 'c')?.id).toBe('a')
    expect(nextRowAfter(rows, 'gone')?.id).toBe('a')
    expect(nextRowAfter([{ id: 'a' }], 'a')).toBeNull()
  })
})
