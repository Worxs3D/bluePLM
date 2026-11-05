import { Unlock } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'
import type { EntryHookResult } from '@/features/source/browser/components/ContextMenu/customizable/types'

interface AdminEntriesProps {
  contextFiles: LocalFile[]
  isAdmin: boolean
  checkedOutByOthersCount: number
  onClose: () => void
  onRefresh: (silent?: boolean) => void
}

/** `checkout.forceRelease`: an admin releases checkouts held by others. */
export function useTreeAdminEntries({
  contextFiles,
  isAdmin,
  checkedOutByOthersCount,
  onClose,
  onRefresh,
}: AdminEntriesProps): EntryHookResult<'checkout.forceRelease'> {
  const handleForceRelease = () => {
    onClose()
    executeCommand('force-release', { files: contextFiles }, { onRefresh })
  }

  return {
    entries: {
      'checkout.forceRelease':
        isAdmin && checkedOutByOthersCount > 0 ? (
          <div
            className="context-menu-item text-plm-error"
            onClick={handleForceRelease}
            title="Admin: Immediately release checkout. User's unsaved changes will be orphaned."
          >
            <Unlock size={14} />
            Force Release {checkedOutByOthersCount > 1 ? `(${checkedOutByOthersCount})` : ''}
          </div>
        ) : null,
    },
  }
}
