import { describe, expect, it } from 'vitest'

import type { ReviewQueueRow } from '@/types/reviews'

import { bulkApproveSummary, bulkEligibility, pruneSelection } from './bulk'
import { coalesceNotifications, isReviewNotification, reviewToastType } from './notifications'
import { testRow } from './testDetail'

function row(id: string, extra: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    kind: 'package',
    id,
    title: id,
    status: 'open',
    priority: 'normal',
    dueDate: null,
    overdue: false,
    mode: 'all',
    round: 1,
    requestedBy: null,
    requestedAt: null,
    completedAt: null,
    teamId: null,
    itemCount: 2,
    itemsDecided: 0,
    itemsOwedByMe: 0,
    reviewersOwing: null,
    reviewersWithdrawn: null,
    preview: null,
    gate: null,
    cursor: id,
    ...extra,
  }
}

const me = { id: 'me', email: 'me@x.test', fullName: null, avatarUrl: null }
const other = { id: 'other', email: 'o@x.test', fullName: null, avatarUrl: null }

describe('bulkEligibility', () => {
  it('approves only reviews where I still owe items, plus gates', () => {
    const gate = row('g', {
      kind: 'gate',
      gate: {
        pendingReviewId: 'g',
        fileId: 'f',
        fileName: 'f',
        filePath: 'f',
        gateId: 'gate',
        gateName: 'Gate',
        gateType: null,
        transitionId: 't',
        transitionName: null,
        fromStateName: null,
        toStateName: null,
        checklistItems: [],
      },
    })
    const result = bulkEligibility(
      [
        row('owe', { itemsOwedByMe: 2 }),
        row('none'),
        row('closed', { status: 'approved', itemsOwedByMe: 1 }),
        gate,
      ],
      'me',
    )
    expect(result.approvable.map((r) => r.id)).toEqual(['owe', 'g'])
  })

  it('leaves gates with a required checklist out of bulk approve', () => {
    const gate = (id: string, checklistItems: unknown[]) =>
      row(id, {
        kind: 'gate',
        gate: {
          pendingReviewId: id,
          fileId: 'f',
          fileName: 'f',
          filePath: 'f',
          gateId: 'gate',
          gateName: 'Gate',
          gateType: null,
          transitionId: 't',
          transitionName: null,
          fromStateName: null,
          toStateName: null,
          checklistItems: checklistItems as never,
        },
      })
    const result = bulkEligibility(
      [
        gate('plain', [{ id: 'c1', label: 'Looked at it', required: false }]),
        gate('checked', [{ id: 'c1', label: 'Torque values verified', required: true }]),
      ],
      'me',
    )
    expect(result.approvable.map((r) => r.id)).toEqual(['plain'])
    expect(result.needsChecklist.map((r) => r.id)).toEqual(['checked'])
  })

  it('lets the requester edit and cancel only their own open reviews', () => {
    const result = bulkEligibility(
      [
        row('mine', { requestedBy: me }),
        row('mine-back', { requestedBy: me, status: 'changes_requested' }),
        row('mine-done', { requestedBy: me, status: 'approved' }),
        row('theirs', { requestedBy: other }),
      ],
      'me',
    )
    expect(result.mine.map((r) => r.id)).toEqual(['mine', 'mine-back'])
  })
})

describe('pruneSelection', () => {
  it('drops ids no longer listed', () => {
    expect(Array.from(pruneSelection(new Set(['a', 'b']), [row('b'), row('c')]))).toEqual(['b'])
  })
})

describe('review notifications', () => {
  it('recognises review rows and colours the toast by what it asks', () => {
    expect(isReviewNotification({ entity_type: 'review', type: 'review_request' })).toBe(true)
    expect(isReviewNotification({ entity_type: 'eco', type: 'eco_update' })).toBe(false)
    expect(reviewToastType('review_request')).toBe('warning')
    expect(reviewToastType('review_rejected')).toBe('error')
    expect(reviewToastType('review_completed')).toBe('success')
    expect(reviewToastType('review_decision')).toBe('info')
    expect(reviewToastType('review_reviewer_removed')).toBe('warning')
    expect(reviewToastType('review_item_removed')).toBe('info')
  })
})

describe('bulkApproveSummary', () => {
  it('counts drawings, reviews, gates and what was not opened in this session', () => {
    const rows = [
      testRow({ id: 'r1', itemsOwedByMe: 30 }),
      testRow({ id: 'r2', itemsOwedByMe: 7 }),
      testRow({ id: 'g1', kind: 'gate' }),
    ]
    const viewed: Record<string, number> = { r1: 5, r2: 9 }
    expect(bulkApproveSummary(rows, (id) => viewed[id] ?? 0)).toEqual({
      drawings: 37,
      reviews: 2,
      gates: 1,
      unopened: 25,
    })
  })
})

describe('coalesceNotifications', () => {
  const n = (id: string) => ({
    type: 'review_decision',
    title: id,
    message: null,
    entity_type: 'review',
    entity_id: id,
  })
  it('toasts up to three one by one and a burst as one summary', () => {
    expect(coalesceNotifications([n('a'), n('b'), n('c')])).toMatchObject({ kind: 'each' })
    expect(coalesceNotifications([n('a'), n('b'), n('c'), n('d')])).toEqual({
      kind: 'summary',
      count: 4,
    })
  })
})
