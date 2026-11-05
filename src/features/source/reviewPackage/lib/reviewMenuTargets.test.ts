import { describe, expect, it } from 'vitest'

import type { OpenReviewForFiles } from '@/types/reviews'

import { reviewMenuTargets, showReviewsTarget } from './reviewMenuTargets'

function review(id: string, patch: Partial<OpenReviewForFiles> = {}): OpenReviewForFiles {
  return {
    reviewId: id,
    title: id,
    outcome: 'open',
    itemCount: 3,
    requestedByMe: true,
    canAdd: true,
    containedFileIds: [],
    ...patch,
  }
}

describe('reviewMenuTargets', () => {
  it('offers the unsent package only when it exists and lacks one of the files', () => {
    expect(reviewMenuTargets(['a'], [], []).addToDraft).toBe(false)
    expect(reviewMenuTargets(['a'], [{ fileId: 'a' }], []).addToDraft).toBe(false)
    expect(reviewMenuTargets(['a', 'b'], [{ fileId: 'a' }], []).addToDraft).toBe(true)
  })

  it('counts the files the unsent package holds', () => {
    expect(
      reviewMenuTargets(['a', 'b', 'c'], [{ fileId: 'a' }, { fileId: 'c' }], []).removeFromDraft,
    ).toBe(2)
  })

  it('adds only to open rounds that are missing a file', () => {
    const t = reviewMenuTargets(
      ['a', 'b'],
      [],
      [
        review('open'),
        review('has-both', { containedFileIds: ['a', 'b'] }),
        review('has-one', { containedFileIds: ['a'] }),
        review('awaiting-resubmit', { canAdd: false, outcome: 'changes_requested' }),
      ],
    )
    expect(t.addTo.map((r) => r.reviewId)).toEqual(['open', 'has-one'])
  })

  it('removes only from reviews holding a file, and never their last file', () => {
    const t = reviewMenuTargets(
      ['a', 'b'],
      [],
      [
        review('none'),
        review('one-of-three', { containedFileIds: ['a'] }),
        review('only-file', { itemCount: 1, containedFileIds: ['a'] }),
        review('every-file', { itemCount: 2, containedFileIds: ['a', 'b'] }),
        review('awaiting-resubmit', { canAdd: false, containedFileIds: ['b'] }),
      ],
    )
    expect(t.removeFrom.map((r) => r.reviewId)).toEqual(['one-of-three', 'awaiting-resubmit'])
  })
})

describe('showReviewsTarget', () => {
  it('opens the one open review that holds the file', () => {
    expect(showReviewsTarget(['a'], [review('r1', { containedFileIds: ['a'] }), review('r2')])).toEqual({
      kind: 'review',
      reviewId: 'r1',
    })
  })

  it('goes to the queue bucket holding the files when several reviews hold them', () => {
    const mine = review('r1', { containedFileIds: ['a'] })
    const theirs = review('r2', { containedFileIds: ['a'], requestedByMe: false })
    expect(showReviewsTarget(['a'], [mine, theirs])).toEqual({ kind: 'queue', bucket: 'requested_by_me' })
    expect(showReviewsTarget(['a'], [theirs, { ...theirs, reviewId: 'r3' }])).toEqual({
      kind: 'queue',
      bucket: 'awaiting_me',
    })
  })

  it('goes to the queue when nothing was loaded', () => {
    expect(showReviewsTarget(['a'], null)).toEqual({ kind: 'queue', bucket: 'awaiting_me' })
  })
})
