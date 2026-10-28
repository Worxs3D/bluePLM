import { describe, expect, it } from 'vitest'

import { MAX_REVIEW_PACKAGE_ITEMS, type ReviewPackageDraftItem } from '../../types/reviewPackageDraft'
import {
  addDraftItems,
  draftBlocker,
  emptyReviewPackageDraft,
  patchDraftMeta,
  removeDraftItem,
  sanitizeReviewPackageDrafts,
  toggleDraftReviewer,
  toggleDraftTeam,
} from './reviewsDraft'

function item(fileId: string, version = 1, extra: Partial<ReviewPackageDraftItem> = {}): ReviewPackageDraftItem {
  return {
    fileId,
    fileVersionId: `${fileId}-v${version}`,
    version,
    revision: 'A',
    state: 'wip',
    fileName: `${fileId}.slddrw`,
    filePath: `drawings/${fileId}.slddrw`,
    extension: '.slddrw',
    vaultId: 'vault',
    latestVersion: version,
    ...extra,
  }
}

describe('addDraftItems', () => {
  it('adds new files in order', () => {
    const result = addDraftItems(emptyReviewPackageDraft(), [item('a'), item('b')])
    expect(result.added).toBe(2)
    expect(result.draft.items.map((i) => i.fileId)).toEqual(['a', 'b'])
  })

  it('keeps one item per file and replaces its version in place', () => {
    const first = addDraftItems(emptyReviewPackageDraft(), [item('a', 1), item('b', 1)]).draft
    const result = addDraftItems(first, [item('a', 3)])
    expect(result).toMatchObject({ added: 0, replaced: 1, dropped: 0 })
    expect(result.draft.items.map((i) => i.fileVersionId)).toEqual(['a-v3', 'b-v1'])
  })

  it('returns the same draft when nothing changes', () => {
    const first = addDraftItems(emptyReviewPackageDraft(), [item('a')]).draft
    const result = addDraftItems(first, [item('a')])
    expect(result.draft).toBe(first)
    expect(result).toMatchObject({ added: 0, replaced: 0 })
  })

  it('drops items beyond the server limit', () => {
    const many = Array.from({ length: MAX_REVIEW_PACKAGE_ITEMS + 3 }, (_, i) => item(`f${i}`))
    const result = addDraftItems(emptyReviewPackageDraft(), many)
    expect(result.added).toBe(MAX_REVIEW_PACKAGE_ITEMS)
    expect(result.dropped).toBe(3)
  })
})

describe('draft edits', () => {
  it('removes an item by file', () => {
    const draft = addDraftItems(emptyReviewPackageDraft(), [item('a'), item('b')]).draft
    expect(removeDraftItem(draft, 'a').items.map((i) => i.fileId)).toEqual(['b'])
    expect(removeDraftItem(draft, 'zzz')).toBe(draft)
  })

  it('toggles reviewers and teams independently', () => {
    let draft = emptyReviewPackageDraft()
    draft = toggleDraftReviewer(draft, 'u1')
    draft = toggleDraftTeam(draft, 't1')
    draft = toggleDraftReviewer(draft, 'u2')
    expect(draft.reviewerIds).toEqual(['u1', 'u2'])
    expect(draft.teamIds).toEqual(['t1'])
    draft = toggleDraftReviewer(draft, 'u1')
    draft = toggleDraftTeam(draft, 't1')
    expect(draft.reviewerIds).toEqual(['u2'])
    expect(draft.teamIds).toEqual([])
  })

  it('patches meta fields and keeps the due date as a date string', () => {
    const draft = patchDraftMeta(emptyReviewPackageDraft(), { dueDate: '2026-10-30', priority: 'urgent' })
    expect(draft.dueDate).toBe('2026-10-30')
    expect(draft.priority).toBe('urgent')
  })
})

describe('draftBlocker', () => {
  it('needs items and a reviewer or team', () => {
    const empty = emptyReviewPackageDraft()
    expect(draftBlocker(empty)).toBe('no_items')
    const withItem = addDraftItems(empty, [item('a')]).draft
    expect(draftBlocker(withItem)).toBe('no_reviewers')
    expect(draftBlocker(toggleDraftTeam(withItem, 't1'))).toBeNull()
    expect(draftBlocker(toggleDraftReviewer(withItem, 'u1'))).toBeNull()
  })
})

describe('sanitizeReviewPackageDrafts', () => {
  it('keeps valid drafts per user and drops malformed values', () => {
    const good = addDraftItems(emptyReviewPackageDraft(), [item('a')]).draft
    const result = sanitizeReviewPackageDrafts({
      user1: good,
      user2: 'nonsense',
      user3: {
        items: [{ fileId: 'x' }, item('b')],
        mode: 'sometimes',
        priority: 'urgent',
        dueDate: '2026-10-30T00:00:00Z',
      },
    })
    expect(Object.keys(result)).toEqual(['user1', 'user3'])
    expect(result.user1).toEqual(good)
    expect(result.user3.items.map((i) => i.fileId)).toEqual(['b'])
    expect(result.user3.mode).toBe('all')
    expect(result.user3.priority).toBe('urgent')
    expect(result.user3.dueDate).toBeNull()
  })

  it('returns no drafts for anything that is not an object', () => {
    expect(sanitizeReviewPackageDrafts(undefined)).toEqual({})
    expect(sanitizeReviewPackageDrafts([1, 2])).toEqual({})
  })
})
