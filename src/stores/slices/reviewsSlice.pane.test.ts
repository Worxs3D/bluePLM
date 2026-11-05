import { beforeEach, describe, expect, it } from 'vitest'
import type { StateCreator } from 'zustand'

import {
  createReviewsSlice,
  rightPaneContent,
  rightPaneLabelKey,
  rightPaneShown,
  selectReviewPackagePaneShown,
  type ReviewsSlice,
} from './reviewsSlice'
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
      user: { id: 'u1' },
      organization: { id: 'org' },
      reviewCommentsVisible: true,
      toggleReviewComments: () => set((s) => ({ reviewCommentsVisible: !s.reviewCommentsVisible })),
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

  describe('one toggle, one right-hand slot', () => {
    const draftItem = {
      fileId: 'f1',
      fileVersionId: 'v1',
      version: 1,
      revision: null,
      state: null,
      fileName: 'a.slddrw',
      filePath: 'a.slddrw',
      extension: '.slddrw',
      vaultId: 'vault',
      latestVersion: 1,
    }

    it('names the file tabs in the explorer', () => {
      expect(rightPaneContent(store)).toBe('details')
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.hideDetails')
      store.toggleRightPane()
      expect(store.rightPanelVisible).toBe(false)
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.showDetails')
    })

    it('names the reviews pane where it fills the slot, and the draft once it holds files', () => {
      store = { ...store, rightPanelTabs: [] }
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.hideReviewsPane')
      store.addReviewPackageItems([draftItem])
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.hideReviewDraft')
      store = { ...store, activeView: 'workflows' } as PDMStoreState
      expect(rightPaneContent(store)).toBe('reviewDraft')
    })

    it('toggles the comment sidebar of an open review, not the right panel', () => {
      store = { ...store, activeView: 'reviews', activeReviewId: 'r1' } as PDMStoreState
      expect(rightPaneContent(store)).toBe('comments')
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.hideComments')
      store.toggleRightPane()
      expect(store.reviewCommentsVisible).toBe(false)
      expect(store.rightPanelVisible).toBe(true)
      expect(rightPaneShown(store)).toBe(false)
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.showComments')
    })

    it('in an open review, a builder opened on purpose takes the slot and hiding it brings the comments back', () => {
      store = { ...store, activeView: 'reviews', activeReviewId: 'r1' } as PDMStoreState
      store.addReviewPackageItems([draftItem])
      store.setReviewPackagePaneOpen(true)
      expect(selectReviewPackagePaneShown(store)).toBe(true)
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.hideReviewDraft')
      store.toggleRightPane()
      expect(store.reviewPackagePaneOpen).toBe(false)
      expect(selectReviewPackagePaneShown(store)).toBe(false)
      expect(rightPaneContent(store)).toBe('comments')
      expect(rightPaneShown(store)).toBe(true)
    })

    it('names a view panel (Items BOM panel)', () => {
      store = { ...store, activeView: 'items', itemPanel: {} } as unknown as PDMStoreState
      expect(rightPaneLabelKey(store)).toBe('app.panelToggle.hidePanel')
    })
  })
})
