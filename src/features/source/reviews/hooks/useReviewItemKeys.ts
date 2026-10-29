/**
 * J / K move to the next / previous item of the open review. Mounted by the detail pane for
 * everyone viewing the review (requester, administrator, a reviewer who already decided), not by
 * the decision bar, which only reviewers who still owe a decision see. The same guards as the
 * decision keys apply: ignored while typing, while a modal is open, and with Ctrl, Cmd or Alt held.
 */

import { useEffect } from 'react'

import { isEditableTarget, isModalOpen, mapDecisionKey } from '../lib/decisionKeys'

export function useReviewItemKeys(enabled: boolean, onNext: () => void, onPrevious: () => void): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const action = mapDecisionKey({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        inEditable: isEditableTarget(event.target) || isModalOpen(),
        repeat: event.repeat,
      })
      if (action?.kind === 'next') onNext()
      else if (action?.kind === 'previous') onPrevious()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, onNext, onPrevious])
}
