/**
 * CommentInput - the text box for a new comment on the drawing, and the reply box inside a thread.
 *
 * Enter posts, Shift+Enter adds a line, Escape cancels (the hint under the box says so). A failed
 * post keeps the typed text so it can be retried; the caller shows the error.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { MapPin, X } from 'lucide-react'

import { Button, IconButton } from '@/components/core/ui'
import { t } from '@/lib/i18n'

export interface CommentInputProps {
  /** Page number the comment is anchored to (shown above the box). */
  pageNumber?: number | null
  placeholder?: string
  onSubmit: (text: string) => void | Promise<void>
  onCancel: () => void
  isLoading?: boolean
  /** Focus the box on mount (default true). */
  autoFocus?: boolean
  /** The inline reply box: one line, no page indicator. */
  compact?: boolean
}

export function CommentInput({
  pageNumber,
  placeholder,
  onSubmit,
  onCancel,
  isLoading = false,
  autoFocus = true,
  compact = false,
}: CommentInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  // Grow with the text, up to 200px.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [text])

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    try {
      await onSubmit(trimmed)
      setText('')
    } catch {
      // Keep the typed text so the user can retry; the caller surfaces the error (toast)
    }
  }, [text, isLoading, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  const canSubmit = text.trim().length > 0 && !isLoading

  return (
    <div className="flex flex-col gap-1.5" role="form" aria-label={t('markups.inputLabel')}>
      {pageNumber != null && !compact && (
        <div className="flex items-center gap-1 text-[12px] text-ui-fg-secondary">
          <MapPin size={12} aria-hidden />
          <span>{t('markups.page', { page: pageNumber })}</span>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t('markups.placeholder')}
          disabled={isLoading}
          rows={compact ? 1 : 2}
          aria-label={t('markups.inputText')}
          className={`w-full resize-none rounded-lg border border-ui-field-border bg-ui-field px-2.5 py-1.5 text-[13px] leading-[1.45] text-ui-fg outline-none placeholder:text-ui-fg-secondary focus:border-ui-accent/70 focus:ring-2 focus:ring-ui-accent/25 disabled:opacity-50 ${
            compact ? 'min-h-[32px]' : 'min-h-[56px]'
          }`}
        />
        {compact && (
          <IconButton
            label={t('markups.inputCancel')}
            icon={<X size={14} />}
            onClick={onCancel}
            disabled={isLoading}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[12px] text-ui-fg-tertiary"
          title={t('markups.inputHint')}
        >
          {t('markups.inputHint')}
        </span>
        {!compact && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={isLoading}>
            {t('markups.cancel')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          loading={isLoading}
          aria-label={t('markups.inputSubmit')}
        >
          {compact ? t('markups.reply') : t('markups.post')}
        </Button>
      </div>
    </div>
  )
}
