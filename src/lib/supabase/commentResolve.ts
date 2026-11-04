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
