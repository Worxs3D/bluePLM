/**
 * The open review in the Reviews view's main area: header (whose move, facts, reviewers, the one
 * primary action), the state banner, the workflow row, then the files column, the pinned version's
 * PDF with its numbered comments, and the decision bar.
 *
 * Built for a reviewer working a long queue: J/K move between files, A/C/R decide, a decision waits
 * five seconds with Undo before it is sent and the view moves to the next file still owed, and
 * once nothing is owed "Next review" (N) opens the next one. For the author after a kickback it
 * leads with what to fix and Resubmit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'

import {
  Button,
  EmptyState,
  IconButton,
  OverflowMenu,
  Select,
  type OverflowMenuItem,
} from '@/components/core/ui'
import { addFileIdsToReviewPackage } from '@/features/source/reviewPackage'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { useShortcuts } from '@/lib/keybindings'
import { chooseReviewPackageDestination } from '@/lib/reviewPackage'
import { forgetViewedItems, markItemViewed } from '@/lib/reviewViewedItems'
import { respondToItems } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewDecision, ReviewDetail } from '@/types/reviews'

import { useReviewDetail } from '../hooks/useReviewDetail'
import { useReviewExtras } from '../hooks/useReviewExtras'
import { useReviewItemKeys } from '../hooks/useReviewItemKeys'
import { usePendingDecisions } from '../hooks/usePendingDecisions'
import { useReviewSummary } from '../hooks/useReviewSummary'
import { nextOwedItem, stepItem } from '../lib/decisionKeys'
import { decisionBarState, reviewUsersById } from '../lib/decisionState'
import {
  decisionsToSend,
  effectiveOwed,
  restoreFromUndo,
  type DecisionRestore,
  type PendingDecision,
} from '../lib/pendingDecisions'
import { describeReviewError } from '../lib/reviewErrors'
import { commentCountFor, groupItems, orderedItemIds, whatToFix } from '../lib/reviewProgress'
import { describeNextMove, isReviewOpen, nextMoveForDetail, nextRowAfter } from '../lib/reviewState'
import { DecisionBar } from './DecisionBar'
import { ItemPreview } from './ItemPreview'
import { CancelReviewDialog, MetaDialog } from './ReviewDialogs'
import { ResubmitDialog } from './ResubmitDialog'
import { ReviewHeader } from './ReviewHeader'
import { ReviewItemList } from './ReviewItemList'
import { ReviewWorkflowBar, useReviewWorkflow } from './ReviewWorkflowBar'
import { StateBanner } from './StateBanner'

/** Below this width of the area under the header, the files column folds into a picker. */
const NARROW_BODY_PX = 900

export function ReviewDetailPane() {
  const reviewId = usePDMStore((s) => s.activeReviewId)
  const setActiveReviewId = usePDMStore((s) => s.setActiveReviewId)
  const { detail, loading, error, errorCode, reload } = useReviewDetail(reviewId)

  if (!reviewId) return null
  const back = () => setActiveReviewId(null)

  if (!detail) {
    if (error) {
      const gone = errorCode === 'REVIEW_NOT_FOUND'
      return (
        <div className="flex h-full w-full flex-col bg-ui-bg font-ui">
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-ui-border px-4 py-3">
            <IconButton
              label={t('reviewDetail.back')}
              icon={<ArrowLeft size={16} />}
              onClick={back}
            />
          </div>
          <div className="p-8">
            <EmptyState
              title={
                gone ? t('reviewDetail.loadError.notFound') : t('reviewDetail.loadError.title')
              }
              description={gone ? undefined : error}
              actions={
                <>
                  {!gone && (
                    <Button variant="primary" loading={loading} onClick={() => void reload()}>
                      {t('reviewDetail.loadError.retry')}
                    </Button>
                  )}
                  <Button onClick={back}>{t('reviewDetail.loadError.back')}</Button>
                </>
              }
            />
          </div>
        </div>
      )
    }
    // Keep the layout while loading: header row, no centred spinner.
    return (
      <div className="flex h-full w-full flex-col bg-ui-bg font-ui">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-ui-border px-4 py-3">
          <IconButton
            label={t('reviewDetail.back')}
            icon={<ArrowLeft size={16} />}
            onClick={back}
          />
          <span className="text-[14px] text-ui-fg-secondary">{t('reviewQueue.loading')}</span>
        </div>
      </div>
    )
  }

  return <ReviewDetailBody key={detail.review.id} detail={detail} reload={reload} />
}

const isDrawing = (extension: string | null | undefined) =>
  (extension ?? '').toLowerCase() === '.slddrw'

function ReviewDetailBody({
  detail,
  reload,
}: {
  detail: ReviewDetail
  reload: () => Promise<ReviewDetail | null>
}) {
  const reviewId = detail.review.id
  const activeItemId = usePDMStore((s) => s.activeReviewItemId)
  const setActiveReviewId = usePDMStore((s) => s.setActiveReviewId)
  const setActiveItemId = usePDMStore((s) => s.setActiveReviewItemId)
  const openReview = usePDMStore((s) => s.openReview)
  const setActiveGateReviewId = usePDMStore((s) => s.setActiveGateReviewId)
  const refreshQueue = usePDMStore((s) => s.requestReviewQueueRefresh)
  const addToast = usePDMStore((s) => s.addToast)

  const [resubmitOpen, setResubmitOpen] = useState(false)
  const [cancelMode, setCancelMode] = useState<'cancel' | 'again' | null>(null)
  const [metaDialog, setMetaDialog] = useState<'priority' | 'due' | null>(null)
  const [markupRound, setMarkupRound] = useState<number | null>(null)
  const [restore, setRestore] = useState<DecisionRestore | null>(null)
  const [decidedHere, setDecidedHere] = useState(false)
  // A narrow window gives the drawing the room: the files column becomes a picker above it.
  const bodyRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_BODY_PX))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onChanged = useCallback(() => {
    refreshQueue()
    void reload()
  }, [refreshQueue, reload])

  const extras = useReviewExtras(detail)
  const workflow = useReviewWorkflow(detail, onChanged)
  const summary = useReviewSummary(true)
  const usersById = useMemo(() => reviewUsersById(detail), [detail])

  const serverOwed = useMemo(() => new Set(detail.me.owedItemIds), [detail.me.owedItemIds])
  const pending = usePendingDecisions({
    owedOnServer: serverOwed,
    // Exactly the files the decision was made on (Approve remaining included).
    send: async (entry) => {
      await respondToItems(entry.reviewId, decisionsToSend(entry))
    },
    onSent: (entry) => {
      forgetViewedItems(entry.reviewId, entry.itemIds)
      refreshQueue()
    },
    onUndone: (entry) => {
      setActiveItemId(entry.itemIds[0])
      setRestore(restoreFromUndo(entry, Date.now()))
    },
    onFailed: (_entry: PendingDecision, sendError) => {
      addToast('error', describeReviewError(sendError))
      refreshQueue()
    },
  })

  const items = detail.items
  const groups = useMemo(() => groupItems(items, serverOwed), [items, serverOwed])
  const order = useMemo(() => orderedItemIds(groups), [groups])
  const owedNow = useMemo(
    () =>
      effectiveOwed(
        order.filter((id) => serverOwed.has(id)),
        pending.queue,
        pending.sending,
      ),
    [order, serverOwed, pending.queue, pending.sending],
  )
  const myDecisions = useMemo(() => {
    const map = new Map<string, ReviewDecision>()
    for (const i of items) {
      const round = i.rounds.find((r) => r.roundNumber === detail.review.currentRound)
      const mine = round?.decisions.find((d) => d.reviewerId === detail.me.userId)
      if (mine) map.set(i.id, mine.decision)
    }
    return map
  }, [items, detail.review.currentRound, detail.me.userId])
  const pendingByItem = useMemo(() => {
    const map = new Map<string, ReviewDecision>()
    for (const e of pending.queue) for (const id of e.itemIds) map.set(id, e.decision)
    return map
  }, [pending.queue])

  // Pick a file when none is chosen (or the chosen one is not in this review): the first owed one,
  // else the first drawing (it has a PDF to look at), else the first file.
  const firstDrawing = useMemo(
    () => order.find((id) => isDrawing(items.find((i) => i.id === id)?.file.extension)) ?? null,
    [order, items],
  )
  useEffect(() => {
    if (items.length === 0) return
    if (activeItemId && order.includes(activeItemId)) return
    setActiveItemId(owedNow[0] ?? firstDrawing ?? order[0])
  }, [items.length, order, owedNow, firstDrawing, activeItemId, setActiveItemId])

  // A new file shows the current round's comments, and counts as opened for bulk approve. An undone
  // decision belongs to its own file: moving to another drops it.
  useEffect(() => {
    setMarkupRound(null)
    setRestore((r) => (r && r.itemId !== activeItemId ? null : r))
    // Only a file the viewer still owes counts as opened for bulk approve.
    if (activeItemId && serverOwed.has(activeItemId)) markItemViewed(reviewId, activeItemId)
  }, [activeItemId, reviewId]) // eslint-disable-line react-hooks/exhaustive-deps

  const item = items.find((i) => i.id === activeItemId) ?? null
  const currentRound = detail.review.currentRound
  const shownRound = markupRound ?? currentRound
  const reviewOpen = isReviewOpen(detail.review.status)
  const canMarkup =
    reviewOpen &&
    shownRound === currentRound &&
    (detail.me.isRequester || detail.me.isReviewer || detail.me.isAdmin)

  const move = nextMoveForDetail(detail, workflow.summary)
  const fix = useMemo(() => whatToFix(detail, extras.counts), [detail, extras.counts])
  const released = items.filter((i) => extras.releases.has(i.version.fileVersionId)).length

  const goNext = useCallback(
    () => setActiveItemId(stepItem(order, activeItemId, 1)),
    [order, activeItemId, setActiveItemId],
  )
  const goPrevious = useCallback(
    () => setActiveItemId(stepItem(order, activeItemId, -1)),
    [order, activeItemId, setActiveItemId],
  )
  useReviewItemKeys(true, goNext, goPrevious)

  // The next review waiting on the viewer, for "Next review".
  const waitingOthers = summary.awaiting.filter((r) => !(r.kind === 'package' && r.id === reviewId))
  const nextRow = nextRowAfter(waitingOthers, null)
  const openNext = useCallback(() => {
    pending.flush()
    if (!nextRow) return
    if (nextRow.kind === 'gate') setActiveGateReviewId(nextRow.id)
    else openReview(nextRow.id)
  }, [pending, nextRow, openReview, setActiveGateReviewId])
  useShortcuts(
    'reviews',
    { 'reviews.nextReview': openNext },
    { enabled: !!nextRow, blockedByModal: true },
  )

  const decide = useCallback(
    (decision: ReviewDecision, comment: string | null) => {
      if (!item) return
      setDecidedHere(true)
      setRestore(null)
      pending.queueDecision(
        { reviewId, scope: 'item', itemIds: [item.id], decision, comment },
        t('reviewDetail.undo.decided', {
          decision: t(`reviewDetail.sent.${decision}`),
          file: displayFileName(item.file.fileName),
        }),
      )
      const next = nextOwedItem(order, owedNow, item.id)
      if (next) setActiveItemId(next)
    },
    [item, pending, reviewId, order, owedNow, setActiveItemId],
  )

  const approveAll = useCallback(
    (comment: string | null) => {
      if (owedNow.length === 0) return
      setDecidedHere(true)
      setRestore(null)
      pending.queueDecision(
        { reviewId, scope: 'all', itemIds: owedNow, decision: 'approved', comment },
        t('reviewDetail.undo.all', { count: owedNow.length }),
      )
    },
    [owedNow, pending, reviewId],
  )

  const download = async () => {
    const destination = await chooseReviewPackageDestination()
    if (destination) await executeCommand('download-review-package', { reviewId, destination })
  }

  const requestAgain = async () => {
    await addFileIdsToReviewPackage(items.filter((i) => !i.file.deleted).map((i) => i.fileId))
  }

  const isCancelled = detail.review.status === 'cancelled'
  const overflow: OverflowMenuItem[] = [
    {
      id: 'download',
      label: t('reviewDetail.download.button'),
      title: t('reviewDetail.download.hint'),
      onSelect: () => void download(),
    },
    ...(detail.me.canEditMeta && reviewOpen
      ? [
          {
            id: 'priority',
            label: t('reviewDetail.editMeta.priorityButton'),
            onSelect: () => setMetaDialog('priority'),
          },
          {
            id: 'due',
            label: t('reviewDetail.editMeta.dueButton'),
            onSelect: () => setMetaDialog('due'),
          },
        ]
      : []),
    ...(!reviewOpen && detail.me.isRequester
      ? [
          {
            id: 'again',
            label: t('reviewDetail.again.button'),
            onSelect: () => void requestAgain(),
          },
        ]
      : []),
    ...(detail.me.canCancel && reviewOpen
      ? [
          {
            id: 'cancel',
            label: t('reviewDetail.cancel.button'),
            danger: true,
            onSelect: () => setCancelMode('cancel'),
          },
        ]
      : []),
  ]

  const moveAction =
    move.kind === 'ready_to_move' && workflow.canMove ? () => void workflow.move(false) : null
  // The state banner carries the primary action of the author's moves (Resubmit, Cancel and
  // request again, Move); the header keeps one only where no banner offers it.
  const primary =
    isCancelled && detail.me.isRequester ? (
      <Button onClick={() => void requestAgain()}>{t('reviewDetail.again.button')}</Button>
    ) : null

  const queuedDecision = item ? pendingByItem.get(item.id) : undefined
  const barState = item
    ? decisionBarState(detail, item, queuedDecision ? { decision: queuedDecision } : null)
    : null
  const showBar = !!item && (detail.me.isReviewer || detail.me.canRespond) && reviewOpen
  // Done: the viewer decided everything they owed here, in this session or before it.
  const myAssignment = detail.reviewers.find(
    (r) => r.roundNumber === currentRound && r.user?.id === detail.me.userId,
  )
  const finishedMyPart =
    decidedHere ||
    (!!myAssignment && myAssignment.status !== 'pending' && myAssignment.status !== 'cancelled')
  const done =
    finishedMyPart && owedNow.length === 0 && reviewOpen
      ? {
          waiting: waitingOthers.length,
          onNext: nextRow ? openNext : null,
          onBack: () => setActiveReviewId(null),
        }
      : null
  const owedMove =
    owedNow.length > 0
      ? describeNextMove({ kind: 'you_decide', owed: owedNow.length, total: items.length })
      : null

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ui-bg font-ui">
      <ReviewHeader
        detail={detail}
        move={move}
        onBack={() => setActiveReviewId(null)}
        actions={
          <>
            {primary}
            <OverflowMenu label={t('reviewDetail.moreActions')} items={overflow} />
          </>
        }
      />
      <StateBanner
        detail={detail}
        move={move}
        fix={fix}
        released={released}
        onResubmit={() => setResubmitOpen(true)}
        onCancelAgain={() => setCancelMode('again')}
        onMove={moveAction}
        moving={workflow.busy}
      />
      <ReviewWorkflowBar workflow={workflow} />

      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {!narrow && (
          <div className="w-[272px] flex-shrink-0 overflow-y-auto border-r border-ui-border bg-ui-nav">
            <ReviewItemList
              groups={groups}
              activeItemId={activeItemId}
              counts={extras.counts}
              releases={extras.releases}
              pendingByItem={pendingByItem}
              authorView={detail.me.isRequester}
              myDecisions={myDecisions}
              onSelect={setActiveItemId}
            />
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {narrow && activeItemId && (
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-ui-border px-3 py-2">
              <Select
                value={activeItemId}
                aria-label={t('reviewDetail.items.label')}
                onChange={(e) => setActiveItemId(e.target.value)}
                className="min-w-0 flex-1"
              >
                {groups.map((group) => (
                  <optgroup
                    key={group.kind}
                    label={t(`reviewDetail.group.${group.kind}`, { count: group.items.length })}
                  >
                    {group.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {displayFileName(i.file.fileName)} ·{' '}
                        {t('reviewDetail.items.version', { version: i.version.version })} ·{' '}
                        {t(`reviewDetail.itemOutcome.${i.outcome}`)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
          )}
          {item ? (
            <ItemPreview
              key={`${item.id}:${shownRound}`}
              detail={detail}
              item={item}
              round={shownRound}
              canMarkup={canMarkup}
              usersById={usersById}
              onShowRound={setMarkupRound}
              footer={
                showBar && barState ? (
                  <DecisionBar
                    key={item.id}
                    itemId={item.id}
                    state={barState}
                    context={t('reviewDetail.bar.context', {
                      file: displayFileName(item.file.fileName),
                      version: item.version.version,
                    })}
                    moveText={owedMove}
                    owedCount={owedNow.length}
                    myOpenComments={commentCountFor(extras.counts, item.id).mineOpen}
                    done={done}
                    restore={restore}
                    onDecide={decide}
                    onApproveAll={approveAll}
                  />
                ) : null
              }
            />
          ) : (
            <div className="p-8">
              <EmptyState title={t('reviewDetail.noItems')} />
            </div>
          )}
        </div>
      </div>

      <ResubmitDialog
        open={resubmitOpen}
        reviewId={reviewId}
        title={detail.review.title}
        items={items}
        counts={extras.counts}
        onClose={() => setResubmitOpen(false)}
        onDone={() => {
          setResubmitOpen(false)
          onChanged()
        }}
      />
      <CancelReviewDialog
        open={cancelMode !== null}
        reviewId={reviewId}
        again={cancelMode === 'again'}
        onClose={() => setCancelMode(null)}
        onDone={() => {
          const again = cancelMode === 'again'
          setCancelMode(null)
          onChanged()
          if (again) void requestAgain()
        }}
      />
      <MetaDialog
        open={metaDialog !== null}
        kind={metaDialog ?? 'priority'}
        reviewId={reviewId}
        priority={detail.review.priority}
        dueDate={detail.review.dueDate}
        onClose={() => setMetaDialog(null)}
        onDone={() => {
          setMetaDialog(null)
          onChanged()
        }}
      />
    </div>
  )
}
