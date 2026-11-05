/**
 * CommentSidebar - the comments on a drawing, beside the PDF (file preview and review detail).
 *
 * - Loads the comments of the file, version and review scope, and keeps them live through Realtime.
 * - Numbers every thread (the pin drawn on the PDF), filters Open / Resolved / All, and asks the
 *   viewer to scroll to a thread when one is selected.
 * - "Comment" turns comment mode on (drag a box on the drawing); a box opens the input here.
 * - Resolve / Reopen go through `file_comment_set_resolved` (schema 512), so the author of a
 *   drawing can resolve a reviewer's comment; it is offered to exactly whoever the database allows
 *   (`file_comment_list_resolvable`, schema 514: explorer edit counts on the comment's own vault).
 * - In a review's round 2 and later, earlier rounds' comments are listed under the current ones.
 *
 * CRUD is optimistic with a rollback on error.
 */

import { useEffect, useCallback, useRef, useMemo, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'

import { Button, SegmentedControl } from '@/components/core/ui'
import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import type { FileAnnotation } from '@/types/database'
import {
  type AnnotationReviewScope,
  getFileAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from '@/lib/supabase/annotations'
import { setCommentResolved } from '@/lib/supabase/commentResolve'
import { getSupabaseClient } from '@/lib/supabase/client'

import { CommentThread } from './CommentThread'
import { CommentInput } from './CommentInput'
import { EarlierRoundComments } from './EarlierRoundComments'
import { useResolvableComments } from './useResolvableComments'
import {
  canResolveThread,
  filterThreads,
  numberThreads,
  threadCounts,
  type CommentFilter,
  type EarlierRound,
  type ResolveContext,
} from './commentThreads'

export interface CommentSidebarProps {
  /** Supabase file ID (from pdmData) for the currently viewed file */
  fileId: string
  /** Display name of the file */
  fileName: string
  /** Current file version (for version-scoped comments) */
  fileVersion?: number
  /** A review's comments: only this review round's comments on this item, and new ones linked to it */
  review?: AnnotationReviewScope
  /** List the comments only (an earlier review round, or a closed review) */
  readOnly?: boolean
  /** Why it is read-only, for the line at the top. */
  readOnlyReason?: 'closed' | 'round' | null
  /** Show the "Comments" title bar (the file preview); the review detail has its own tabs. */
  showTitle?: boolean
  /** Comment mode (the viewer's area select), shared with the viewer's toolbar. */
  markupMode?: boolean
  onMarkupModeChange?: (on: boolean) => void
  /** Ask the viewer to scroll to a thread's box. */
  onFocusThread?: (annotationId: string) => void
  /** Earlier review rounds to list under the current one, newest first. */
  earlierRounds?: EarlierRound[]
  /** Show an earlier round's thread on its version. */
  onOpenEarlier?: (round: number, annotationId: string) => void
  /** Names by user id, for "Resolved by". */
  userNames?: ReadonlyMap<string, string>
  /** Offer the "Comment" button here (default true); off where the viewer's toolbar has it. */
  showAddButton?: boolean
}

/** Which annotation set is loaded: file + version + review scope. */
export function annotationScopeKey(
  fileId: string,
  fileVersion: number | undefined,
  review: AnnotationReviewScope | undefined,
): string {
  const scope = review ? `${review.reviewId}:${review.round}:${review.itemId}` : ''
  return `${fileId}|${fileVersion ?? ''}|${scope}`
}

const NO_EARLIER: EarlierRound[] = []

export function CommentSidebar({
  fileId,
  fileName: _fileName,
  fileVersion,
  review,
  readOnly = false,
  readOnlyReason = null,
  showTitle = true,
  markupMode,
  onMarkupModeChange,
  onFocusThread,
  earlierRounds = NO_EARLIER,
  onOpenEarlier,
  userNames,
  showAddButton = true,
}: CommentSidebarProps) {
  // Primitive parts of the review scope, so effects key on values rather than object identity.
  const reviewId = review?.reviewId
  const reviewRound = review?.round
  const reviewItemId = review?.itemId
  const scope = useMemo<AnnotationReviewScope | undefined>(
    () =>
      reviewId && reviewRound !== undefined && reviewItemId
        ? { reviewId, round: reviewRound, itemId: reviewItemId }
        : undefined,
    [reviewId, reviewRound, reviewItemId],
  )
  const scopeKey = annotationScopeKey(fileId, fileVersion, scope)

  // ── Store ────────────────────────────────────────────────────────────────
  const annotations = usePDMStore((s) => s.annotations)
  const annotationsLoading = usePDMStore((s) => s.annotationsLoading)
  const activeAnnotationId = usePDMStore((s) => s.activeAnnotationId)
  const loadedScopeKey = usePDMStore((s) => s.annotationScopeKey)
  const showCommentInput = usePDMStore((s) => s.showCommentInput)
  const pendingAnnotation = usePDMStore((s) => s.pendingAnnotation)
  const user = usePDMStore((s) => s.user)
  const addToast = usePDMStore((s) => s.addToast)

  const setAnnotations = usePDMStore((s) => s.setAnnotations)
  const addAnnotation = usePDMStore((s) => s.addAnnotation)
  const updateAnnotationInStore = usePDMStore((s) => s.updateAnnotationInStore)
  const removeAnnotation = usePDMStore((s) => s.removeAnnotation)
  const setActiveAnnotationId = usePDMStore((s) => s.setActiveAnnotationId)
  const hoveredAnnotationId = usePDMStore((s) => s.hoveredAnnotationId)
  const setHoveredAnnotationId = usePDMStore((s) => s.setHoveredAnnotationId)
  const setAnnotationScopeKey = usePDMStore((s) => s.setAnnotationScopeKey)
  const setAnnotationsLoading = usePDMStore((s) => s.setAnnotationsLoading)
  const setShowCommentInput = usePDMStore((s) => s.setShowCommentInput)
  const setPendingAnnotation = usePDMStore((s) => s.setPendingAnnotation)

  // ── Local state ──────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<CommentFilter>('open')
  const [isCreating, setIsCreating] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const threadListRef = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => threadCounts(annotations), [annotations])
  const numbers = useMemo(() => numberThreads(annotations), [annotations])
  const shown = useMemo(() => filterThreads(annotations, filter), [annotations, filter])

  // Resolve / Reopen shows exactly when file_comment_set_resolved would allow it (schema 514).
  const resolvable = useResolvableComments(annotations, user?.id ?? null)
  const fullResolveContext = useMemo<ResolveContext>(
    () => ({ userId: user?.id ?? null, resolvable }),
    [user?.id, resolvable],
  )

  const reload = useCallback(async () => {
    const result = await getFileAnnotations(fileId, fileVersion, scope)
    if (!result.error) setAnnotations(result.annotations)
    return result
  }, [fileId, fileVersion, scope, setAnnotations])

  // ── Load annotations when the file, version or review scope changes ─────
  // Keyed on all three: keying on the file alone kept v5's comments on screen when the same
  // drawing's v6 review opened next (audit H6).
  useEffect(() => {
    if (!fileId) return
    if (loadedScopeKey === scopeKey && attempt === 0) return

    let cancelled = false
    const load = async () => {
      setAnnotations([])
      setLoadError(null)
      setAnnotationsLoading(true)
      const result = await getFileAnnotations(fileId, fileVersion, scope)
      if (cancelled) return
      if (result.error) {
        log.error('[CommentSidebar]', 'Failed to load annotations', { error: result.error, fileId })
        setLoadError(result.error)
      }
      setAnnotations(result.annotations)
      setAnnotationScopeKey(scopeKey)
      setAnnotationsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
    // `loadedScopeKey` is read to skip a reload of what is already shown, not as a trigger.
  }, [fileId, fileVersion, scope, scopeKey, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Supabase Realtime subscription ──────────────────────────────────────
  useEffect(() => {
    if (!fileId) return
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null
    try {
      const client = getSupabaseClient()
      channel = client
        .channel(`file_comments:${scopeKey}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'file_comment', filter: `file_id=eq.${fileId}` },
          (payload) => {
            const eventType = payload.eventType
            if (eventType === 'INSERT') {
              // Own inserts are already on screen (optimistic).
              const newRow = payload.new as Record<string, unknown>
              if (newRow.user_id === user?.id) return
              void reload()
            } else if (eventType === 'UPDATE') {
              void reload()
            } else if (eventType === 'DELETE') {
              const deletedId = (payload.old as Record<string, unknown>).id
              if (typeof deletedId === 'string') removeAnnotation(deletedId)
            }
          },
        )
        .subscribe()
    } catch (error) {
      log.warn('[CommentSidebar]', 'Failed to set up realtime subscription', { error })
    }
    return () => {
      if (!channel) return
      try {
        getSupabaseClient().removeChannel(channel)
      } catch {
        // Ignore cleanup errors
      }
    }
  }, [fileId, scopeKey, user?.id, reload, removeAnnotation])

  // ── Scroll the list to the thread selected on the drawing ────────────────
  useEffect(() => {
    if (!activeAnnotationId || !threadListRef.current) return
    const el = threadListRef.current.querySelector(`[data-annotation-id="${activeAnnotationId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // A thread selected on the drawing that the filter hides: show it.
    const ann = annotations.find((a) => a.id === activeAnnotationId)
    if (ann && !ann.parent_id) {
      if (filter === 'open' && ann.resolved) setFilter('all')
      if (filter === 'resolved' && !ann.resolved) setFilter('all')
    }
  }, [activeAnnotationId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── CRUD handlers ───────────────────────────────────────────────────────

  const handleCreateComment = useCallback(
    async (text: string) => {
      if (!user?.id || !pendingAnnotation) return
      setIsCreating(true)
      const tempId = `temp-${Date.now()}`
      const position = { ...pendingAnnotation.position }
      const optimistic: FileAnnotation = {
        id: tempId,
        file_id: fileId,
        user_id: user.id,
        comment: text,
        page_number: pendingAnnotation.pageNumber,
        position,
        annotation_type: pendingAnnotation.annotationType,
        parent_id: null,
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        file_version: fileVersion ?? null,
        edited_at: null,
        created_at: new Date().toISOString(),
        user: {
          email: user.email,
          full_name: user.full_name ?? null,
          avatar_url: user.avatar_url ?? null,
        },
        replies: [],
      }
      addAnnotation(optimistic)
      setShowCommentInput(false)
      setPendingAnnotation(null)
      if (filter === 'resolved') setFilter('open')

      try {
        const result = await createAnnotation({
          fileId,
          userId: user.id,
          comment: text,
          pageNumber: pendingAnnotation.pageNumber,
          position,
          annotationType: pendingAnnotation.annotationType,
          fileVersion: fileVersion ?? null,
          review: scope ?? null,
        })
        removeAnnotation(tempId)
        if (result.error || !result.annotation) {
          addToast('error', t('markups.saveFailed', { message: result.error ?? '' }))
          return
        }
        addAnnotation(result.annotation)
        setActiveAnnotationId(result.annotation.id)
      } catch (error) {
        removeAnnotation(tempId)
        addToast('error', t('markups.saveFailed', { message: '' }))
        log.error('[CommentSidebar]', 'Create annotation failed', { error })
      } finally {
        setIsCreating(false)
      }
    },
    [
      user,
      pendingAnnotation,
      fileId,
      fileVersion,
      scope,
      filter,
      addAnnotation,
      removeAnnotation,
      setShowCommentInput,
      setPendingAnnotation,
      setActiveAnnotationId,
      addToast,
    ],
  )

  const handleReply = useCallback(
    async (parentId: string, text: string) => {
      if (!user?.id) return
      const result = await createAnnotation({
        fileId,
        userId: user.id,
        comment: text,
        annotationType: 'text',
        parentId,
        fileVersion: fileVersion ?? null,
        review: scope ?? null,
      })
      if (result.error || !result.annotation) {
        addToast('error', t('markups.replyFailed', { message: result.error ?? '' }))
        // Throw so the reply input stays open and the typed text is preserved
        throw new Error(result.error ?? 'Failed to save reply')
      }
      await reload()
    },
    [user, fileId, fileVersion, scope, addToast, reload],
  )

  const handleEdit = useCallback(
    async (annotationId: string, newText: string) => {
      updateAnnotationInStore(annotationId, {
        comment: newText,
        edited_at: new Date().toISOString(),
      })
      const result = await updateAnnotation(annotationId, newText)
      if (result.error) {
        addToast('error', t('markups.editFailed', { message: result.error }))
        await reload()
      }
    },
    [updateAnnotationInStore, addToast, reload],
  )

  const handleDelete = useCallback(
    async (annotationId: string) => {
      removeAnnotation(annotationId)
      const result = await deleteAnnotation(annotationId)
      if (result.error) {
        addToast('error', t('markups.deleteFailed', { message: result.error }))
        await reload()
      }
    },
    [removeAnnotation, addToast, reload],
  )

  const setResolved = useCallback(
    async (annotationId: string, resolved: boolean) => {
      updateAnnotationInStore(annotationId, {
        resolved,
        resolved_by: resolved ? (user?.id ?? null) : null,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      const { result, error } = await setCommentResolved(annotationId, resolved)
      if (error || !result) {
        addToast(
          'error',
          t(resolved ? 'markups.resolveFailed' : 'markups.unresolveFailed', {
            message: error ?? '',
          }),
        )
        await reload()
        return
      }
      updateAnnotationInStore(annotationId, {
        resolved: result.isResolved,
        resolved_by: result.resolvedBy,
        resolved_at: result.resolvedAt,
      })
    },
    [user?.id, updateAnnotationInStore, addToast, reload],
  )
  const handleResolve = useCallback((id: string) => setResolved(id, true), [setResolved])
  const handleUnresolve = useCallback((id: string) => setResolved(id, false), [setResolved])

  const handleCancelCreate = useCallback(() => {
    setShowCommentInput(false)
    setPendingAnnotation(null)
  }, [setShowCommentInput, setPendingAnnotation])

  const selectThread = useCallback(
    (id: string) => {
      setActiveAnnotationId(id)
      onFocusThread?.(id)
    },
    [setActiveAnnotationId, onFocusThread],
  )

  // A comment notification's Open (schema 514): focus its thread once this item's comments of the
  // review have loaded. Taken from the store once; the surfaces clear activeAnnotationId as they
  // unmount, so the target cannot ride on it.
  const pendingFocus = usePDMStore((s) => s.pendingReviewCommentFocus)
  useEffect(() => {
    if (!scope || !pendingFocus || annotationsLoading || loadedScopeKey !== scopeKey) return
    // Not here yet (the realtime reload of a comment that just arrived): wait for it.
    if (!annotations.some((a) => a.id === pendingFocus.commentId)) return
    const id = usePDMStore.getState().takePendingReviewCommentFocus(scope.reviewId, scope.itemId)
    if (id) selectThread(id)
  }, [scope, pendingFocus, annotationsLoading, loadedScopeKey, scopeKey, annotations, selectThread])

  const nameOf = useCallback(
    (userId: string | null): string | null => {
      if (!userId) return null
      const fromMap = userNames?.get(userId)
      if (fromMap) return fromMap
      for (const a of annotations) {
        if (a.user_id === userId && a.user) return a.user.full_name || a.user.email
        for (const r of a.replies ?? [])
          if (r.user_id === userId && r.user) return r.user.full_name || r.user.email
      }
      return null
    },
    [userNames, annotations],
  )

  // ── Render ──────────────────────────────────────────────────────────────
  const editable = !readOnly
  const total = counts.open + counts.resolved
  const modeOn = !!markupMode

  const addButton = showAddButton && editable && onMarkupModeChange && (
    <Button
      size="sm"
      variant={modeOn ? 'secondary' : 'ghost'}
      aria-pressed={modeOn}
      icon={<MessageSquarePlus size={14} className={modeOn ? 'text-ui-accent' : ''} />}
      onClick={() => onMarkupModeChange(!modeOn)}
      className={modeOn ? 'bg-ui-selected' : ''}
    >
      {t('markups.add')}
    </Button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-ui-bg">
      {showTitle && (
        <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-ui-border pl-3 pr-2">
          <h2 className="text-[14px] font-semibold text-ui-fg">{t('markups.title')}</h2>
          {total > 0 && <span className="text-[13px] text-ui-fg-secondary">{total}</span>}
          <div className="ml-auto">{addButton}</div>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-shrink-0 items-center gap-2 px-3 py-2">
          <SegmentedControl<CommentFilter>
            size="sm"
            aria-label={t('markups.filterLabel')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: t('markups.filter.open', { count: counts.open }) },
              {
                value: 'resolved',
                label: t('markups.filter.resolved', { count: counts.resolved }),
              },
              { value: 'all', label: t('markups.filter.all') },
            ]}
          />
          {!showTitle && addButton && <div className="ml-auto">{addButton}</div>}
        </div>
      )}

      {readOnly && (
        <p className="flex-shrink-0 px-3 pb-2 text-[12px] text-ui-fg-secondary">
          {readOnlyReason === 'closed'
            ? t('markups.readOnlyClosed')
            : readOnlyReason === 'round'
              ? t('markups.readOnlyRound')
              : t('markups.readOnly')}
        </p>
      )}
      {/* With no comments yet, the empty state below carries this hint. */}
      {editable && onMarkupModeChange && !showCommentInput && total > 0 && (
        <p className="flex-shrink-0 px-3 pb-2 text-[12px] text-ui-fg-tertiary">
          {modeOn ? t('markups.hintOn') : t('markups.hintOff')}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" ref={threadListRef}>
        {showCommentInput && pendingAnnotation && editable && (
          <div className="border-y border-ui-divider bg-ui-field/40 px-3 py-2.5">
            <CommentInput
              pageNumber={pendingAnnotation.pageNumber}
              placeholder={t('markups.placeholder')}
              onSubmit={handleCreateComment}
              onCancel={handleCancelCreate}
              isLoading={isCreating}
            />
          </div>
        )}

        {annotationsLoading ? (
          <p className="px-3 py-3 text-[13px] text-ui-fg-secondary">{t('markups.loading')}</p>
        ) : loadError ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[13px]">
            <span className="flex-1 text-ui-fg">{t('markups.loadError')}</span>
            <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              {t('markups.retry')}
            </Button>
          </div>
        ) : total === 0 ? (
          !showCommentInput && (
            <div className="px-3 py-3">
              <p className="text-[13px] text-ui-fg">{t('markups.empty')}</p>
              {/* Only a drawing can take a markup: a part or assembly has no PDF to drag on. */}
              {editable && onMarkupModeChange && (
                <p className="mt-0.5 text-[13px] text-ui-fg-secondary">
                  {modeOn ? t('markups.hintOn') : t('markups.hintOff')}
                </p>
              )}
            </div>
          )
        ) : shown.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-ui-fg-secondary">
            {t(`markups.emptyFilter.${filter}`)}
          </p>
        ) : (
          <div className="divide-y divide-ui-divider border-y border-ui-divider">
            {shown.map((ann) => (
              <div key={ann.id} data-annotation-id={ann.id}>
                <CommentThread
                  annotation={ann}
                  number={numbers.get(ann.id)}
                  currentUserId={user?.id ?? null}
                  isActive={activeAnnotationId === ann.id}
                  isHovered={hoveredAnnotationId === ann.id}
                  onClick={() => selectThread(ann.id)}
                  onReply={handleReply}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onResolve={handleResolve}
                  onUnresolve={handleUnresolve}
                  onHoverChange={(hovered) => setHoveredAnnotationId(hovered ? ann.id : null)}
                  readOnly={readOnly}
                  canResolve={canResolveThread(ann, fullResolveContext)}
                  resolvedByName={nameOf(ann.resolved_by)}
                />
              </div>
            ))}
          </div>
        )}

        {scope &&
          onOpenEarlier &&
          earlierRounds.map((round, index) => (
            <EarlierRoundComments
              key={`${scope.itemId}:${round.round}`}
              fileId={fileId}
              reviewId={scope.reviewId}
              itemId={scope.itemId}
              round={round}
              resolveContext={fullResolveContext}
              userNames={userNames}
              onOpen={onOpenEarlier}
              defaultExpanded={index === 0}
            />
          ))}
      </div>
    </div>
  )
}
