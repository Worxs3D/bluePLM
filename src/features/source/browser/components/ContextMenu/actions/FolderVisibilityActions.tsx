/**
 * Admin-only folder entries for the file browser context menu: `fileActions.folderVisibility`
 * and `fileActions.auditFolderMetadata` (auditing the folder's SOLIDWORKS metadata). The
 * conditions are the ones the two menu items check before drawing themselves.
 */
import { AuditFolderMenuItem, FolderVisibilityMenuItem } from '@/components/shared/HiddenFolder'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'

import type { EntryHookResult } from '../customizable/types'
import type { ActionComponentProps } from './types'

export function useFolderVisibilityEntries({
  multiSelect,
  firstFile,
  onClose,
}: ActionComponentProps): EntryHookResult<
  'fileActions.folderVisibility' | 'fileActions.auditFolderMetadata'
> {
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  const oneFolder = isAdmin && !multiSelect && !!firstFile?.isDirectory

  return {
    entries: {
      'fileActions.folderVisibility': oneFolder ? (
        <FolderVisibilityMenuItem folder={firstFile} multiSelect={multiSelect} onClose={onClose} />
      ) : null,
      'fileActions.auditFolderMetadata':
        oneFolder && hasDesktop() ? (
          <AuditFolderMenuItem folder={firstFile} multiSelect={multiSelect} onClose={onClose} />
        ) : null,
    },
  }
}
