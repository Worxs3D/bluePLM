/**
 * Ctrl+C inside the terminal, while a command is processing, used to be a no-op — the branch
 * existed with a comment ("Could add cancel logic here if commands support it") and nothing
 * behind it. The one way a terminal command actually blocks forever is a handler that called
 * `ctx.confirm()` (`adopt-server-paths`, `reconcile-moved-paths`, `checkin`'s path-change guard)
 * and is now awaiting a click on `CommandConfirmContainer` — a dialog that lives outside the
 * terminal's own DOM subtree, so nothing in the terminal panel changes to show it is even open.
 * A user who does not notice it, or whose window loses focus before they do, has no way back
 * except a force-quit. See `.cursor/plans/reconcile-hang-incident-report.md`.
 *
 * This gives Ctrl+C a real job for exactly that situation: decline the pending confirmation, the
 * same as clicking "Cancel" on the dialog. Kept as a standalone function (rather than inlined in
 * `Terminal.tsx`'s key handler) so the decision — "is there something to cancel, and did we just
 * cancel it" — is unit-testable without rendering the component.
 */

import { resolveCommandConfirm } from '@/lib/commands/executor'
import type { PDMStoreState } from '@/stores/types'

export type PendingCommandConfirm = PDMStoreState['pendingCommandConfirm']

/**
 * Declines the pending command confirmation, if one is open.
 *
 * @returns `true` when a confirmation was actually pending and was cancelled — the caller uses
 * this to decide whether to print a "cancelled" line, versus falling back to Ctrl+C's other
 * meaning (clearing the input) when nothing was waiting.
 */
export function cancelPendingCommandConfirm(pendingCommandConfirm: PendingCommandConfirm): boolean {
  if (!pendingCommandConfirm) return false
  resolveCommandConfirm(false)
  return true
}
