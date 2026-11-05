import { describe, expect, it } from 'vitest'

import {
  countCommentsByItem,
  describeWhatToFix,
  groupItems,
  orderedItemIds,
  whatToFix,
} from './reviewProgress'
import { KIM, ME, reviewer, testDetail, testItem, testRound } from './testDetail'

const roots = [
  { itemId: 'a', round: 1, userId: ME, resolved: false },
  { itemId: 'a', round: 1, userId: KIM.id, resolved: false },
  { itemId: 'a', round: 1, userId: KIM.id, resolved: true },
  { itemId: 'b', round: 2, userId: ME, resolved: false },
]

describe('countCommentsByItem', () => {
  it('counts one round, open and resolved, and mine', () => {
    const counts = countCommentsByItem(roots, 1, ME)
    expect(counts.get('a')).toEqual({ open: 2, resolved: 1, mineOpen: 1 })
    expect(counts.has('b')).toBe(false)
  })
})

describe('groupItems', () => {
  it('puts what I owe first, then what came back, what others owe, and decided files', () => {
    const items = [
      testItem('done', { outcome: 'approved', sortOrder: 0 }),
      testItem('mine', { sortOrder: 1 }),
      testItem('back', { outcome: 'changes_requested', sortOrder: 2 }),
      testItem('other', { sortOrder: 3 }),
    ]
    const groups = groupItems(items, new Set(['mine']))
    expect(groups.map((g) => g.kind)).toEqual(['to_review', 'needs_changes', 'waiting', 'decided'])
    expect(orderedItemIds(groups)).toEqual(['mine', 'back', 'other', 'done'])
  })
})

describe('whatToFix', () => {
  it('sums what the author has to do and how much is ready', () => {
    const detail = testDetail({
      review: { status: 'changes_requested' },
      items: [
        testItem('a', {
          outcome: 'changes_requested',
          file: { ...testItem('a').file, latestVersion: 6 },
        }),
        testItem('b', { outcome: 'changes_requested' }),
        testItem('c', { outcome: 'approved' }),
      ],
    })
    const summary = whatToFix(detail, countCommentsByItem(roots, 1, ME))
    expect(summary).toMatchObject({
      needsChanges: 2,
      rejected: 0,
      total: 3,
      openComments: 2,
      ready: 1,
    })
    expect(describeWhatToFix(summary)).toBe(
      'Changes requested on 2 of 3 files, with 2 open comments. 1 already has a newer version checked in.',
    )
  })

  it('names the first rejection and its comment', () => {
    const detail = testDetail({
      review: { status: 'rejected' },
      reviewers: [reviewer(KIM, { status: 'rejected' })],
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
                  comment: 'Wrong material',
                  decidedAt: '2026-11-02T10:00:00Z',
                  legacy: false,
                },
              ],
            }),
          ],
        }),
      ],
    })
    expect(whatToFix(detail, new Map()).rejection).toEqual({
      by: 'Kim Li',
      comment: 'Wrong material',
    })
  })
})
