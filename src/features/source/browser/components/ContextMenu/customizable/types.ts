import type { ReactNode } from 'react'

import type { ContextMenuEntryId } from '@/lib/contextMenu/entries'

/** What each entry draws for this selection; `null` (or absent) = it does not apply. */
export type EntryElements = Partial<Record<ContextMenuEntryId, ReactNode | null>>

/**
 * What an entry hook (`useXEntries(props)`) returns.
 *
 * `entries` names every id the hook owns, `null` where it does not apply, so a menu can tell
 * which entries it has (`Object.keys`) and the compiler holds each hook to its ids. `overlays`
 * are the dialogs and confirmations the entries open: always rendered, beside the menu rather
 * than in it, so moving or hiding an entry never unmounts its dialog.
 */
export interface EntryHookResult<K extends ContextMenuEntryId = ContextMenuEntryId> {
  entries: Record<K, ReactNode | null>
  overlays?: ReactNode
}
