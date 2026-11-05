/**
 * Where a review's files stand, for the files column, the state banner and the resubmit dialog:
 * comment counts per item and round, the files grouped by what they need, and the author's
 * "what to fix" summary after a kickback (review UX audit F5).
 *
 * Pure: the detail, the comment roots (`getReviewCommentRoots`) and the viewer in.
 */

import { t } from '@/lib/i18n'
import type { ReviewDetail, ReviewItemDetail } from '@/types/reviews'

import type { ReviewCommentRoot } from '@/lib/supabase/reviewExtras'

import { displayName } from './reviewState'
import { tCount } from './plural'

export interface ItemCommentCount {
  open: number
  resolved: number
  /** Open threads the viewer started. */
  mineOpen: number
}

const ZERO: ItemCommentCount = { open: 0, resolved: 0, mineOpen: 0 }

/** Thread counts per item for one round. */
export function countCommentsByItem(
  roots: readonly ReviewCommentRoot[],
  round: number,
  userId: string | null,
): Map<string, ItemCommentCount> {
  const out = new Map<string, ItemCommentCount>()
  for (const root of roots) {
    if (root.round !== round) continue
    const prev = out.get(root.itemId) ?? ZERO
    out.set(root.itemId, {
      open: prev.open + (root.resolved ? 0 : 1),
      resolved: prev.resolved + (root.resolved ? 1 : 0),
      mineOpen: prev.mineOpen + (!root.resolved && root.userId === userId ? 1 : 0),
    })
  }
  return out
}

export function commentCountFor(
  counts: ReadonlyMap<string, ItemCommentCount>,
  itemId: string,
): ItemCommentCount {
  return counts.get(itemId) ?? ZERO
}

export type ItemGroupKind = 'to_review' | 'needs_changes' | 'waiting' | 'decided'

export interface ItemGroup {
  kind: ItemGroupKind
  items: ReviewItemDetail[]
}

const GROUP_ORDER: ItemGroupKind[] = ['to_review', 'needs_changes', 'waiting', 'decided']

/**
 * The files column: what the viewer owes first, then files that came back with changes, files
 * others still owe, and decided ones. Within a group the review's own order is kept. `owedIds` is
 * what the viewer still owes (decisions in the undo window count as owed until sent, so they stay
 * where the reviewer left them).
 */
export function groupItems(
  items: readonly ReviewItemDetail[],
  owedIds: ReadonlySet<string>,
): ItemGroup[] {
  const groups = new Map<ItemGroupKind, ReviewItemDetail[]>()
  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const kind: ItemGroupKind = owedIds.has(item.id)
      ? 'to_review'
      : item.outcome === 'changes_requested' || item.outcome === 'rejected'
        ? 'needs_changes'
        : item.outcome === 'pending'
          ? 'waiting'
          : 'decided'
    groups.set(kind, [...(groups.get(kind) ?? []), item])
  }
  return GROUP_ORDER.filter((k) => groups.has(k)).map((kind) => ({
    kind,
    items: groups.get(kind) ?? [],
  }))
}

/** The item list in display order, for J/K and "next owed". */
export function orderedItemIds(groups: readonly ItemGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.id))
}

/** The newest version of the item's file when it is newer than the pinned one. */
export function newerVersion(item: ReviewItemDetail): number | null {
  const latest = item.file.latestVersion
  return latest != null && latest > item.version.version ? latest : null
}

export interface WhatToFix {
  /** Files with changes requested. */
  needsChanges: number
  rejected: number
  total: number
  /** Open threads on the files that need work, this round. */
  openComments: number
  /** Files that need work and already have a newer version checked in. */
  ready: number
  /** The first rejection: who, and what they said. */
  rejection: { by: string | null; comment: string | null } | null
}

/** The author's summary after a kickback or a rejection. */
export function whatToFix(
  detail: ReviewDetail,
  counts: ReadonlyMap<string, ItemCommentCount>,
): WhatToFix {
  const round = detail.review.currentRound
  const failing = detail.items.filter(
    (i) => i.outcome === 'changes_requested' || i.outcome === 'rejected',
  )
  let rejection: WhatToFix['rejection'] = null
  let firstAt = ''
  for (const item of detail.items) {
    for (const d of item.rounds.find((r) => r.roundNumber === round)?.decisions ?? []) {
      if (d.decision !== 'rejected' || (firstAt && d.decidedAt >= firstAt)) continue
      firstAt = d.decidedAt
      const user = detail.reviewers.find((r) => r.user?.id === d.reviewerId)?.user ?? null
      rejection = { by: displayName(user), comment: d.comment }
    }
  }
  return {
    needsChanges: failing.filter((i) => i.outcome === 'changes_requested').length,
    rejected: failing.filter((i) => i.outcome === 'rejected').length,
    total: detail.items.length,
    openComments: failing.reduce((n, i) => n + commentCountFor(counts, i.id).open, 0),
    ready: failing.filter((i) => newerVersion(i) !== null).length,
    rejection,
  }
}

/** The banner sentence for the author. */
export function describeWhatToFix(summary: WhatToFix): string {
  const failing = summary.needsChanges + summary.rejected
  const files = t('reviewDetail.fix.files', { count: failing, total: summary.total })
  const comments =
    summary.openComments > 0 ? tCount('reviewDetail.fix.comments', summary.openComments) : ''
  const next =
    summary.ready === failing && failing > 0
      ? t('reviewDetail.fix.allReady')
      : summary.ready > 0
        ? tCount('reviewDetail.fix.someReady', summary.ready)
        : t('reviewDetail.fix.nextStep')
  return [files + comments + '.', next].join(' ')
}

/** "Approve remaining" covers these: what the viewer owes, in list order. */
export function remainingOwed(order: readonly string[], owed: ReadonlySet<string>): string[] {
  return order.filter((id) => owed.has(id))
}
