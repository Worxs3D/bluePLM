/**
 * The server side of comments in the ui-look review backend, as the SQL has it:
 *
 * - who may resolve or reopen a comment: `file_comment_set_resolved` (0512_comment_resolve.sql) and
 *   `file_comment_list_resolvable` (0514_review_comment_notify.sql) share this one rule;
 * - the notification a new comment or reply in an open review writes
 *   (`trg_file_comment_notify_review`, 0514): to the requester and the current round's reviewers
 *   who are not withdrawn and can read the vault, never the commenter, at most once per recipient
 *   per review per hour, with `action_url` naming the item and thread.
 *
 * Explorer edit is modelled per vault (`ExplorerEdit`): a user absent from the map may edit every
 * vault, as every perf user can unless a scene says otherwise.
 */
import type { FakeSupabase, Row } from '@/test/fakeSupabase'

import type { LookReviewModel, ReviewWorld, WorldUser } from './lookReviewModel'

/** Vaults each user has `module:explorer edit` on; absent = every vault. */
export type ExplorerEdit = Map<string, ReadonlySet<string> | 'all'>

export type ResolveAccess = 'ok' | 'not_found' | 'forbidden'

const HOUR = 3_600_000

/** 512's rule for one comment and caller: readable first (else not_found), then who may. */
export function commentResolveAccess(
  world: ReviewWorld,
  model: LookReviewModel,
  explorerEdit: ExplorerEdit,
  actor: WorldUser | null,
  comment: Row | null,
): ResolveAccess {
  const f = comment ? world.file(String(comment.file_id)) : null
  if (!actor || !comment || !f || f.orgId !== actor.orgId || !f.vaultId || !world.canAccessVault(actor.id, f.vaultId)) {
    return 'not_found'
  }
  if (comment.user_id === actor.id || actor.admin) return 'ok'
  const reviewId = (comment.review_id as string | null) ?? null
  if (reviewId) return model.mayResolveIn(reviewId, actor.id) ? 'ok' : 'forbidden'
  const edit = explorerEdit.get(actor.id) ?? 'all'
  return edit === 'all' || edit.has(f.vaultId) ? 'ok' : 'forbidden'
}

/** The toast text parts trg_file_comment_notify_review() writes. */
export function commentNoticeText(name: string, fileName: string, isReply: boolean, comment: string): { title: string; message: string | null } {
  const title = `${name} ${isReply ? 'replied to a comment on' : 'commented on'} ${fileName}`
  let text = comment.trim().replace(/\s+/g, ' ')
  if (text.length > 140) text = `${text.slice(0, 139).trimEnd()}…`
  return { title, message: text || null }
}

/**
 * Write the notifications a stored comment row calls for (the AFTER INSERT trigger), and queue
 * them for delivery when their user signs in.
 */
export function notifyReviewComment(
  db: FakeSupabase,
  world: ReviewWorld,
  model: LookReviewModel,
  comment: Row,
  deliver: (row: Row) => void,
): void {
  const reviewId = (comment.review_id as string | null) ?? null
  if (!reviewId) return
  const audience = model.commentAudience(reviewId)
  const f = world.file(String(comment.file_id))
  if (!audience || !audience.open || !f || f.orgId !== audience.orgId) return
  const author = world.user(String(comment.user_id))
  const name = author?.fullName?.trim() || author?.email || 'Someone'
  const parentId = (comment.parent_id as string | null) ?? null
  const { title, message } = commentNoticeText(name, f.fileName, !!parentId, String(comment.comment ?? ''))
  const itemId = (comment.review_item_id as string | null) ?? null
  const actionUrl = `review/${reviewId}${itemId ? `/item/${itemId}` : ''}/comment/${parentId ?? String(comment.id)}`
  db.now = Date.now()
  const since = Date.now() - HOUR
  for (const userId of new Set(audience.recipients)) {
    if (userId === comment.user_id) continue
    const u = world.user(userId)
    if (!u || u.orgId !== audience.orgId || !world.canAccessVault(userId, f.vaultId)) continue
    const recent = db.rows('notification').some(
      (n) => n.type === 'review_comment' && n.entity_type === 'review' && n.entity_id === reviewId &&
        n.user_id === userId && Date.parse(String(n.created_at)) > since,
    )
    if (recent) continue
    const row = db.seed('notification', {
      org_id: audience.orgId,
      user_id: userId,
      type: 'review_comment',
      category: 'review',
      title,
      message,
      priority: audience.priority,
      entity_type: 'review',
      entity_id: reviewId,
      from_user_id: String(comment.user_id),
      action_type: 'open_review',
      action_url: actionUrl,
      is_read: false,
    })
    deliver(row as unknown as Row)
  }
}
