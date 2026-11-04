/**
 * CommentThread - one comment on the drawing with its replies.
 *
 * The root shows its pin number (the same number drawn on the PDF), who wrote it, when, and the
 * page; then the text and a line of actions: Reply, Resolve or Reopen (for whoever may), and Edit /
 * Delete on the viewer's own comments. Replies sit under it, indented. Clicking the thread asks
 * the viewer to scroll to its box.
 */

import { useState, useCallback, useMemo } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/core/ui'
import { relativeTime } from '@/features/source/reviews/lib/reviewDates'
import { t } from '@/lib/i18n'
import type { FileAnnotation } from '@/types/database'

import { CommentInput } from './CommentInput'

export interface CommentThreadProps {
  /** The top-level comment (with nested `replies`). */
  annotation: FileAnnotation
  /** The signed-in user (edit and delete their own). */
  currentUserId: string | null
  /** Its pin number on the drawing. */
  number?: number
  isActive?: boolean
  /** The PDF box or this thread is hovered (both ways). */
  isHovered?: boolean
  onClick?: () => void
  onReply: (parentId: string, text: string) => Promise<void>
  onEdit: (annotationId: string, newText: string) => Promise<void>
  onDelete: (annotationId: string) => Promise<void>
  onResolve: (annotationId: string) => Promise<void>
  onUnresolve: (annotationId: string) => Promise<void>
  onHoverChange?: (isHovered: boolean) => void
  /** No reply, edit or delete (an earlier round, or a closed review). */
  readOnly?: boolean
  /** Resolve / Reopen is offered (canResolveThread); independent of `readOnly`. */
  canResolve?: boolean
  /** The name of whoever resolved it, when known. */
  resolvedByName?: string | null
}

function displayName(user?: FileAnnotation['user']): string {
  if (!user) return t('markups.unknownUser')
  return user.full_name || user.email || t('markups.unknownUser')
}

const ACTION =
  'rounded px-1 -mx-1 text-[12px] text-ui-fg-secondary hover:text-ui-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 disabled:opacity-50'

function CommentBody({
  annotation,
  currentUserId,
  isRoot,
  header,
  actions,
  onEdit,
  onDelete,
}: {
  annotation: FileAnnotation
  currentUserId: string | null
  isRoot: boolean
  header?: React.ReactNode
  actions?: React.ReactNode
  onEdit: (annotationId: string, newText: string) => Promise<void>
  onDelete: (annotationId: string) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(annotation.comment)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const own = currentUserId != null && annotation.user_id === currentUserId

  const save = useCallback(async () => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === annotation.comment) {
      setIsEditing(false)
      setEditText(annotation.comment)
      return
    }
    setIsSaving(true)
    try {
      await onEdit(annotation.id, trimmed)
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }, [editText, annotation.id, annotation.comment, onEdit])

  const remove = useCallback(async () => {
    setIsDeleting(true)
    try {
      await onDelete(annotation.id)
    } finally {
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }, [annotation.id, onDelete])

  return (
    <div className="group/comment min-w-0">
      {/* A narrow column wraps the time and page under the name instead of cutting the name. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12px] text-ui-fg-secondary">
        {header}
        <span className="max-w-full truncate text-[13px] font-medium text-ui-fg">
          {displayName(annotation.user)}
        </span>
        <span className="flex-shrink-0">{relativeTime(annotation.created_at)}</span>
        {annotation.edited_at && (
          <span className="flex-shrink-0 text-ui-fg-tertiary">· {t('markups.edited')}</span>
        )}
        {isRoot && annotation.page_number != null && (
          <span className="flex-shrink-0">
            · {t('markups.page', { page: annotation.page_number })}
          </span>
        )}
      </div>

      {isEditing ? (
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void save()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setIsEditing(false)
                setEditText(annotation.comment)
              }
            }}
            disabled={isSaving}
            autoFocus
            rows={2}
            className="w-full resize-none rounded-lg border border-ui-field-border bg-ui-field px-2.5 py-1.5 text-[13px] text-ui-fg outline-none focus:border-ui-accent/70 focus:ring-2 focus:ring-ui-accent/25 disabled:opacity-50"
          />
          <div className="mt-1 flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={isSaving}
              onClick={() => {
                setIsEditing(false)
                setEditText(annotation.comment)
              }}
            >
              {t('markups.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={isSaving}
              disabled={editText.trim().length === 0}
              onClick={() => void save()}
            >
              {t('markups.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.45] ${
            isRoot && annotation.resolved ? 'text-ui-fg-secondary' : 'text-ui-fg'
          }`}
        >
          {annotation.comment}
        </div>
      )}

      {confirmDelete && (
        <div
          className="mt-1.5 flex items-center gap-2 text-[13px]"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex-1 text-ui-fg">{t('markups.deleteConfirm')}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={isDeleting}
            onClick={() => setConfirmDelete(false)}
          >
            {t('markups.cancel')}
          </Button>
          <Button size="sm" variant="danger" loading={isDeleting} onClick={() => void remove()}>
            {t('markups.delete')}
          </Button>
        </div>
      )}

      {!isEditing && !confirmDelete && (actions || own) && (
        <div
          className="mt-1 flex flex-wrap items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
          {own && (
            <span className="flex items-center gap-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover/comment:opacity-100">
              <button
                type="button"
                className={ACTION}
                aria-label={t('markups.editAria')}
                onClick={() => {
                  setEditText(annotation.comment)
                  setIsEditing(true)
                }}
              >
                {t('markups.edit')}
              </button>
              <button
                type="button"
                className={`${ACTION} hover:text-ui-danger`}
                aria-label={t('markups.deleteAria')}
                onClick={() => setConfirmDelete(true)}
              >
                {t('markups.delete')}
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** The pin number as a small filled circle, matching the box on the PDF. */
export function ThreadNumber({ number, resolved }: { number: number; resolved: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center self-center rounded-full px-1 text-[11px] font-semibold tabular-nums text-white ${
        resolved ? 'bg-ui-fg-tertiary' : 'bg-ui-accent'
      }`}
    >
      {number}
    </span>
  )
}

export function CommentThread({
  annotation,
  currentUserId,
  number,
  isActive = false,
  isHovered = false,
  onClick,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onUnresolve,
  onHoverChange,
  readOnly = false,
  canResolve = false,
  resolvedByName,
}: CommentThreadProps) {
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [isReplying, setIsReplying] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const replies = useMemo(() => annotation.replies ?? [], [annotation.replies])
  const resolved = annotation.resolved

  const submitReply = useCallback(
    async (text: string) => {
      setIsReplying(true)
      try {
        await onReply(annotation.id, text)
        setShowReplyInput(false)
      } finally {
        setIsReplying(false)
      }
    },
    [annotation.id, onReply],
  )

  const toggleResolved = useCallback(async () => {
    setIsResolving(true)
    try {
      if (resolved) await onUnresolve(annotation.id)
      else await onResolve(annotation.id)
    } finally {
      setIsResolving(false)
    }
  }, [annotation.id, resolved, onResolve, onUnresolve])

  const editorId = readOnly ? null : currentUserId
  const rootActions = (
    <>
      {/* Who resolved it, then what can be done: one line under the comment. */}
      {resolved && (
        <span className="inline-flex items-center gap-1 text-[12px] text-ui-success">
          <Check size={12} aria-hidden />
          {resolvedByName
            ? t('markups.resolvedBy', { name: resolvedByName })
            : t('markups.resolved')}
        </span>
      )}
      {!readOnly && (
        <button
          type="button"
          className={ACTION}
          aria-label={t('markups.replyAria')}
          onClick={() => setShowReplyInput((v) => !v)}
        >
          {t('markups.reply')}
        </button>
      )}
      {canResolve && (
        <button
          type="button"
          className={ACTION}
          disabled={isResolving}
          aria-label={resolved ? t('markups.unresolveAria') : t('markups.resolveAria')}
          onClick={() => void toggleResolved()}
        >
          {isResolving && <Loader2 size={11} className="mr-1 inline animate-spin" />}
          {resolved ? t('markups.unresolve') : t('markups.resolve')}
        </button>
      )}
    </>
  )

  return (
    <div
      className={`cursor-pointer px-3 py-2.5 outline-none transition-colors focus-visible:bg-ui-hover ${
        isActive ? 'bg-ui-selected' : isHovered ? 'bg-ui-hover' : 'hover:bg-ui-hover'
      }`}
      onClick={onClick}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onKeyDown={(e) => {
        // Only the thread itself: Space and Enter typed in a nested box must reach the box.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      aria-label={t(resolved ? 'markups.commentByResolved' : 'markups.commentBy', {
        name: displayName(annotation.user),
      })}
    >
      <CommentBody
        annotation={annotation}
        currentUserId={editorId}
        isRoot
        header={
          number !== undefined ? <ThreadNumber number={number} resolved={resolved} /> : undefined
        }
        actions={rootActions}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l border-ui-divider pl-3">
          {replies.map((reply) => (
            <CommentBody
              key={reply.id}
              annotation={reply}
              currentUserId={editorId}
              isRoot={false}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {showReplyInput && !readOnly && (
        <div
          className="mt-2 border-l border-ui-accent/50 pl-3"
          onClick={(e) => e.stopPropagation()}
        >
          <CommentInput
            placeholder={t('markups.replyPlaceholder')}
            onSubmit={submitReply}
            onCancel={() => setShowReplyInput(false)}
            isLoading={isReplying}
            compact
          />
        </div>
      )}
    </div>
  )
}
