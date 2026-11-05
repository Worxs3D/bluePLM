/**
 * Small reads the Reviews page needs beside `get_review_detail`: the review's comment threads per
 * item and round (for "9 open comments", the what-to-fix summary and the files list), and whether
 * the pinned versions were released (5.9.0, `file_version.released_at` / `release_revision`).
 *
 * Both are plain RLS reads (no schema or API change). They are additions to the page: a failure
 * is logged by the caller and the page shows less, never nothing.
 */

import { getSupabaseClient } from './client'

/** One thread root (not a reply) of a review, as far as counting goes. */
export interface ReviewCommentRoot {
  itemId: string
  round: number
  userId: string
  resolved: boolean
}

interface CommentRootRow {
  review_item_id: string | null
  review_round: number | null
  user_id: string
  is_resolved: boolean | null
}

/** Every thread root of the review, every round. Replies are left out: they are not separate asks. */
export async function getReviewCommentRoots(reviewId: string): Promise<ReviewCommentRoot[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('file_comment')
    .select('review_item_id, review_round, user_id, is_resolved')
    .eq('review_id', reviewId)
    .is('parent_id', null)
  if (error) throw new Error(error.message)
  const out: ReviewCommentRoot[] = []
  for (const row of (data ?? []) as CommentRootRow[]) {
    if (!row.review_item_id || row.review_round == null) continue
    out.push({
      itemId: row.review_item_id,
      round: row.review_round,
      userId: row.user_id,
      resolved: row.is_resolved === true,
    })
  }
  return out
}

export interface VersionRelease {
  fileVersionId: string
  releasedAt: string
  revision: string | null
}

interface ReleaseRow {
  id: string
  released_at: string | null
  release_revision: string | null
}

/** Released versions among `fileVersionIds` (schema 508 columns; absent before it). */
export async function getVersionReleases(
  fileVersionIds: readonly string[],
): Promise<VersionRelease[]> {
  if (fileVersionIds.length === 0) return []
  const client = getSupabaseClient()
  // The 508 columns are not in the generated types yet; the read names them as plain text.
  const { data, error } = await client
    .from('file_version')
    .select('id, released_at, release_revision' as 'id')
    .in('id', [...new Set(fileVersionIds)])
  if (error) throw new Error(error.message)
  const out: VersionRelease[] = []
  for (const row of (data ?? []) as unknown as ReleaseRow[]) {
    if (row.released_at) {
      out.push({
        fileVersionId: row.id,
        releasedAt: row.released_at,
        revision: row.release_revision,
      })
    }
  }
  return out
}
