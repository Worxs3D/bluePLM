import { beforeEach, describe, expect, it } from 'vitest'
import type { StateCreator } from 'zustand'

import type { ReviewPackageDraftItem } from '../../types/reviewPackageDraft'
import type { PDMStoreState } from '../types'
import { emptyReviewPackageDraft } from './reviewsDraft'
import {
  createReviewsSlice,
  reviewDraftKey,
  selectReviewPackageDraft,
  type ReviewsSlice,
} from './reviewsSlice'

type ReviewsSliceCreator = StateCreator<PDMStoreState, [['zustand/persist', unknown]], [], ReviewsSlice>
type StoreSet = Parameters<ReviewsSliceCreator>[0]
type StoreGet = Parameters<ReviewsSliceCreator>[1]

function item(fileId: string): ReviewPackageDraftItem {
  return {
    fileId,
    fileVersionId: `${fileId}-v1`,
    version: 1,
    revision: null,
    state: null,
    fileName: `${fileId}.slddrw`,
    filePath: `${fileId}.slddrw`,
    extension: '.slddrw',
    vaultId: 'vault',
    latestVersion: 1,
  }
}

describe('reviews slice: drafts, navigation and queue view', () => {
  let store: PDMStoreState

  beforeEach(() => {
    store = {} as unknown as PDMStoreState
    const set: StoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(store) : partial
      store = { ...store, ...update }
    }
    const get: StoreGet = () => store
    const slice = createReviewsSlice(set, get, {} as Parameters<ReviewsSliceCreator>[2])
    store = {
      ...slice,
      user: { id: 'u1' },
      organization: { id: 'orgA' },
      activeView: 'explorer',
      rightPanelVisible: true,
      setActiveView: (view: string) => set({ activeView: view } as Partial<PDMStoreState>),
      toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
    } as unknown as PDMStoreState
  })

  const switchOrg = (id: string) => {
    store = { ...store, organization: { id } } as unknown as PDMStoreState
  }

  it('keeps one draft per user and organization', () => {
    store.addReviewPackageItems([item('a')])
    expect(Object.keys(store.reviewPackageDrafts)).toEqual([reviewDraftKey('u1', 'orgA')])
    switchOrg('orgB')
    expect(selectReviewPackageDraft(store).items).toEqual([])
    store.addReviewPackageItems([item('b')])
    switchOrg('orgA')
    expect(selectReviewPackageDraft(store).items.map((i) => i.fileId)).toEqual(['a'])
  })

  it('reads a draft saved per user only, and moves it to the organization on its first change', () => {
    const legacy = { ...emptyReviewPackageDraft(), items: [item('old')] }
    store = { ...store, reviewPackageDrafts: { u1: legacy } }
    expect(selectReviewPackageDraft(store).items.map((i) => i.fileId)).toEqual(['old'])
    store.addReviewPackageItems([item('new')])
    expect(store.reviewPackageDrafts.u1).toBeUndefined()
    expect(store.reviewPackageDrafts[reviewDraftKey('u1', 'orgA')].items.map((i) => i.fileId)).toEqual([
      'old',
      'new',
    ])
  })

  it('discards a draft and restores it for Undo', () => {
    store.addReviewPackageItems([item('a'), item('b')])
    store.toggleReviewPackageReviewer('r1')
    const discarded = store.discardReviewPackageDraft()
    expect(selectReviewPackageDraft(store).items).toEqual([])
    expect(discarded?.items).toHaveLength(2)
    store.restoreReviewPackageDraft(discarded!)
    expect(selectReviewPackageDraft(store).items).toHaveLength(2)
    expect(selectReviewPackageDraft(store).reviewerIds).toEqual(['r1'])
  })

  it('returns nothing to undo when the draft was empty', () => {
    expect(store.discardReviewPackageDraft()).toBeNull()
  })

  it('leaves the sent state when files are added', () => {
    store.setReviewPackageLastSent({
      reviewId: 'r',
      title: 'T',
      itemCount: 1,
      reviewerCount: 1,
      skipped: [],
    })
    store.addReviewPackageItems([item('a')])
    expect(store.reviewPackageLastSent).toBeNull()
  })

  it('openReview switches to the Reviews view, opens the review and gives the slot to its comments', () => {
    store.setReviewPackagePaneOpen(true)
    store.setActiveGateReviewId('gate-1')
    store.openReview('rev-1', 'item-2')
    expect(store.activeView).toBe('reviews')
    expect(store.activeReviewId).toBe('rev-1')
    expect(store.activeReviewItemId).toBe('item-2')
    expect(store.activeGateReviewId).toBeNull()
    expect(store.reviewPackagePaneOpen).toBe(false)
  })

  it('an open review and an open gate clear each other', () => {
    store.setActiveReviewId('rev-1', 'item-1')
    store.setActiveGateReviewId('gate-1')
    expect(store.activeReviewId).toBeNull()
    expect(store.activeReviewItemId).toBeNull()
    store.setActiveReviewId('rev-2')
    expect(store.activeGateReviewId).toBeNull()
    expect(store.activeReviewId).toBe('rev-2')
  })

  it('patches the queue view', () => {
    expect(store.reviewQueueView).toEqual({ bucket: 'awaiting_me', teamId: null, search: '' })
    store.setReviewQueueView({ bucket: 'my_teams', teamId: 't1' })
    store.setReviewQueueView({ search: 'bracket' })
    expect(store.reviewQueueView).toEqual({ bucket: 'my_teams', teamId: 't1', search: 'bracket' })
  })
})
