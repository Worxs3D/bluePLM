/**
 * The `reviews` entry: the Reviews submenu (new review, add to / remove from a review, view
 * reviews). `ReviewsSubmenu` draws nothing without a reviewable file, and this asks the same
 * question first (`reviewableFiles`), so the menu knows whether the entry applies.
 */
import { ReviewsSubmenu } from '@/features/source/reviewPackage/components/ReviewsSubmenu'
import { reviewableFiles } from '@/features/source/reviewPackage/lib/localCopy'

import type { EntryHookResult } from '../customizable/types'
import type { ActionComponentProps } from './types'

export function useReviewsEntries({
  contextFiles,
  onClose,
}: Pick<ActionComponentProps, 'contextFiles' | 'onClose'>): EntryHookResult<'reviews'> {
  return {
    entries: {
      reviews:
        reviewableFiles(contextFiles).length > 0 ? (
          <ReviewsSubmenu contextFiles={contextFiles} onClose={onClose} />
        ) : null,
    },
  }
}
