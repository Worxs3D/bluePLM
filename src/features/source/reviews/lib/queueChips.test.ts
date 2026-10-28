import { describe, expect, it } from 'vitest'

import type { ReviewQueueRow } from '@/types/reviews'

import {
  daysBetween,
  dueChip,
  formatDateOnly,
  localDateString,
  parseDateOnly,
  priorityChip,
  queueRowChips,
} from './queueChips'

function row(extra: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    kind: 'package',
    id: 'r1',
    title: 'Bracket drawings',
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
    itemCount: 4,
    itemsDecided: 1,
    itemsOwedByMe: 3,
    preview: null,
    gate: null,
    cursor: 'c',
    ...extra,
  }
}

describe('date-only helpers', () => {
  it('reads the local calendar day, not the UTC one', () => {
    // 23:30 local on Oct 29 is Oct 30 in UTC for anyone west of UTC; the local day must win.
    expect(localDateString(new Date(2026, 9, 29, 23, 30))).toBe('2026-10-29')
  })

  it('parses a date as local midnight so it never shifts a day', () => {
    const d = parseDateOnly('2026-10-30')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(9)
    expect(d?.getDate()).toBe(30)
    expect(parseDateOnly('2026-10-30T00:00:00Z')).toBeNull()
    expect(parseDateOnly(null)).toBeNull()
  })

  it('counts whole days across month ends and DST changes', () => {
    expect(daysBetween('2026-10-29', '2026-10-30')).toBe(1)
    expect(daysBetween('2026-10-30', '2026-10-29')).toBe(-1)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('bad', '2026-03-09')).toBeNull()
  })

  it('formats without moving the day', () => {
    expect(formatDateOnly('2026-10-30', 'en-US')).toContain('30')
    expect(formatDateOnly(null)).toBe('')
  })
})

describe('dueChip', () => {
  const today = '2026-10-28'
  it('classifies overdue, today, soon and later', () => {
    expect(dueChip('2026-10-27', today)).toEqual({ tone: 'overdue', days: -1 })
    expect(dueChip('2026-10-28', today)).toEqual({ tone: 'today', days: 0 })
    expect(dueChip('2026-10-30', today)).toEqual({ tone: 'soon', days: 2 })
    expect(dueChip('2026-11-05', today)).toEqual({ tone: 'later', days: 8 })
  })

  it('is overdue when the server says so even if the local day disagrees', () => {
    expect(dueChip('2026-10-28', today, true)?.tone).toBe('overdue')
  })

  it('shows nothing without a due date', () => {
    expect(dueChip(null, today)).toBeNull()
  })
})

describe('queue row chips', () => {
  it('hides the normal priority', () => {
    expect(priorityChip('normal')).toBeNull()
    expect(priorityChip('urgent')).toBe('urgent')
  })

  it('shows due and priority only while the review is open', () => {
    const open = queueRowChips(row({ priority: 'high', dueDate: '2026-10-27', overdue: true }), '2026-10-28')
    expect(open.due?.tone).toBe('overdue')
    expect(open.priority).toBe('high')
    expect(open.progress).toEqual({ decided: 1, total: 4 })

    const done = queueRowChips(row({ status: 'approved', priority: 'high', dueDate: '2026-10-27' }), '2026-10-28')
    expect(done.due).toBeNull()
    expect(done.priority).toBeNull()
  })

  it('has no progress for gate rows', () => {
    expect(queueRowChips(row({ kind: 'gate' }), '2026-10-28').progress).toBeNull()
  })
})
