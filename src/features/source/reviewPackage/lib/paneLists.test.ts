import { describe, expect, it } from 'vitest'

import type { ReviewQueueRow } from '@/types/reviews'

import { dueText, rowDue, sortRequestsForPane } from './paneLists'

function row(id: string, patch: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
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
    requestedBy: { id: 'me', email: 'me@x', fullName: 'Me', avatarUrl: null },
    requestedAt: null,
    completedAt: null,
    teamId: null,
    itemCount: 3,
    itemsDecided: 0,
    itemsOwedByMe: 0,
    preview: null,
    gate: null,
    cursor: id,
    ...patch,
  }
}

describe('sortRequestsForPane', () => {
  it("puts the requester's own moves first and keeps server order otherwise", () => {
    const rows = [
      row('waiting-1'),
      row('changes', { status: 'changes_requested' }),
      row('waiting-2'),
      row('rejected', { status: 'rejected' }),
    ]
    expect(sortRequestsForPane(rows, 'me').map((r) => r.id)).toEqual([
      'changes',
      'rejected',
      'waiting-1',
      'waiting-2',
    ])
  })

  it('leaves rows alone when none is the viewer’s move', () => {
    const rows = [row('a'), row('b')]
    expect(sortRequestsForPane(rows, 'me').map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('due text', () => {
  const today = '2026-11-04'

  it('says overdue, today, tomorrow and in n days', () => {
    expect(dueText(rowDue(row('a', { dueDate: '2026-11-02' }), today))).toBe('Overdue by 2 days')
    expect(dueText(rowDue(row('a', { dueDate: '2026-11-03' }), today))).toBe('Overdue by 1 day')
    expect(dueText(rowDue(row('a', { dueDate: today }), today))).toBe('Due today')
    expect(dueText(rowDue(row('a', { dueDate: '2026-11-05' }), today))).toBe('Due tomorrow')
    expect(dueText(rowDue(row('a', { dueDate: '2026-11-10' }), today))).toBe('Due in 6 days')
  })

  it('says nothing for closed reviews or without a due date', () => {
    expect(rowDue(row('a', { status: 'approved', dueDate: '2026-11-01' }), today)).toBeNull()
    expect(dueText(rowDue(row('a'), today))).toBeNull()
  })
})
