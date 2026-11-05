/**
 * The pinned version of one review item, with its comments. The bytes always come from the stored
 * PDF of that version (`resolveReviewItemPreview`), never the reviewer's local working copy
 * (audit C1/C2). Comments are keyed by (review, round, item); an earlier round's comments are shown
 * read-only, drawn on the PDF of the version that round reviewed, which may be older than the
 * version pinned now.
 *
 * Right of the drawing: Comments | Activity. The comments are numbered, and the same numbers are
 * drawn on the PDF; selecting a comment scrolls the drawing to it. "Comment" (M) turns comment
 * mode on in both the toolbar and the sidebar. The column is the right-hand slot of the top bar's
 * toggle; it hides while the review pane is opened over it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus2 } from 'lucide-react'

import { Button, EmptyState, SegmentedControl } from '@/components/core/ui'
import { CommentSidebar } from '@/features/source/details/components/CommentSidebar'
import { earlierRounds, numberThreads } from '@/features/source/details/components/commentThreads'
import {
  PdfAnnotationViewer,
  type AnnotationOverlay,
  type NewAnnotationData,
} from '@/features/source/details/components/PdfAnnotationViewer'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { useShortcutLabel, useShortcuts } from '@/lib/keybindings'
import { log } from '@/lib/logger'
import { resolveReviewItemPreview } from '@/lib/reviewPackage'
import { usePDMStore } from '@/stores/pdmStore'
import { rightPaneContent } from '@/stores/slices/reviewsSlice'
import type { ReviewDetail, ReviewItemDetail, ReviewUser } from '@/types/reviews'

import { ActivityPanel } from './ActivityPanel'

type Preview = Awaited<ReturnType<typeof resolveReviewItemPreview>>
type SideTab = 'comments' | 'activity'

/** The preview is a file in the review PDF cache, outside the vault `readFile` is confined to. */
function readCachedPdf(filePath: string) {
  const api = window.electronAPI
  return api ? api.reviewPackage.readCachedPdf(filePath) : Promise.resolve(undefined)
}

interface ItemPreviewProps {
  detail: ReviewDetail
  item: ReviewItemDetail
  /** The round whose comments are shown. */
  round: number
  /** Comments can be added (current round, open review, requester or reviewer). */
  canMarkup: boolean
  usersById: ReadonlyMap<string, ReviewUser>
  onShowRound: (round: number | null) => void
  /** The decision bar, under the drawing. */
  footer?: React.ReactNode
}

export function ItemPreview({
  detail,
  item,
  round,
  canMarkup,
  usersById,
  onShowRound,
  footer,
}: ItemPreviewProps) {
  const reviewId = detail.review.id
  const annotations = usePDMStore((s) => s.annotations)
  const annotationsLoading = usePDMStore((s) => s.annotationsLoading)
  const activeAnnotationId = usePDMStore((s) => s.activeAnnotationId)
  const hoveredAnnotationId = usePDMStore((s) => s.hoveredAnnotationId)
  const setActiveAnnotationId = usePDMStore((s) => s.setActiveAnnotationId)
  const setHoveredAnnotationId = usePDMStore((s) => s.setHoveredAnnotationId)
  const setShowCommentInput = usePDMStore((s) => s.setShowCommentInput)
  const setPendingAnnotation = usePDMStore((s) => s.setPendingAnnotation)
  const pendingAnnotation = usePDMStore((s) => s.pendingAnnotation)
  const clearAnnotations = usePDMStore((s) => s.clearAnnotations)
  const commentsShown = usePDMStore(
    (s) => rightPaneContent(s) === 'comments' && s.reviewCommentsVisible,
  )
  const toggleReviewComments = usePDMStore((s) => s.toggleReviewComments)
  const commentKey = useShortcutLabel('reviews.markup')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<SideTab>('comments')
  const [markupMode, setMarkupMode] = useState(true)
  const [focusRequest, setFocusRequest] = useState<{ id: string; tick: number } | null>(null)
  const focusTick = useRef(0)
  /** A thread chosen in an earlier round's list: scroll to it once that round has loaded. */
  const focusAfterLoad = useRef<string | null>(activeAnnotationId)

  const currentRound = detail.review.currentRound
  const roundEntry = item.rounds.find((r) => r.roundNumber === round)
  /** The version the shown round reviewed: its PDF is the one the round's comments were made on. */
  const shownVersionId = roundEntry?.fileVersionId ?? item.version.fileVersionId
  const markupVersion = roundEntry?.version ?? item.version.version
  const editable = canMarkup && round === currentRound
  const closed =
    detail.review.status === 'approved' ||
    detail.review.status === 'rejected' ||
    detail.review.status === 'cancelled'

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    resolveReviewItemPreview(item, shownVersionId)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        log.warn('[Reviews]', 'Loading the review preview failed', {
          error: loadError,
          itemId: item.id,
        })
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
    // The shown version and its PDF decide the preview; `attempt` retries after generating.
  }, [item.id, shownVersionId, item.pdf?.storageHash, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Comments are shared store state: leave none behind for the next surface.
  useEffect(() => () => clearAnnotations(), [clearAnnotations])

  const focus = useCallback((id: string) => {
    focusTick.current += 1
    setFocusRequest({ id, tick: focusTick.current })
  }, [])

  useEffect(() => {
    const id = focusAfterLoad.current
    if (!id || annotationsLoading || !preview) return
    if (annotations.some((a) => a.id === id)) {
      focusAfterLoad.current = null
      focus(id)
    }
  }, [annotations, annotationsLoading, preview, focus])

  const numbers = useMemo(() => numberThreads(annotations), [annotations])
  const overlays = useMemo<AnnotationOverlay[]>(() => {
    const result: AnnotationOverlay[] = []
    for (const ann of annotations) {
      if (ann.position && ann.page_number != null) {
        result.push({
          id: ann.id,
          pageNumber: ann.page_number,
          position: ann.position,
          resolved: ann.resolved,
          label: numbers.get(ann.id),
        })
      }
    }
    return result
  }, [annotations, numbers])

  const handleCreate = useCallback(
    (data: NewAnnotationData) => {
      setPendingAnnotation(data)
      setShowCommentInput(true)
      setTab('comments')
      // The comment input lives in the sidebar, so a new comment brings it back.
      if (!usePDMStore.getState().reviewCommentsVisible) toggleReviewComments()
    },
    [setPendingAnnotation, setShowCommentInput, toggleReviewComments],
  )

  useShortcuts(
    'reviews',
    { 'reviews.markup': () => setMarkupMode((on) => !on) },
    { enabled: editable, blockedByModal: true },
  )

  const generate = async () => {
    setGenerating(true)
    try {
      await executeCommand('generate-review-pdfs', { fileVersionIds: [shownVersionId] })
      setAttempt((n) => n + 1)
    } finally {
      setGenerating(false)
    }
  }

  const userNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const [id, user] of usersById) map.set(id, user.fullName || user.email)
    return map
  }, [usersById])

  const openEarlier = useCallback(
    (earlierRound: number, annotationId: string) => {
      focusAfterLoad.current = annotationId
      setActiveAnnotationId(annotationId)
      onShowRound(earlierRound)
    },
    [onShowRound, setActiveAnnotationId],
  )

  const fileName = displayFileName(item.file.fileName)

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {round !== currentRound && (
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-ui-border bg-ui-field/50 px-3 py-2 text-[13px]">
            <span className="flex-1 text-ui-fg">
              {t('reviewDetail.roundView.banner', { round, version: markupVersion })}
            </span>
            <Button size="sm" onClick={() => onShowRound(null)}>
              {t('reviewDetail.roundView.back', { round: currentRound })}
            </Button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                align="center"
                title={t('reviewDetail.preview.failedTitle')}
                description={error}
                actions={
                  <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                    {t('reviewDetail.preview.retry')}
                  </Button>
                }
              />
            </div>
          ) : !preview ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-ui-fg-secondary">
              {t('reviewDetail.preview.loading')}
            </div>
          ) : preview.kind === 'pdf' ? (
            <PdfAnnotationViewer
              key={preview.localPath}
              filePath={preview.localPath}
              readData={readCachedPdf}
              fileName={fileName}
              fileVersion={markupVersion}
              initialScale="page-fit"
              toolbarPosition="top"
              annotations={overlays}
              pendingAnnotation={pendingAnnotation}
              hoveredAnnotationId={hoveredAnnotationId}
              activeAnnotationId={activeAnnotationId}
              areaSelectActive={editable ? markupMode : false}
              onAreaSelectChange={setMarkupMode}
              commentKey={commentKey}
              focusRequest={focusRequest}
              onAnnotationCreate={editable ? handleCreate : undefined}
              onAnnotationClick={setActiveAnnotationId}
              onAnnotationHover={setHoveredAnnotationId}
            />
          ) : preview.kind === 'pdf_pending' ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                align="center"
                title={t('reviewDetail.preview.pending')}
                description={
                  <span className="block max-w-sm">{t('reviewDetail.preview.pendingHint')}</span>
                }
                actions={
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<FilePlus2 size={14} />}
                    loading={generating}
                    onClick={() => void generate()}
                  >
                    {t('reviewDetail.preview.generate')}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                align="center"
                title={t('reviewDetail.preview.unsupported')}
                description={
                  <span className="block max-w-sm">
                    {t('reviewDetail.preview.unsupportedHint')}
                  </span>
                }
              />
            </div>
          )}
        </div>
        {footer}
      </div>

      {commentsShown && (
        <div className="flex w-[clamp(240px,32%,300px)] flex-shrink-0 flex-col border-l border-ui-border bg-ui-bg">
          <div className="flex h-10 flex-shrink-0 items-center border-b border-ui-border px-3">
            <SegmentedControl<SideTab>
              size="sm"
              aria-label={t('reviewDetail.activity.tabsLabel')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'comments', label: t('reviewDetail.activity.commentsTab') },
                { value: 'activity', label: t('reviewDetail.activity.tab') },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'comments' ? (
              <CommentSidebar
                fileId={item.fileId}
                fileName={fileName}
                fileVersion={markupVersion}
                review={{ reviewId, round, itemId: item.id }}
                readOnly={!editable}
                readOnlyReason={closed ? 'closed' : round !== currentRound ? 'round' : null}
                showTitle={false}
                markupMode={markupMode}
                onMarkupModeChange={preview?.kind === 'pdf' ? setMarkupMode : undefined}
                onFocusThread={focus}
                earlierRounds={earlierRounds(item, round)}
                onOpenEarlier={openEarlier}
                userNames={userNames}
                showAddButton={false}
              />
            ) : (
              <ActivityPanel
                detail={detail}
                item={item}
                usersById={usersById}
                shownRound={round}
                onShowRound={(r) => onShowRound(r === currentRound ? null : r)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
