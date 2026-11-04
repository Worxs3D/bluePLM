/**
 * The "Reviews" submenu for a file or a multi-selection, in the primary section of both context-menu
 * systems (file list and explorer tree) so they cannot drift apart:
 *
 *   Reviews ▸ Start a review / Add to draft   the one unsent review; opens the pane
 *             Add to open review ▸            open reviews that take files (asks first)
 *             Remove from ▸                   the draft and open reviews holding the files
 *             Show reviews of this file
 *
 * Open reviews are looked up when the submenu opens (`listOpenReviewsForFiles`), never cached.
 */

import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, ListChecks, Loader2, MinusCircle, PlusCircle, Search, Send } from 'lucide-react'

import { ContextSubmenu } from '@/features/source/browser/components/ContextMenu/components'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { listOpenReviewsForFiles } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import { selectReviewPackageDraft } from '@/stores/slices/reviewsSlice'
import type { LocalFile } from '@/stores/types'
import type { OpenReviewForFiles } from '@/types/reviews'

import {
  addFilesToReviewPackage,
  removeFilesFromOpenReview,
  removeFilesFromReviewPackage,
  requestAddToOpenReview,
} from '../addToPackage'
import { reviewableFiles } from '../lib/localCopy'
import { reviewMenuTargets, showReviewsTarget } from '../lib/reviewMenuTargets'

interface ReviewsSubmenuProps {
  contextFiles: LocalFile[]
  onClose: () => void
}

type Open = 'none' | 'root' | 'add' | 'remove'

/** Hover-open with a short grace period, like the other context submenus. */
function useHover(setOpen: (fn: (o: Open) => Open) => void, level: Exclude<Open, 'none'>) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return {
    onMouseEnter: () => {
      if (timer.current) clearTimeout(timer.current)
      // Entering a nested submenu keeps it open; re-entering the root does not close a nested one.
      setOpen((o) => (level === 'root' && o !== 'none' ? o : level))
    },
    onMouseLeave: () => {
      // The nested submenus are DOM children of the root item, so leaving the root leaves them all.
      timer.current = setTimeout(
        () => setOpen((o) => (level === 'root' ? 'none' : o === level ? 'root' : o)),
        150,
      )
    },
  }
}

/** The first menu entry: "Start a review" with no draft, "Add to draft" with one. */
export function draftEntryLabel(draftItems: number, count: number): string {
  if (draftItems === 0) {
    return count > 1
      ? t('contextMenu.review.startReviewMany', { count })
      : t('contextMenu.review.startReview')
  }
  return count > 1
    ? t('contextMenu.review.addToDraftMany', { count })
    : t('contextMenu.review.addToDraft')
}

export function ReviewsSubmenu({ contextFiles, onClose }: ReviewsSubmenuProps) {
  const draft = usePDMStore(selectReviewPackageDraft)
  const [open, setOpen] = useState<Open>('none')
  const [reviews, setReviews] = useState<OpenReviewForFiles[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const reviewable = reviewableFiles(contextFiles)
  const fileIds = reviewable.map((f) => f.pdmData?.id).filter((id): id is string => !!id)
  const fileKey = fileIds.join(',')
  const rootOpen = open !== 'none'

  // Load once per opening of the submenu.
  useEffect(() => {
    if (!rootOpen || fileIds.length === 0) return
    let cancelled = false
    setReviews(null)
    setLoadFailed(false)
    listOpenReviewsForFiles(fileIds)
      .then((rows) => {
        if (!cancelled) setReviews(rows)
      })
      .catch((error: unknown) => {
        log.warn('[Reviews]', 'Listing open reviews for the context menu failed', { error })
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [rootOpen, fileKey]) // eslint-disable-line react-hooks/exhaustive-deps -- fileKey stands for fileIds

  const rootHover = useHover(setOpen, 'root')
  const addHover = useHover(setOpen, 'add')
  const removeHover = useHover(setOpen, 'remove')

  if (reviewable.length === 0) return null

  const targets = reviewMenuTargets(fileIds, draft.items, reviews ?? [])
  const count = reviewable.length
  const allInDraft = draft.items.length > 0 && !targets.addToDraft
  const run = (action: () => Promise<void>) => {
    onClose()
    void action()
  }

  const showReviews = () => {
    onClose()
    const s = usePDMStore.getState()
    const target = showReviewsTarget(fileIds, loadFailed ? null : reviews)
    if (target.kind === 'review') {
      s.openReview(target.reviewId)
      return
    }
    s.setReviewQueueView({
      bucket: target.bucket,
      teamId: null,
      search: reviewable.length === 1 ? reviewable[0].name : '',
    })
    s.setActiveReviewId(null)
    s.setActiveView('reviews')
  }

  const loadingRow = (
    <div className="context-menu-item opacity-60">
      <Loader2 size={14} className="animate-spin" />
      {t('contextMenu.review.loading')}
    </div>
  )
  const failedRow = (
    <div className="context-menu-item disabled text-plm-fg-muted">
      {t('contextMenu.review.loadFailed')}
    </div>
  )

  return (
    <div
      className="context-menu-item relative"
      {...rootHover}
      onClick={(e) => {
        e.stopPropagation()
        setOpen((o) => (o === 'none' ? 'root' : 'none'))
      }}
    >
      <ClipboardCheck size={14} className="text-plm-fg-dim" />
      {t('contextMenu.review.reviews')}
      <span className="text-xs text-plm-fg-muted ml-auto">▶</span>

      {rootOpen && (
        <ContextSubmenu minWidth={220} {...rootHover}>
          {/* Files already all in the draft: the entry just shows it. */}
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              if (allInDraft) {
                onClose()
                usePDMStore.getState().setReviewPackagePaneOpen(true)
                return
              }
              run(() => addFilesToReviewPackage(reviewable))
            }}
          >
            <Send size={14} className="text-plm-fg-dim" />
            {allInDraft ? t('contextMenu.review.showDraft') : draftEntryLabel(draft.items.length, count)}
          </div>

          {/* Add to open review ▸ */}
          <div className="context-menu-item relative" {...addHover} onClick={(e) => e.stopPropagation()}>
            <PlusCircle size={14} className="text-plm-fg-dim" />
            {t('contextMenu.review.addToOpen')}
            <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
            {open === 'add' && (
              <ContextSubmenu minWidth={220} {...addHover}>
                {loadFailed
                  ? failedRow
                  : reviews === null
                    ? loadingRow
                    : targets.addTo.map((review) => (
                        <div
                          key={review.reviewId}
                          className="context-menu-item"
                          title={t('contextMenu.review.reviewHint', { count: review.itemCount })}
                          onClick={(e) => {
                            e.stopPropagation()
                            run(() => requestAddToOpenReview(reviewable, review))
                          }}
                        >
                          <ListChecks size={14} className="text-plm-fg-dim" />
                          <span className="truncate max-w-[260px]">{review.title}</span>
                        </div>
                      ))}
                {reviews !== null && !loadFailed && targets.addTo.length === 0 && (
                  <div className="context-menu-item disabled text-plm-fg-muted">
                    {t('contextMenu.review.noneToAdd')}
                  </div>
                )}
              </ContextSubmenu>
            )}
          </div>

          {/* Remove from ▸ */}
          <div className="context-menu-item relative" {...removeHover} onClick={(e) => e.stopPropagation()}>
            <MinusCircle size={14} className="text-plm-fg-dim" />
            {t('contextMenu.review.removeFrom')}
            <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
            {open === 'remove' && (
              <ContextSubmenu minWidth={220} {...removeHover}>
                {targets.removeFromDraft > 0 && (
                  <div
                    className="context-menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                      removeFilesFromReviewPackage(fileIds)
                    }}
                  >
                    <Send size={14} className="text-plm-fg-dim" />
                    {t('contextMenu.review.draft', { count: draft.items.length })}
                  </div>
                )}
                {loadFailed
                  ? failedRow
                  : reviews === null
                    ? loadingRow
                    : targets.removeFrom.map((review) => (
                        <div
                          key={review.reviewId}
                          className="context-menu-item"
                          title={t('contextMenu.review.reviewHint', { count: review.itemCount })}
                          onClick={(e) => {
                            e.stopPropagation()
                            run(() => removeFilesFromOpenReview(review, fileIds))
                          }}
                        >
                          <ListChecks size={14} className="text-plm-fg-dim" />
                          <span className="truncate max-w-[260px]">{review.title}</span>
                        </div>
                      ))}
                {targets.removeFromDraft === 0 &&
                  reviews !== null &&
                  !loadFailed &&
                  targets.removeFrom.length === 0 && (
                    <div className="context-menu-item disabled text-plm-fg-muted">
                      {t('contextMenu.review.noneToRemove')}
                    </div>
                  )}
              </ContextSubmenu>
            )}
          </div>

          <div className="context-menu-separator" />
          <div
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation()
              showReviews()
            }}
          >
            <Search size={14} className="text-plm-fg-dim" />
            {count > 1 ? t('contextMenu.review.showReviewsMany') : t('contextMenu.review.showReviews')}
          </div>
        </ContextSubmenu>
      )}
    </div>
  )
}
