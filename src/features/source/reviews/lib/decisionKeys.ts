/**
 * Keyboard map for the review decision bar, and the "next item" rule behind auto-advance.
 *
 *   A        approve (no comment needed, decides at once)
 *   Shift+A  approve with comments (opens the comment box)
 *   C        request changes (opens the comment box)
 *   R        reject (opens the comment box)
 *   J / K    next / previous item
 *
 * Keys are ignored while typing in a field, while a modal dialog is open, and with Ctrl, Cmd or
 * Alt held, so they never fight text entry or the app's own shortcuts. A held-down key (auto-repeat)
 * never decides: with auto-advance it would decide item after item.
 */

import type { ReviewDecision } from '@/types/reviews'

export type DecisionKeyAction =
  | { kind: 'decide'; decision: ReviewDecision }
  | { kind: 'next' }
  | { kind: 'previous' }

export interface DecisionKeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** The event target is an input, textarea, select or contenteditable, or a modal is open. */
  inEditable: boolean
  /** The key is held down (auto-repeat). */
  repeat?: boolean
}

export function mapDecisionKey(event: DecisionKeyEvent): DecisionKeyAction | null {
  if (event.inEditable || event.ctrlKey || event.metaKey || event.altKey) return null
  const decides = !event.repeat
  switch (event.key.toLowerCase()) {
    case 'a':
      return decides
        ? { kind: 'decide', decision: event.shiftKey ? 'approved_with_comments' : 'approved' }
        : null
    case 'c':
      return event.shiftKey || !decides ? null : { kind: 'decide', decision: 'changes_requested' }
    case 'r':
      return event.shiftKey || !decides ? null : { kind: 'decide', decision: 'rejected' }
    case 'j':
      return event.shiftKey ? null : { kind: 'next' }
    case 'k':
      return event.shiftKey ? null : { kind: 'previous' }
    default:
      return null
  }
}

/**
 * Whether a modal dialog is open anywhere (the core `Dialog` marks its overlay). The decision keys
 * listen on the window, so without this a key pressed on a dialog's button would decide the item
 * behind it.
 */
export function isModalOpen(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  return !!doc?.querySelector('[data-native-preview-overlay="modal"]')
}

/** Whether a DOM target takes typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** The item `step` places away from `currentId` (wrapping), or the first item when none is current. */
export function stepItem(
  itemIds: readonly string[],
  currentId: string | null,
  step: 1 | -1,
): string | null {
  if (itemIds.length === 0) return null
  const index = currentId ? itemIds.indexOf(currentId) : -1
  if (index < 0) return itemIds[0]
  return itemIds[(index + step + itemIds.length) % itemIds.length]
}

/**
 * Where to go after deciding `decidedId`: the next item (in list order, wrapping) the reviewer
 * still owes, or null when nothing is left.
 */
export function nextOwedItem(
  itemIds: readonly string[],
  owedIds: readonly string[],
  decidedId: string,
): string | null {
  const owed = new Set(owedIds)
  owed.delete(decidedId)
  if (owed.size === 0) return null
  const start = itemIds.indexOf(decidedId)
  for (let i = 1; i <= itemIds.length; i++) {
    const id = itemIds[(Math.max(start, 0) + i) % itemIds.length]
    if (owed.has(id)) return id
  }
  return null
}
