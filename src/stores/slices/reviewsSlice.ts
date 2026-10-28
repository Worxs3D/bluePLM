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
    setReviewPackagePaneOpen: (reviewPackagePaneOpen) => set({ reviewPackagePaneOpen }),
    setActiveReviewId: (activeReviewId, itemId = null) =>
      set({ activeReviewId, activeReviewItemId: activeReviewId ? itemId : null }),
    setActiveReviewItemId: (activeReviewItemId) => set({ activeReviewItemId }),
    requestReviewQueueRefresh: () =>
      set((s) => ({ reviewQueueRefreshTick: s.reviewQueueRefreshTick + 1 })),
  }
}
