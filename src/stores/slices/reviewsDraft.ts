/**
 * Pure transitions of a review package draft. The `reviews` slice applies them to the signed-in
 * user's draft; they are kept here, free of the store, so they can be tested directly.
 */

import type { ReviewMode, ReviewPriority } from '../../types/reviews'
import {
  MAX_REVIEW_PACKAGE_ITEMS,
  type ReviewPackageDraft,
  type ReviewPackageDraftItem,
} from '../../types/reviewPackageDraft'

export function emptyReviewPackageDraft(): ReviewPackageDraft {
  return {
    items: [],
    reviewerIds: [],
    teamIds: [],
    mode: 'all',
    priority: 'normal',
    dueDate: null,
    title: '',
    message: '',
  }
}

export interface AddItemsOutcome {
  draft: ReviewPackageDraft
  added: number
  /** Files already in the draft whose pinned version changed. */
  replaced: number
  /** Items left out because the package is full. */
  dropped: number
}

/**
 * Add items, one per file: the server refuses two versions of the same file in one review, so
 * adding a file already in the draft replaces its version in place (keeping its position).
 */
export function addDraftItems(
  draft: ReviewPackageDraft,
  incoming: readonly ReviewPackageDraftItem[],
): AddItemsOutcome {
  const items = [...draft.items]
  const indexByFile = new Map(items.map((item, i) => [item.fileId, i]))
  let added = 0
  let replaced = 0
  let dropped = 0
  for (const item of incoming) {
    const existing = indexByFile.get(item.fileId)
    if (existing !== undefined) {
      if (items[existing].fileVersionId !== item.fileVersionId) {
        items[existing] = item
        replaced++
      }
      continue
    }
    if (items.length >= MAX_REVIEW_PACKAGE_ITEMS) {
      dropped++
      continue
    }
    indexByFile.set(item.fileId, items.length)
    items.push(item)
    added++
  }
  return { draft: added || replaced ? { ...draft, items } : draft, added, replaced, dropped }
}

export function removeDraftItem(draft: ReviewPackageDraft, fileId: string): ReviewPackageDraft {
  const items = draft.items.filter((item) => item.fileId !== fileId)
  return items.length === draft.items.length ? draft : { ...draft, items }
}

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

export function toggleDraftReviewer(draft: ReviewPackageDraft, userId: string): ReviewPackageDraft {
  return { ...draft, reviewerIds: toggle(draft.reviewerIds, userId) }
}

export function toggleDraftTeam(draft: ReviewPackageDraft, teamId: string): ReviewPackageDraft {
  return { ...draft, teamIds: toggle(draft.teamIds, teamId) }
}

export interface DraftMetaPatch {
  mode?: ReviewMode
  priority?: ReviewPriority
  dueDate?: string | null
  title?: string
  message?: string
}

export function patchDraftMeta(draft: ReviewPackageDraft, patch: DraftMetaPatch): ReviewPackageDraft {
  return { ...draft, ...patch }
}

/** Why the draft cannot be submitted yet, or null when it can. */
export type DraftBlocker = 'no_items' | 'no_reviewers' | 'too_many_items'

export function draftBlocker(draft: ReviewPackageDraft): DraftBlocker | null {
  if (draft.items.length === 0) return 'no_items'
  if (draft.items.length > MAX_REVIEW_PACKAGE_ITEMS) return 'too_many_items'
  if (draft.reviewerIds.length === 0 && draft.teamIds.length === 0) return 'no_reviewers'
  return null
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const MODES: readonly string[] = ['all', 'any']
const PRIORITIES: readonly string[] = ['low', 'normal', 'high', 'urgent']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

function readItem(value: unknown): ReviewPackageDraftItem | null {
  if (!isRecord(value)) return null
  const fileId = readString(value.fileId)
  const fileVersionId = readString(value.fileVersionId)
  const fileName = readString(value.fileName)
  const filePath = readString(value.filePath)
  if (!fileId || !fileVersionId || fileName === null || filePath === null) return null
  if (typeof value.version !== 'number') return null
  return {
    fileId,
    fileVersionId,
    version: value.version,
    revision: readString(value.revision),
    state: readString(value.state),
    fileName,
    filePath,
    extension: readString(value.extension),
    vaultId: readString(value.vaultId),
    latestVersion: typeof value.latestVersion === 'number' ? value.latestVersion : value.version,
  }
}

function readDraft(value: unknown): ReviewPackageDraft | null {
  if (!isRecord(value)) return null
  const base = emptyReviewPackageDraft()
  const items = Array.isArray(value.items)
    ? value.items
        .map(readItem)
        .filter((x): x is ReviewPackageDraftItem => x !== null)
        .slice(0, MAX_REVIEW_PACKAGE_ITEMS)
    : []
  const mode = readString(value.mode)
  const priority = readString(value.priority)
  const dueDate = readString(value.dueDate)
  return {
    items,
    reviewerIds: readStringList(value.reviewerIds),
    teamIds: readStringList(value.teamIds),
    mode: mode && MODES.includes(mode) ? (mode as ReviewMode) : base.mode,
    priority: priority && PRIORITIES.includes(priority) ? (priority as ReviewPriority) : base.priority,
    dueDate: dueDate && DATE_ONLY.test(dueDate) ? dueDate : null,
    title: readString(value.title) ?? '',
    message: readString(value.message) ?? '',
  }
}

/** Read persisted drafts defensively: anything malformed is dropped rather than crashing hydration. */
export function sanitizeReviewPackageDrafts(value: unknown): Record<string, ReviewPackageDraft> {
  if (!isRecord(value)) return {}
  const out: Record<string, ReviewPackageDraft> = {}
  for (const [userId, raw] of Object.entries(value)) {
    const draft = readDraft(raw)
    if (draft) out[userId] = draft
  }
  return out
}
