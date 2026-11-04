/**
 * Reviews Slice
 *
 * Holds the review draft the requester builds in the right-panel pane, which review (or workflow
 * gate) the Reviews view has open, the queue's bucket, team and search, and the one top-bar
 * toggle that owns the right-hand pane.
 *
 * Drafts are keyed by user and organization (`reviewDraftKey`) and persisted
 * (`reviewPackageDrafts` in `pdmStore.ts`'s `partialize`), so a draft built over an afternoon
 * survives a restart, one account never sees another's draft on a shared machine, and a user in
 * two organizations never carries one organization's files into the other's draft. A draft saved
 * before drafts were per organization (keyed by user id alone) is read as the current
 * organization's and moved there on its first change. Everything else here is session state.
 */

import { StateCreator } from 'zustand'

import type { ReviewPackageDraft, ReviewPackageDraftItem } from '../../types/reviewPackageDraft'
import type { ReviewerSkipReason, ReviewQueueBucket } from '../../types/reviews'
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

/** The last review the pane sent, shown in its "Review requested" state until dismissed. */
export interface ReviewPackageSent {
  reviewId: string
  title: string
  itemCount: number
  reviewerCount: number
  /** Team members the server left out, by user id (names come from the directory). */
  skipped: { userId: string; reason: ReviewerSkipReason }[]
}

/** Files about to be added to an open review, waiting for the confirm that names their versions. */
export interface ReviewAddConfirm {
  reviewId: string
  title: string
  versions: { fileVersionId: string; fileName: string; version: number }[]
  /** Files left out because they have no checked-in version. */
  skipped: number
}

/** The Reviews sidebar queue's filters. Kept for the session so leaving the view keeps them. */
export interface ReviewQueueView {
  bucket: ReviewQueueBucket
  /** `my_teams` only: one team, or null for all of them. */
  teamId: string | null
  search: string
}

export const DEFAULT_REVIEW_QUEUE_VIEW: ReviewQueueView = {
  bucket: 'awaiting_me',
  teamId: null,
  search: '',
}

export interface ReviewsSlice {
  /** Per `reviewDraftKey(userId, orgId)` (older drafts: per user id). Persisted. */
  reviewPackageDrafts: Record<string, ReviewPackageDraft>
  reviewPackagePaneOpen: boolean
  /** The review the pane just sent; its "Review requested" state shows until dismissed. */
  reviewPackageLastSent: ReviewPackageSent | null
  /** The review open in the Reviews view's main area. */
  activeReviewId: string | null
  /** The item of the active review being looked at. */
  activeReviewItemId: string | null
  /** The workflow gate (`pending_reviews.id`) open in the Reviews view's main area. */
  activeGateReviewId: string | null
  reviewQueueView: ReviewQueueView
  /** The add-to-open-review confirm on screen (`ReviewAddConfirmDialog`, mounted once in AppShell). */
  reviewAddConfirm: ReviewAddConfirm | null
  /** Bumped after any review write so the queue and badge reload. */
  reviewQueueRefreshTick: number

  addReviewPackageItems: (items: ReviewPackageDraftItem[]) => Omit<AddItemsOutcome, 'draft'>
  removeReviewPackageItem: (fileId: string) => void
  toggleReviewPackageReviewer: (userId: string) => void
  toggleReviewPackageTeam: (teamId: string) => void
  updateReviewPackageDraft: (patch: DraftMetaPatch) => void
  /** Drop the draft without keeping it (after a send). */
  clearReviewPackageDraft: () => void
  /** Drop the draft and return it, for an Undo; null when there was nothing to discard. */
  discardReviewPackageDraft: () => ReviewPackageDraft | null
  /** Put a discarded draft back (Undo). Replaces whatever draft exists now. */
  restoreReviewPackageDraft: (draft: ReviewPackageDraft) => void
  setReviewPackageLastSent: (sent: ReviewPackageSent | null) => void
  setReviewPackagePaneOpen: (open: boolean) => void
  /**
   * The pane's close button: closes the pane, and hides the right panel too when the pane would
   * otherwise stay on screen as its fallback content.
   */
  closeReviewPackagePane: () => void
  /** Open a review in the Reviews view: the one way to navigate to a review. */
  openReview: (reviewId: string, itemId?: string | null) => void
  /** Clears the active gate. */
  setActiveReviewId: (reviewId: string | null, itemId?: string | null) => void
  setActiveReviewItemId: (itemId: string | null) => void
  /** Clears the active review. */
  setActiveGateReviewId: (gateReviewId: string | null) => void
  setReviewQueueView: (patch: Partial<ReviewQueueView>) => void
  setReviewAddConfirm: (pending: ReviewAddConfirm | null) => void
  requestReviewQueueRefresh: () => void
  /** The top bar's right-pane toggle: shows or hides whatever `rightPaneContent` names. */
  toggleRightPane: () => void
}

/** The persisted key of a user's draft in one organization. */
export function reviewDraftKey(userId: string, orgId: string | null | undefined): string {
  return `${userId}:${orgId ?? ''}`
}

/** The signed-in user's draft in the current organization, or an empty one. */
export function selectReviewPackageDraft(state: PDMStoreState): ReviewPackageDraft {
  const userId = state.user?.id
  if (!userId) return EMPTY_DRAFT
  const drafts = state.reviewPackageDrafts
  return drafts[reviewDraftKey(userId, state.organization?.id)] ?? drafts[userId] ?? EMPTY_DRAFT
}

const EMPTY_DRAFT: ReviewPackageDraft = emptyReviewPackageDraft()

/**
 * Whether the right panel has nothing of its own to show, so the review pane fills it. Mirrors the
 * owners `AppShell` and `RightPanel` check: an extension workspace's own panel, the Items view's
 * BOM panel, the Reviews view's comment sidebar for an open review, and the file tabs elsewhere.
 * Views that own the main area (Workflows, Reviews, extension workspaces without a panel) never
 * show file tabs there.
 */
export function rightPanelHasNoOtherContent(state: PDMStoreState): boolean {
  const view = state.activeView
  if (state.extensionRightPanel && state.extensionRightPanel === view) return false
  if (state.extensionWorkspaces.some((w) => w.id === view)) return true
  if (view === 'items') return !state.itemPanel
  // An open review's comments; a workflow gate has none, so the review pane fills the slot.
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

/**
 * What occupies the one right-hand slot of the current view (or would, once shown):
 * - `comments`: the comment sidebar beside an open review's drawing (its own visibility flag);
 * - `reviewDraft` / `reviewsPane`: the review pane, holding a draft or not (empty or sent state);
 * - `panel`: the Items view's BOM panel or an extension workspace's panel;
 * - `details`: the file tabs.
 * In the Reviews view with a review open, an explicitly opened review pane takes the slot and the
 * comment sidebar is hidden until it closes, so there are never two right-hand panes.
 */
export type RightPaneContent = 'comments' | 'reviewDraft' | 'reviewsPane' | 'panel' | 'details'

export function rightPaneContent(state: PDMStoreState): RightPaneContent {
  const reviewOpen = state.activeView === 'reviews' && !!state.activeReviewId
  if (reviewOpen && !state.reviewPackagePaneOpen) return 'comments'
  if (state.reviewPackagePaneOpen || rightPanelHasNoOtherContent(state)) {
    const hasDraft = selectReviewPackageDraft(state).items.length > 0
    return hasDraft && !state.reviewPackageLastSent ? 'reviewDraft' : 'reviewsPane'
  }
  if (state.activeView === 'items' || state.extensionRightPanel === state.activeView) return 'panel'
  return 'details'
}

/** Whether the right-hand slot is showing. */
export function rightPaneShown(state: PDMStoreState): boolean {
  return rightPaneContent(state) === 'comments'
    ? state.reviewCommentsVisible
    : state.rightPanelVisible
}

/** The toggle's tooltip, as an `app.panelToggle.*` key: what it would show or hide. */
export function rightPaneLabelKey(state: PDMStoreState): string {
  const verb = rightPaneShown(state) ? 'hide' : 'show'
  const noun = {
    comments: 'Comments',
    reviewDraft: 'ReviewDraft',
    reviewsPane: 'ReviewsPane',
    panel: 'Panel',
    details: 'Details',
  }[rightPaneContent(state)]
  return `app.panelToggle.${verb}${noun}`
}

export const createReviewsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ReviewsSlice
> = (set, get) => {
  /** Apply `fn` to the signed-in user's draft in this organization. No user, no draft. */
  const updateDraft = (fn: (draft: ReviewPackageDraft) => ReviewPackageDraft) => {
    const userId = get().user?.id
    if (!userId) return
    const key = reviewDraftKey(userId, get().organization?.id)
    set((s) => {
      const current = s.reviewPackageDrafts[key] ?? s.reviewPackageDrafts[userId]
      const base = current ?? emptyReviewPackageDraft()
      const next = fn(base)
      if (next === base) return {}
      const drafts = { ...s.reviewPackageDrafts, [key]: next }
      // A pre-organization draft moves to this organization on its first change.
      delete drafts[userId]
      return { reviewPackageDrafts: drafts }
    })
  }

  /** Remove the draft (both keys); returns what was there. */
  const takeDraft = (): ReviewPackageDraft | null => {
    const userId = get().user?.id
    if (!userId) return null
    const key = reviewDraftKey(userId, get().organization?.id)
    const drafts = get().reviewPackageDrafts
    const taken = drafts[key] ?? drafts[userId] ?? null
    if (!(key in drafts) && !(userId in drafts)) return null
    const next = { ...drafts }
    delete next[key]
    delete next[userId]
    set({ reviewPackageDrafts: next })
    return taken
  }

  return {
    reviewPackageDrafts: {},
    reviewPackagePaneOpen: false,
    reviewPackageLastSent: null,
    activeReviewId: null,
    activeReviewItemId: null,
    activeGateReviewId: null,
    reviewQueueView: DEFAULT_REVIEW_QUEUE_VIEW,
    reviewAddConfirm: null,
    reviewQueueRefreshTick: 0,

    addReviewPackageItems: (items) => {
      let outcome: Omit<AddItemsOutcome, 'draft'> = { added: 0, replaced: 0, dropped: 0 }
      updateDraft((draft) => {
        const result = addDraftItems(draft, items)
        outcome = { added: result.added, replaced: result.replaced, dropped: result.dropped }
        return result.draft
      })
      // Adding files starts the next review: the pane leaves its "Review requested" state.
      if (get().reviewPackageLastSent) set({ reviewPackageLastSent: null })
      return outcome
    },
    removeReviewPackageItem: (fileId) => updateDraft((d) => removeDraftItem(d, fileId)),
    toggleReviewPackageReviewer: (userId) => updateDraft((d) => toggleDraftReviewer(d, userId)),
    toggleReviewPackageTeam: (teamId) => updateDraft((d) => toggleDraftTeam(d, teamId)),
    updateReviewPackageDraft: (patch) => updateDraft((d) => patchDraftMeta(d, patch)),
    clearReviewPackageDraft: () => {
      takeDraft()
    },
    discardReviewPackageDraft: () => {
      const taken = takeDraft()
      return taken && taken.items.length + taken.reviewerIds.length + taken.teamIds.length > 0
        ? taken
        : null
    },
    restoreReviewPackageDraft: (draft) => updateDraft(() => draft),
    setReviewPackageLastSent: (reviewPackageLastSent) => set({ reviewPackageLastSent }),
    setReviewPackagePaneOpen: (reviewPackagePaneOpen) => {
      set({ reviewPackagePaneOpen })
      // Opening asks for the pane explicitly, so a hidden right panel comes back with it.
      if (reviewPackagePaneOpen && !get().rightPanelVisible) get().toggleRightPanel()
    },
    closeReviewPackagePane: () => {
      set({ reviewPackagePaneOpen: false })
      if (get().rightPanelVisible && rightPanelHasNoOtherContent(get())) get().toggleRightPanel()
    },
    openReview: (reviewId, itemId = null) => {
      // The review's own comment sidebar takes the right-hand slot; the draft is kept.
      set({
        activeReviewId: reviewId,
        activeReviewItemId: itemId,
        activeGateReviewId: null,
        reviewPackagePaneOpen: false,
      })
      if (get().activeView !== 'reviews') get().setActiveView('reviews')
    },
    setActiveReviewId: (activeReviewId, itemId = null) =>
      set((s) => ({
        activeReviewId,
        activeReviewItemId: activeReviewId ? itemId : null,
        activeGateReviewId: activeReviewId ? null : s.activeGateReviewId,
      })),
    setActiveReviewItemId: (activeReviewItemId) => set({ activeReviewItemId }),
    setActiveGateReviewId: (activeGateReviewId) =>
      set((s) => ({
        activeGateReviewId,
        activeReviewId: activeGateReviewId ? null : s.activeReviewId,
        activeReviewItemId: activeGateReviewId ? null : s.activeReviewItemId,
      })),
    setReviewQueueView: (patch) => set((s) => ({ reviewQueueView: { ...s.reviewQueueView, ...patch } })),
    setReviewAddConfirm: (reviewAddConfirm) => set({ reviewAddConfirm }),
    requestReviewQueueRefresh: () =>
      set((s) => ({ reviewQueueRefreshTick: s.reviewQueueRefreshTick + 1 })),
    toggleRightPane: () => {
      const state = get()
      const content = rightPaneContent(state)
      if (content === 'comments') {
        state.toggleReviewComments()
        return
      }
      // A review pane opened over an open review's comments: hiding it brings the comments back.
      if (
        state.activeView === 'reviews' &&
        state.activeReviewId &&
        state.reviewPackagePaneOpen &&
        state.rightPanelVisible
      ) {
        state.closeReviewPackagePane()
        return
      }
      state.toggleRightPanel()
    },
  }
}
