/**
 * Reviews Slice
 *
 * Holds the review package draft the requester builds in the right-panel pane, and which review
 * the Reviews view has open.
 *
 * Drafts are keyed by user id and persisted (`reviewPackageDrafts` in `pdmStore.ts`'s
 * `partialize`), so a package built over an afternoon survives a restart and one account never
 * sees another's draft on a shared machine. Everything else here is session state: which review
 * is open, whether the pane is showing, and a counter views watch to reload the queue.
 */

import { StateCreator } from 'zustand'

import type { ReviewPackageDraft, ReviewPackageDraftItem } from '../../types/reviewPackageDraft'
import type { PDMStoreState } from '../types'
import {
  addDraftItems,
  emptyReviewPackageDraft,
  patchDraftMeta,
  removeDraftItem,
  toggleDraftReviewer,
  toggleDraftTeam,
  type AddItemsOutcome,
  type DraftMetaPatch,
} from './reviewsDraft'

export interface ReviewsSlice {
  /** Per user id. Persisted. */
  reviewPackageDrafts: Record<string, ReviewPackageDraft>
  reviewPackagePaneOpen: boolean
  /** The review open in the Reviews view's main area. */
  activeReviewId: string | null
  /** The item of the active review being looked at. */
  activeReviewItemId: string | null
  /** Bumped after any review write so the queue and badge reload. */
  reviewQueueRefreshTick: number

  addReviewPackageItems: (items: ReviewPackageDraftItem[]) => Omit<AddItemsOutcome, 'draft'>
  removeReviewPackageItem: (fileId: string) => void
  toggleReviewPackageReviewer: (userId: string) => void
  toggleReviewPackageTeam: (teamId: string) => void
  updateReviewPackageDraft: (patch: DraftMetaPatch) => void
  clearReviewPackageDraft: () => void
  setReviewPackagePaneOpen: (open: boolean) => void
  /**
   * The pane's close button: closes the pane, and hides the right panel too when the pane would
   * otherwise stay on screen as its fallback content.
   */
  closeReviewPackagePane: () => void
  setActiveReviewId: (reviewId: string | null, itemId?: string | null) => void
  setActiveReviewItemId: (itemId: string | null) => void
  requestReviewQueueRefresh: () => void
}

/** The signed-in user's draft, or an empty one. */
export function selectReviewPackageDraft(state: PDMStoreState): ReviewPackageDraft {
  const userId = state.user?.id
  return (userId && state.reviewPackageDrafts[userId]) || EMPTY_DRAFT
}

const EMPTY_DRAFT: ReviewPackageDraft = emptyReviewPackageDraft()

/**
 * Whether the right panel has nothing of its own to show, so the review pane fills it. Mirrors the
 * owners `AppShell` and `RightPanel` check: an extension workspace's own panel, the Items view's
 * BOM panel, the Reviews view's comment sidebar for an open review, and the file tabs elsewhere.
 * Views that own the main area (Workflows, extension workspaces without a panel) have none.
 */
export function rightPanelHasNoOtherContent(state: PDMStoreState): boolean {
  const view = state.activeView
  if (state.extensionRightPanel && state.extensionRightPanel === view) return false
  if (state.extensionWorkspaces.some((w) => w.id === view)) return true
  if (view === 'items') return !state.itemPanel
  if (view === 'reviews') return !state.activeReviewId
  if (view === 'workflows') return true
  return state.rightPanelTabs.length === 0
}

/**
 * Whether the review package pane is on screen. It lives in the right panel, so the top bar's
 * right-pane toggle hides and shows it like any other right-panel content; the draft is in the
 * store, so hiding loses nothing. It shows when it was opened (a context menu or the toggle), and
 * whenever the right panel is shown with nothing else to put in it, so the toggle never opens an
 * empty pane.
 */
export function selectReviewPackagePaneShown(state: PDMStoreState): boolean {
  if (!state.rightPanelVisible) return false
  return state.reviewPackagePaneOpen || rightPanelHasNoOtherContent(state)
}

export const createReviewsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ReviewsSlice
> = (set, get) => {
  /** Apply `fn` to the signed-in user's draft. No user, no draft. */
  const updateDraft = (fn: (draft: ReviewPackageDraft) => ReviewPackageDraft) => {
    const userId = get().user?.id
    if (!userId) return
    set((s) => {
      const current = s.reviewPackageDrafts[userId] ?? emptyReviewPackageDraft()
      const next = fn(current)
      if (next === current) return {}
      return { reviewPackageDrafts: { ...s.reviewPackageDrafts, [userId]: next } }
    })
  }

  return {
    reviewPackageDrafts: {},
    reviewPackagePaneOpen: false,
    activeReviewId: null,
    activeReviewItemId: null,
    reviewQueueRefreshTick: 0,

    addReviewPackageItems: (items) => {
      let outcome: Omit<AddItemsOutcome, 'draft'> = { added: 0, replaced: 0, dropped: 0 }
      updateDraft((draft) => {
        const result = addDraftItems(draft, items)
        outcome = { added: result.added, replaced: result.replaced, dropped: result.dropped }
        return result.draft
      })
      return outcome
    },
    removeReviewPackageItem: (fileId) => updateDraft((d) => removeDraftItem(d, fileId)),
    toggleReviewPackageReviewer: (userId) => updateDraft((d) => toggleDraftReviewer(d, userId)),
    toggleReviewPackageTeam: (teamId) => updateDraft((d) => toggleDraftTeam(d, teamId)),
    updateReviewPackageDraft: (patch) => updateDraft((d) => patchDraftMeta(d, patch)),
    clearReviewPackageDraft: () => {
      const userId = get().user?.id
      if (!userId) return
      set((s) => {
        if (!(userId in s.reviewPackageDrafts)) return {}
        const next = { ...s.reviewPackageDrafts }
        delete next[userId]
        return { reviewPackageDrafts: next }
      })
    },
    setReviewPackagePaneOpen: (reviewPackagePaneOpen) => {
      set({ reviewPackagePaneOpen })
      // Opening asks for the pane explicitly, so a hidden right panel comes back with it.
      if (reviewPackagePaneOpen && !get().rightPanelVisible) get().toggleRightPanel()
    },
    closeReviewPackagePane: () => {
      set({ reviewPackagePaneOpen: false })
      if (get().rightPanelVisible && rightPanelHasNoOtherContent(get())) get().toggleRightPanel()
    },
    setActiveReviewId: (activeReviewId, itemId = null) =>
      set({ activeReviewId, activeReviewItemId: activeReviewId ? itemId : null }),
    setActiveReviewItemId: (activeReviewItemId) => set({ activeReviewItemId }),
    requestReviewQueueRefresh: () =>
      set((s) => ({ reviewQueueRefreshTick: s.reviewQueueRefreshTick + 1 })),
  }
}
