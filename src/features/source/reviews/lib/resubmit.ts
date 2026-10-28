/**
 * Choosing versions for "Resubmit with newer versions". The server's rule: every item not yet
 * approved must move to a newer version of its file than the one last reviewed; approved items
 * carry forward untouched.
 */

import type { ResubmitItemInput, ReviewItemDetail } from '@/types/reviews'

export interface VersionOption {
  fileVersionId: string
  version: number
  revision: string | null
  createdAt: string | null
}

/** Items the requester must give a newer version. */
export function itemsNeedingNewVersion(items: readonly ReviewItemDetail[]): ReviewItemDetail[] {
  return items.filter((item) => item.outcome !== 'approved')
}

/** Versions of the item's file newer than the one last reviewed, newest first. */
export function newerVersionOptions(
  item: ReviewItemDetail,
  versions: readonly VersionOption[],
): VersionOption[] {
  return versions
    .filter((v) => v.version > item.version.version)
    .sort((a, b) => b.version - a.version)
}

/** Default pick: the newest newer version of each item, or null when there is none yet. */
export function defaultResubmitSelection(
  items: readonly ReviewItemDetail[],
  versionsByFile: Readonly<Record<string, readonly VersionOption[]>>,
): Record<string, string | null> {
  const selection: Record<string, string | null> = {}
  for (const item of itemsNeedingNewVersion(items)) {
    const options = newerVersionOptions(item, versionsByFile[item.fileId] ?? [])
    selection[item.id] = options[0]?.fileVersionId ?? null
  }
  return selection
}

export interface ResubmitPlan {
  ready: boolean
  /** Items still without a newer version picked. */
  missing: string[]
  payload: ResubmitItemInput[]
}

export function planResubmit(
  items: readonly ReviewItemDetail[],
  selection: Readonly<Record<string, string | null>>,
): ResubmitPlan {
  const missing: string[] = []
  const payload: ResubmitItemInput[] = []
  for (const item of itemsNeedingNewVersion(items)) {
    const fileVersionId = selection[item.id]
    if (!fileVersionId || fileVersionId === item.version.fileVersionId) {
      missing.push(item.id)
    } else {
      payload.push({ itemId: item.id, fileVersionId })
    }
  }
  return { ready: missing.length === 0 && payload.length > 0, missing, payload }
}
