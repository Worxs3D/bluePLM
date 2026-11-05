/**
 * Which of the shown comments the viewer may resolve or reopen, asked of the database
 * (`file_comment_list_resolvable`, schema 514) whenever the set of comment ids changes. The answer
 * depends on the comment and the viewer only (author, review roles, admin, explorer edit on the
 * comment's vault), not on whether it is resolved, so a resolve or an edit does not ask again.
 *
 * Null until the first answer, and when no read has succeeded: `canResolveThread` then offers
 * Resolve on the viewer's own comments only.
 */
import { useEffect, useMemo, useState } from 'react'

import { listResolvableComments } from '@/lib/supabase/commentResolve'
import type { FileAnnotation } from '@/types/database'

import { commentIds } from './commentThreads'

export function useResolvableComments(
  threads: readonly FileAnnotation[] | null,
  userId: string | null,
): ReadonlySet<string> | null {
  const key = useMemo(() => (threads ? commentIds(threads).join(',') : ''), [threads])
  const [answer, setAnswer] = useState<{ userId: string; ids: ReadonlySet<string> } | null>(null)

  useEffect(() => {
    if (!userId || !key) return
    let cancelled = false
    void listResolvableComments(key.split(',')).then(({ ids }) => {
      if (!cancelled && ids) setAnswer({ userId, ids })
    })
    return () => {
      cancelled = true
    }
  }, [key, userId])

  // While a changed set loads, the last answer still holds for the comments it names (a new
  // comment is not in it, so it offers nothing until asked); another viewer's answer never does.
  return answer && answer.userId === userId ? answer.ids : null
}
