/**
 * Resolve or reopen a file comment through `file_comment_set_resolved()` (schema 512).
 *
 * The comment UPDATE policy is the author's only, so resolving someone else's markup has to go
 * through this SECURITY DEFINER RPC. It is allowed for the comment's author, an administrator, the
 * requester and the (not withdrawn) reviewers of the review the comment was made in, and, for a
 * comment outside a review, a member with explorer edit; the file's vault must be readable. It
 * writes `is_resolved`, `resolved_by` (the caller, or null on reopen) and `resolved_at` only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseClient } from './client'
import { log } from '@/lib/logger'

/** The refusals `file_comment_set_resolved()` raises (its HINT), plus `UNKNOWN` for anything else. */
export type CommentResolveErrorCode = 'COMMENT_NOT_FOUND' | 'FORBIDDEN' | 'BAD_ARGUMENTS' | 'UNKNOWN'

const ERROR_CODES: readonly CommentResolveErrorCode[] = ['COMMENT_NOT_FOUND', 'FORBIDDEN', 'BAD_ARGUMENTS']

/** The comment's resolve columns after the call. */
export interface CommentResolveResult {
  commentId: string
  fileId: string
  isResolved: boolean
  resolvedBy: string | null
  resolvedAt: string | null
  /** False when the comment was already in the asked state (nothing was written). */
  changed: boolean
}

interface ResolveRow {
  id?: string
  file_id?: string
  is_resolved?: boolean
  resolved_by?: string | null
  resolved_at?: string | null
  changed?: boolean
}

/** Map an RPC error's hint to a code; exported for tests. */
export function commentResolveErrorCode(hint: string | null | undefined): CommentResolveErrorCode {
  return ERROR_CODES.find((c) => c === hint) ?? 'UNKNOWN'
}

/** Map the RPC's JSON result; exported for tests. */
export function toCommentResolveResult(data: unknown): CommentResolveResult {
  const r = (data ?? {}) as ResolveRow
  return {
    commentId: String(r.id ?? ''),
    fileId: String(r.file_id ?? ''),
    isResolved: r.is_resolved === true,
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: r.resolved_at ?? null,
    changed: r.changed === true,
  }
}

/**
 * Resolve (`resolved = true`) or reopen (`false`) one comment, a root thread or a reply. Returns the
 * resolve columns, or `{ error, code }` on refusal: `COMMENT_NOT_FOUND` (missing, or on a file the
 * caller cannot read), `FORBIDDEN` (readable but not the caller's to resolve), `BAD_ARGUMENTS`.
 */
export async function setCommentResolved(
  commentId: string,
  resolved: boolean,
): Promise<{ result: CommentResolveResult | null; error: string | null; code: CommentResolveErrorCode | null }> {
  const c = getSupabaseClient() as unknown as SupabaseClient
  const { data, error } = await c.rpc('file_comment_set_resolved', {
    p_comment_id: commentId,
    p_resolved: resolved,
  })
  if (error) {
    const code = commentResolveErrorCode(error.hint)
    log.warn('[Annotations]', 'file_comment_set_resolved failed', { code, message: error.message, commentId })
    return { result: null, error: error.message, code }
  }
  return { result: toCommentResolveResult(data), error: null, code: null }
}

/** The optimistic id CommentSidebar gives a comment until the insert returns its row. */
const UNSAVED_PREFIX = 'temp-'
/** The server reads at most this many ids per call (`file_comment_list_resolvable`). */
export const RESOLVABLE_BATCH = 2000

/** Map the RPC's uuid[] result; exported for tests. */
export function toResolvableIds(data: unknown): Set<string> {
  const ids = new Set<string>()
  if (Array.isArray(data)) for (const id of data) if (typeof id === 'string') ids.add(id)
  return ids
}

/**
 * Which of these comments the signed-in user may resolve or reopen, through
 * `file_comment_list_resolvable()` (schema 514): exactly `file_comment_set_resolved`'s rule, so
 * explorer edit counts only on the comment's own vault. Ids that are not saved comments yet (an
 * optimistic temp id) are left out. Returns `{ ids: null, error }` when the server could not answer.
 */
export async function listResolvableComments(
  commentIds: readonly string[],
): Promise<{ ids: Set<string> | null; error: string | null }> {
  const wanted = [...new Set(commentIds.filter((id) => !!id && !id.startsWith(UNSAVED_PREFIX)))]
  const ids = new Set<string>()
  if (wanted.length === 0) return { ids, error: null }
  const c = getSupabaseClient() as unknown as SupabaseClient
  for (let start = 0; start < wanted.length; start += RESOLVABLE_BATCH) {
    const { data, error } = await c.rpc('file_comment_list_resolvable', {
      p_comment_ids: wanted.slice(start, start + RESOLVABLE_BATCH),
    })
    if (error) {
      log.warn('[Annotations]', 'file_comment_list_resolvable failed', { message: error.message, hint: error.hint })
      return { ids: null, error: error.message }
    }
    for (const id of toResolvableIds(data)) ids.add(id)
  }
  return { ids, error: null }
}
