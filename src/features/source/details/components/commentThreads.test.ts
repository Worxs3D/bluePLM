import { describe, expect, it } from 'vitest'

import type { FileAnnotation } from '@/types/database'
import { testItem, testRound } from '@/features/source/reviews/lib/testDetail'

import {
  canResolveThread,
  earlierRounds,
  filterThreads,
  numberThreads,
  threadCounts,
  type ResolveContext,
} from './commentThreads'

function thread(
  id: string,
  page: number,
  y: number,
  extra: Partial<FileAnnotation> = {},
): FileAnnotation {
  return {
    id,
    file_id: 'f1',
    user_id: 'u-kim',
    comment: id,
    page_number: page,
    position: { x: 10, y, width: 10, height: 10, pageWidth: 100, pageHeight: 100 },
    annotation_type: 'area',
    parent_id: null,
    resolved: false,
    resolved_by: null,
    resolved_at: null,
    file_version: 5,
    edited_at: null,
    created_at: '2026-11-01T10:00:00Z',
    replies: [],
    ...extra,
  }
}

describe('comment threads', () => {
  const threads = [
    thread('low', 1, 80, { created_at: '2026-11-01T10:00:00Z' }),
    thread('page2', 2, 5, { resolved: true, created_at: '2026-11-01T11:00:00Z' }),
    thread('top', 1, 10, { created_at: '2026-11-01T12:00:00Z' }),
    thread('reply', 1, 0, { parent_id: 'top', created_at: '2026-11-01T13:00:00Z' }),
  ]

  it('numbers root threads in the order they were started, resolved ones included', () => {
    const numbers = numberThreads(threads)
    expect(numbers.get('low')).toBe(1)
    expect(numbers.get('page2')).toBe(2)
    expect(numbers.get('top')).toBe(3)
    expect(numbers.has('reply')).toBe(false)
    // A new thread higher on the sheet takes the next number; nobody else's changes.
    const more = numberThreads([
      ...threads,
      thread('new', 1, 1, { created_at: '2026-11-02T10:00:00Z' }),
    ])
    expect(more.get('low')).toBe(1)
    expect(more.get('new')).toBe(4)
  })

  it('filters open, resolved and all without renumbering', () => {
    expect(filterThreads(threads, 'open').map((a) => a.id)).toEqual(['top', 'low'])
    expect(filterThreads(threads, 'resolved').map((a) => a.id)).toEqual(['page2'])
    expect(filterThreads(threads, 'all')).toHaveLength(3)
    expect(threadCounts(threads)).toEqual({ open: 2, resolved: 1 })
  })

  it('lists earlier rounds newest first, skipping rounds the file was carried through', () => {
    const item = testItem('a', {
      rounds: [
        testRound({ roundNumber: 1, version: 4 }),
        testRound({ roundNumber: 2, version: 4, carriedForward: true }),
        testRound({ roundNumber: 3, version: 6 }),
        testRound({ roundNumber: 4, version: 7 }),
      ],
    })
    expect(earlierRounds(item, 4)).toEqual([
      { round: 3, version: 6 },
      { round: 1, version: 4 },
    ])
    expect(earlierRounds(item, 1)).toEqual([])
  })
})

describe('canResolveThread', () => {
  const base: ResolveContext = {
    userId: 'u-me',
    sharedResolve: false,
    reviewParticipant: true,
    isAdmin: false,
    canEditFiles: false,
    inReview: true,
  }

  it('offers Resolve on my own comments only until the database allows more', () => {
    expect(canResolveThread(thread('mine', 1, 1, { user_id: 'u-me' }), base)).toBe(true)
    expect(canResolveThread(thread('theirs', 1, 1), base)).toBe(false)
    expect(canResolveThread(thread('theirs', 1, 1), { ...base, isAdmin: true })).toBe(false)
  })

  it('lets review participants and admins resolve once it does', () => {
    const shared = { ...base, sharedResolve: true }
    expect(canResolveThread(thread('theirs', 1, 1), shared)).toBe(true)
    expect(canResolveThread(thread('theirs', 1, 1), { ...shared, reviewParticipant: false })).toBe(
      false,
    )
    expect(
      canResolveThread(thread('theirs', 1, 1), {
        ...shared,
        reviewParticipant: false,
        isAdmin: true,
      }),
    ).toBe(true)
    expect(
      canResolveThread(thread('theirs', 1, 1), {
        ...shared,
        inReview: false,
        reviewParticipant: false,
        canEditFiles: true,
      }),
    ).toBe(true)
    expect(canResolveThread(thread('theirs', 1, 1), { ...shared, userId: null })).toBe(false)
  })

  it('offers a review comment outside its review to its author and admins only', () => {
    const outside = {
      ...base,
      sharedResolve: true,
      inReview: false,
      reviewParticipant: false,
      canEditFiles: true,
    }
    const reviewComment = thread('theirs', 1, 1, { review_id: 'r1' })
    expect(canResolveThread(reviewComment, outside)).toBe(false)
    expect(canResolveThread(reviewComment, { ...outside, isAdmin: true })).toBe(true)
    expect(canResolveThread({ ...reviewComment, user_id: 'u-me' }, outside)).toBe(true)
    expect(canResolveThread(thread('theirs', 1, 1, { review_id: null }), outside)).toBe(true)
  })
})
