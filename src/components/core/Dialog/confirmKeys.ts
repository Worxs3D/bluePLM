/**
 * Enter in a ConfirmDialog confirms, except where the focused element handles Enter itself: a
 * text area (a new line) or one of the dialog's own buttons (it activates). A focused button
 * outside the dialog, typically the one that opened it, does not count: Enter there would click
 * the opener again, so the dialog confirms instead.
 */
export function enterConfirms(target: Element | null, dialog: Element | null): boolean {
  if (!target) return true
  if (target.tagName === 'TEXTAREA') return false
  if (target.tagName === 'BUTTON' && !!dialog && dialog.contains(target)) return false
  return true
}
