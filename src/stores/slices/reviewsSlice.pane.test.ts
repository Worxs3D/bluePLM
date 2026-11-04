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
      activeView: 'explorer',
      rightPanelTabs: ['properties'],
      extensionRightPanel: null,
      extensionWorkspaces: [],
      itemPanel: null,
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

  it('shows the pane when the right panel is toggled on with nothing else in it', () => {
    store = { ...store, rightPanelTabs: [], rightPanelVisible: false }
    expect(selectReviewPackagePaneShown(store)).toBe(false)
    store.toggleRightPanel()
    expect(store.reviewPackagePaneOpen).toBe(false)
    expect(selectReviewPackagePaneShown(store)).toBe(true)
  })

  it('shows the pane in the Reviews view while no review is open, not over its comments', () => {
    store = { ...store, activeView: 'reviews', activeReviewId: null } as PDMStoreState
    expect(selectReviewPackagePaneShown(store)).toBe(true)
    store = { ...store, activeReviewId: 'review-1' }
    expect(selectReviewPackagePaneShown(store)).toBe(false)
  })

  it('shows the pane in the Workflows view, which has no right-panel content of its own', () => {
    store = { ...store, activeView: 'workflows' } as PDMStoreState
    expect(selectReviewPackagePaneShown(store)).toBe(true)
  })

  it('leaves the file tabs and the Items BOM panel in place when the pane is not open', () => {
    expect(selectReviewPackagePaneShown(store)).toBe(false)
    store = { ...store, activeView: 'items', itemPanel: {} } as unknown as PDMStoreState
    expect(selectReviewPackagePaneShown(store)).toBe(false)
  })

  it('closing a fallback pane hides the right panel, so close does not leave it on screen', () => {
    store = { ...store, rightPanelTabs: [] }
    store.setReviewPackagePaneOpen(true)
    store.closeReviewPackagePane()
    expect(store.rightPanelVisible).toBe(false)
    expect(selectReviewPackagePaneShown(store)).toBe(false)
  })

  it('closing an opened pane over file tabs keeps the right panel for the tabs', () => {
    store.setReviewPackagePaneOpen(true)
    store.closeReviewPackagePane()
    expect(store.rightPanelVisible).toBe(true)
    expect(selectReviewPackagePaneShown(store)).toBe(false)
  })
})
