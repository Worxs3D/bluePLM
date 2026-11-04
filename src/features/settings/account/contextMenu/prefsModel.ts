/**
 * The person's right-click menu prefs as the settings page edits them (`contextMenuPrefs`).
 */

import type { UserContextMenuPrefs } from '@/lib/contextMenu/types'

export const EMPTY_PREFS: UserContextMenuPrefs = { templateId: null, pinned: [], hidden: [], custom: null }

/**
 * What the page's edits start from. While an admin's "Apply to everyone now" has set the person's
 * own layout aside, it is dropped here: any change other than "Keep my layout" then saves without
 * it, so a later write (picking a template, a pin) can never bring the set-aside layout back.
 */
export function editablePrefs(stored: UserContextMenuPrefs | undefined, setAside: boolean): UserContextMenuPrefs {
  const prefs = stored ?? EMPTY_PREFS
  if (!setAside) return prefs
  return { ...prefs, custom: null, pinned: [], hidden: [], customizedFrom: undefined }
}

/** "Keep my layout": the stored prefs as they are, marked kept after that force. */
export function keptPrefs(stored: UserContextMenuPrefs, forcedAt: string): UserContextMenuPrefs {
  return { ...stored, keptAfterForce: forcedAt, updatedAt: new Date().toISOString() }
}

/** What to store for `next`: null when nothing is left to remember, else `next` stamped now. */
export function prefsToStore(next: UserContextMenuPrefs, now = new Date()): UserContextMenuPrefs | null {
  const isEmpty =
    next.templateId === null && next.pinned.length === 0 && next.hidden.length === 0 && next.custom === null
  if (isEmpty && !next.keptAfterForce) return null
  return { ...next, updatedAt: now.toISOString() }
}
