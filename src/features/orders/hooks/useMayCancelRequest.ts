import { useCallback } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

/**
 * Whether this user may cancel an output request (`version_output_request_cancel`): the person
 * who asked, or an administrator.
 */
export function useMayCancelRequest(): (requestedBy: string | null) => boolean {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  return useCallback(
    (requestedBy: string | null) => isAdmin || (userId !== null && requestedBy === userId),
    [isAdmin, userId],
  )
}
