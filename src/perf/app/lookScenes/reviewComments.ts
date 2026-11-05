/**
 * ui-look scenes for comments' server side (schema 514): review comments arriving as notifications
 * (one toast, a burst summary, a mixed stack) and Resolve offered only where the database allows it
 * (`file_comment_list_resolvable`), on a vault PDF's comments outside any review.
 *
 * Built by createReviewLook (review.ts), which hands over its reset, actor switch and helpers; the
 * comments go in through `reviews.addComment`, so the fake trigger in lookReviewComments.ts writes
 * the notifications as 0514_review_comment_notify.sql does.
 */
import type { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import type { PerfBackend } from '../backend'
import type { LookPersonKey, LookReviews } from '../lookReviewBackend'
import { LOOK_REVIEW_FILE_IDS, LOOK_REVIEW_PEOPLE } from '../lookReviewFixtures'

type Store = typeof usePDMStore
type Decision = 'approved' | 'approved_with_comments' | 'changes_requested' | 'rejected'

export interface ReviewCommentSceneContext {
  store: Store
  backend: PerfBackend
  reviews: LookReviews
  ids: Record<string, string>
  reset: () => Promise<void>
  actAs: (key: string) => Promise<void>
  showExplorer: (options?: { pane?: boolean; tabs?: boolean }) => void
  showReviews: (reviewId?: string, fileName?: string, bucket?: string) => Promise<void>
  itemOf: (reviewId: string, fileName: string) => string
  decide: (by: LookPersonKey, reviewId: string, decisions: Array<[string, Decision, string?]>) => unknown
  /** Paths a scene added to the file list, dropped again by the next reset. */
  addedPaths: Set<string>
}

/** A PDF in the review folder, outside any review, with comments of its own. */
const MARKUP_PDF_ID = '00000000-0000-4000-8000-9a7e0000f001'
const MARKUP_PDF = 'PMP-2001 vendor markup.pdf'
/** A vault the perf user is not in: explorer edit there does not reach the PDF's vault. */
const OTHER_VAULT_ID = '00000000-0000-4000-8000-9a7e0000fa01'

export function reviewCommentScenes(ctx: ReviewCommentSceneContext): Record<string, () => Promise<void>> {
  const { store, backend, reviews, ids, reset, actAs, showExplorer, showReviews, itemOf, decide, addedPaths } = ctx
  const { db } = backend

  const comment = (reviewId: string, fileName: string, user: LookPersonKey, text: string, at?: [number, number]) =>
    reviews.addComment({ reviewId, itemId: itemOf(reviewId, fileName), fileName, user, text, at })

  /** A reviewer's comment, then the explorer as `person`, whose notification arrives as a toast. */
  const notified = async (person: string) => {
    await reset()
    comment(ids.housing, 'PMP-2001.SLDDRW', 'sam', 'Bore has no tolerance. H7 like the impeller seat?', [520, 300])
    showExplorer({ pane: false })
    await actAs(person)
  }

  /** The vault PDF and its two comments (Sam's, and one by `person`), shown in the file preview as `person`. */
  const fileComments = async (person: LookPersonKey, editVaults: 'all' | string[]) => {
    await reset()
    const source = db.rows('file').find((f) => f.id === LOOK_REVIEW_FILE_IDS['PMP-2001.SLDDRW'])
    if (!source) throw new Error('look: no PMP-2001.SLDDRW row')
    db.removeRows('file_comment', db.rows('file_comment').filter((c) => c.file_id === MARKUP_PDF_ID))
    db.removeRows('file', db.rows('file').filter((f) => f.id === MARKUP_PDF_ID))
    const folder = String(source.file_path).replace(/[^/]+$/, '')
    db.seed('file', { ...source, id: MARKUP_PDF_ID, file_name: MARKUP_PDF, file_path: `${folder}${MARKUP_PDF}`, extension: '.pdf' })
    const at = (x: number, y: number) => ({ x, y, width: 80, height: 50, pageWidth: 1224, pageHeight: 792 })
    db.seed('file_comment', {
      file_id: MARKUP_PDF_ID, user_id: LOOK_REVIEW_PEOPLE.sam.id, comment: 'The vendor asks for 0.05 on the bore instead of H7.',
      page_number: 1, position: at(500, 280), annotation_type: 'text', file_version: Number(source.version ?? 1),
    })
    db.seed('file_comment', {
      file_id: MARKUP_PDF_ID, user_id: reviews.personId(person), comment: 'Checked against the purchase order.',
      page_number: 1, position: at(820, 600), annotation_type: 'text', file_version: Number(source.version ?? 1),
    })
    reviews.setExplorerEdit(person, editVaults)
    await actAs(person)

    const template = store.getState().files.find((f) => f.pdmData?.id === LOOK_REVIEW_FILE_IDS['PMP-2001.SLDDRW'])
    if (!template?.pdmData) throw new Error('look: PMP-2001.SLDDRW is not in the file list')
    const path = template.path.replace(/[^\\/]+$/, MARKUP_PDF)
    const pdf: LocalFile = {
      ...template,
      name: MARKUP_PDF,
      path,
      relativePath: template.relativePath.replace(/[^\\/]+$/, MARKUP_PDF),
      extension: '.pdf',
      pdmData: { ...template.pdmData, id: MARKUP_PDF_ID, file_name: MARKUP_PDF, file_path: `${folder}${MARKUP_PDF}`, extension: '.pdf' },
    }
    addedPaths.add(path)
    store.setState((s) => ({ files: [...s.files.filter((f) => f.path !== path), pdf] }))
    showExplorer({ pane: false })
    store.setState({
      selectedFiles: [path],
      detailsPanelVisible: true,
      detailsPanelTab: 'preview',
      detailsPanelHeight: 560,
      rightPanelVisible: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  return {
    // Sam marks up the housing drawing: the author (requester) and Alex (the other reviewer) hear of it.
    'review-comment-notified-author': () => notified('author'),
    'review-comment-notified-reviewer': () => notified('alex'),
    // The same toast while another review is open (the impeller kickback, on its part).
    'review-comment-notified-in-review': async () => {
      await reset()
      comment(ids.housing, 'PMP-2001.SLDDRW', 'sam', 'Bore has no tolerance. H7 like the impeller seat?', [520, 300])
      await showReviews(ids.kickback, 'PMP-2002.SLDPRT', 'requested_by_me')
      await actAs('author')
    },
    // Sam comments on four reviews the author is part of: one "4 review updates" toast.
    'review-comment-notified-burst': async () => {
      await reset()
      comment(ids.housing, 'PMP-2001.SLDDRW', 'sam', 'Section A-A: 2.8 mm is fine.')
      comment(ids.impeller, 'PMP-2002.SLDDRW', 'sam', 'Balance hole PCD dimension is missing.')
      comment(ids.kickback, 'PMP-2002.SLDPRT', 'sam', 'Still 40 mm in the sketch.')
      comment(ids.pumpCheck, 'PMP-2000.SLDDRW', 'sam', 'BOM item 3 has the old part number.')
      showExplorer({ pane: false })
      await actAs('author')
    },
    // Three different updates for the author, each its own toast: two comments (one deduplicated
    // away: Alex's on the same review within the hour) and a decision.
    'review-comment-notified-mixed': async () => {
      await reset()
      comment(ids.housing, 'PMP-2001.SLDDRW', 'sam', 'Bore has no tolerance.')
      comment(ids.housing, 'PMP-2001.SLDDRW', 'alex', 'Agree with Sam on the bore.')
      decide('alex', ids.housing, [['PMP-2001.SLDPRT', 'approved']])
      comment(ids.flange, 'PMP-2004.SLDDRW', 'sam', 'Can you check the bolt circle before I send it out?')
      showExplorer({ pane: false })
      await actAs('author')
    },
    // Olive has explorer edit on another vault only: Resolve on her own comment, not on Sam's.
    'file-comments-resolve-other-vault': () => fileComments('olive', [OTHER_VAULT_ID]),
    // With edit on this vault, both.
    'file-comments-resolve-this-vault': () => fileComments('olive', 'all'),
  }
}
