/**
 * The explorer tree's collaboration entries: `collab.requestCheckout`, `collab.notify`,
 * `collab.watch`, `collab.shareLink` and `collab.addToEco`.
 */
import { ArrowDown, Users, Eye, EyeOff, Link, ClipboardList, Loader2 } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import type { DialogName } from '../types'
import type { ToastType } from '@/stores/types'
import type { EntryHookResult } from '@/features/source/browser/components/ContextMenu/customizable/types'

export interface CollaborationEntriesProps {
  firstFile: LocalFile
  multiSelect: boolean
  isFolder: boolean
  anySynced: boolean
  userId: string | undefined
  isWatching: boolean
  isTogglingWatch: boolean
  isCreatingShareLink: boolean
  onToggleWatch: () => void
  onQuickShareLink: () => void
  openDialog: (name: DialogName) => void
  onClose: () => void
  addToast: (type: ToastType, message: string, duration?: number) => void
}

type CollaborationEntryId =
  | 'collab.requestCheckout'
  | 'collab.notify'
  | 'collab.watch'
  | 'collab.shareLink'
  | 'collab.addToEco'

export function useTreeCollaborationEntries({
  firstFile,
  multiSelect,
  isFolder,
  anySynced,
  userId,
  isWatching,
  isTogglingWatch,
  isCreatingShareLink,
  onToggleWatch,
  onQuickShareLink,
  openDialog,
  onClose,
  addToast,
}: CollaborationEntriesProps): EntryHookResult<CollaborationEntryId> {
  const hasPdmData = firstFile.pdmData?.id
  const isCheckedOutByOther =
    firstFile.pdmData?.checked_out_by && firstFile.pdmData.checked_out_by !== userId
  // One synced file (not a folder): Notify, Watch and Add to ECO
  const oneSyncedFile = !multiSelect && !isFolder && anySynced && !!hasPdmData

  return {
    entries: {
      // Request Checkout - for files checked out by others
      'collab.requestCheckout':
        !multiSelect && !isFolder && anySynced && isCheckedOutByOther ? (
          <div className="context-menu-item" onClick={() => openDialog('checkoutRequest')}>
            <ArrowDown size={14} className="text-plm-warning" />
            Request Checkout
          </div>
        ) : null,

      // Notify / Mention - for synced files
      'collab.notify': oneSyncedFile ? (
        <div className="context-menu-item" onClick={() => openDialog('mention')}>
          <Users size={14} className="text-plm-fg-dim" />
          Notify Someone
        </div>
      ) : null,

      // Watch/Unwatch - for synced files
      'collab.watch': oneSyncedFile ? (
        <div
          className={`context-menu-item ${isTogglingWatch ? 'opacity-50' : ''}`}
          onClick={onToggleWatch}
        >
          {isTogglingWatch ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isWatching ? (
            <EyeOff size={14} className="text-plm-fg-muted" />
          ) : (
            <Eye size={14} className="text-plm-accent" />
          )}
          {isWatching ? 'Stop Watching' : 'Watch File'}
        </div>
      ) : null,

      // Copy Share Link - for synced files and folders
      'collab.shareLink':
        !multiSelect && anySynced && (isFolder || hasPdmData) ? (
          <div
            className={`context-menu-item ${isCreatingShareLink ? 'opacity-50' : ''}`}
            onClick={() => {
              if (isFolder) {
                addToast('info', 'Folder sharing coming soon! For now, share individual files.')
                onClose()
              } else if (!isCreatingShareLink) {
                onQuickShareLink()
              }
            }}
          >
            {isCreatingShareLink ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link size={14} className="text-plm-accent" />
            )}
            Copy Share Link
          </div>
        ) : null,

      // Add to ECO - for synced files
      'collab.addToEco': oneSyncedFile ? (
        <div className="context-menu-item" onClick={() => openDialog('addToECO')}>
          <ClipboardList size={14} className="text-plm-fg-dim" />
          Add to ECO
        </div>
      ) : null,
    },
  }
}
