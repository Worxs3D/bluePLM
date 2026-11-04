/**
 * Comments from an earlier round of a review, under the current round's (review UX audit F4).
 * After a resubmit the reviewer opens round 2 and still sees what they asked for in round 1: one
 * collapsed group per earlier round, with its open and resolved counts. The text is read-only
 * (it was written on an older version), but a thread can still be resolved or reopened, and
 * selecting one shows it on the version it was made on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

import { Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { getFileAnnotations, type AnnotationReviewScope } from '@/lib/supabase/annotations'
import { setCommentResolved } from '@/lib/supabase/commentResolve'
import { usePDMStore } from '@/stores/pdmStore'
import type { FileAnnotation } from '@/types/database'

import { CommentThread } from './CommentThread'
import {
  canResolveThread,
  numberThreads,
  sortThreads,
  threadCounts,
  type EarlierRound,
  type ResolveContext,
} from './commentThreads'

interface EarlierRoundCommentsProps {
  fileId: string
  reviewId: string
  itemId: string
  round: EarlierRound
  resolveContext: ResolveContext
  userNames?: ReadonlyMap<string, string>
  /** Show this thread on its round's version (the viewer switches rounds). */
  onOpen: (round: number, annotationId: string) => void
  /** Open at first (the round just before the shown one: what the reviewer asked last time). */
  defaultExpanded?: boolean
}

const NOOP = async () => {}

export function EarlierRoundComments({
  fileId,
  reviewId,
  itemId,
  round,
  resolveContext,
  userNames,
  onOpen,
  defaultExpanded = false,
}: EarlierRoundCommentsProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const [threads, setThreads] = useState<FileAnnotation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const scope: AnnotationReviewScope = { reviewId, round: round.round, itemId }
    setError(null)
    getFileAnnotations(fileId, round.version ?? undefined, scope)
      .then((result) => {
        if (cancelled) return
        if (result.error) setError(result.error)
        else setThreads(result.annotations)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [fileId, reviewId, itemId, round.round, round.version, attempt])

  const counts = useMemo(() => threadCounts(threads ?? []), [threads])
  const numbers = useMemo(() => numberThreads(threads ?? []), [threads])
  const sorted = useMemo(() => sortThreads((threads ?? []).filter((a) => !a.parent_id)), [threads])

  const setResolved = useCallback(
    async (id: string, resolved: boolean) => {
      const before = threads
      setThreads((list) => list?.map((a) => (a.id === id ? { ...a, resolved } : a)) ?? list)
      const { result, error: resolveError } = await setCommentResolved(id, resolved)
      if (resolveError || !result) {
        log.warn('[Comments]', 'Resolving an earlier-round comment failed', {
          error: resolveError,
          id,
        })
        addToast(
          'error',
          t(resolved ? 'markups.resolveFailed' : 'markups.unresolveFailed', {
            message: resolveError ?? '',
          }),
        )
        setThreads(before)
        return
      }
      setThreads(
        (list) =>
          list?.map((a) =>
            a.id === id
              ? {
                  ...a,
                  resolved: result.isResolved,
                  resolved_by: result.resolvedBy,
                  resolved_at: result.resolvedAt,
                }
              : a,
          ) ?? list,
      )
    },
    [threads, addToast],
  )

  if (threads && sorted.length === 0) return null

  const title =
    round.version != null
      ? t('markups.fromRoundVersion', { round: round.round, version: round.version })
      : t('markups.fromRound', { round: round.round })

  return (
    <div className="border-t border-ui-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left outline-none hover:bg-ui-hover focus-visible:bg-ui-hover"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-ui-fg-secondary" />
        ) : (
          <ChevronRight size={14} className="text-ui-fg-secondary" />
        )}
        <span className="text-[13px] font-medium text-ui-fg">{title}</span>
        <span className="ml-auto text-[12px] text-ui-fg-secondary">
          {threads ? (
            t('markups.fromRoundCount', { open: counts.open, resolved: counts.resolved })
          ) : error ? null : (
            <Loader2 size={12} className="animate-spin" />
          )}
        </span>
      </button>
      {error && (
        <div className="flex items-center gap-2 px-3 pb-2 text-[13px] text-ui-fg-secondary">
          <span className="flex-1">{t('markups.loadError')}</span>
          <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            {t('markups.retry')}
          </Button>
        </div>
      )}
      {expanded && threads && (
        <>
          <p className="px-3 pb-1 text-[12px] text-ui-fg-tertiary">{t('markups.fromRoundHint')}</p>
          <div className="divide-y divide-ui-divider">
            {sorted.map((ann) => (
              <CommentThread
                key={ann.id}
                annotation={ann}
                number={numbers.get(ann.id)}
                currentUserId={null}
                readOnly
                canResolve={canResolveThread(ann, resolveContext)}
                resolvedByName={ann.resolved_by ? (userNames?.get(ann.resolved_by) ?? null) : null}
                onClick={() => onOpen(round.round, ann.id)}
                onReply={NOOP}
                onEdit={NOOP}
                onDelete={NOOP}
                onResolve={(id) => setResolved(id, true)}
                onUnresolve={(id) => setResolved(id, false)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
