import { beforeEach, describe, expect, it } from 'vitest'
import type { StateCreator } from 'zustand'

import { createReviewsSlice, selectReviewPackagePaneShown, type ReviewsSlice } from './reviewsSlice'
import type { PDMStoreState } from '../types'

type ReviewsSliceCreator = StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ReviewsSlice
>
type StoreSet = Parameters<ReviewsSliceCreator>[0]
type StoreGet = Parameters<ReviewsSliceCreator>[1]

describe('review package pane and the right-pane toggle', () => {
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
      rightPanelVisible: true,
      toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
    } as unknown as PDMStoreState
  })

  it('hides the open pane when the right panel is toggled off, and shows it again', () => {
    store.setReviewPackagePaneOpen(true)
    expect(selectReviewPackagePaneShown(store)).toBe(true)

    store.toggleRightPanel()
    expect(store.reviewPackagePaneOpen).toBe(true)
    expect(selectReviewPackagePaneShown(store)).toBe(false)

    store.toggleRightPanel()
    expect(selectReviewPackagePaneShown(store)).toBe(true)
  })

  it('opening the pane brings a hidden right panel back', () => {
    store.toggleRightPanel()
    expect(store.rightPanelVisible).toBe(false)

    store.setReviewPackagePaneOpen(true)
    expect(store.rightPanelVisible).toBe(true)
    expect(selectReviewPackagePaneShown(store)).toBe(true)
  })

  it('closing the pane leaves the right panel as it was', () => {
    store.setReviewPackagePaneOpen(true)
    store.setReviewPackagePaneOpen(false)
    expect(store.rightPanelVisible).toBe(true)
    expect(selectReviewPackagePaneShown(store)).toBe(false)
  })
})
