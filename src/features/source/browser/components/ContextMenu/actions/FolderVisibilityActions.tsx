/**
 * Admin-only folder actions for the file browser context menu: visibility, and auditing the
 * folder's SOLIDWORKS metadata.
 */
import { AuditFolderMenuItem, FolderVisibilityMenuItem } from '@/components/shared/HiddenFolder'

import type { ActionComponentProps } from './types'

export function FolderVisibilityActions({ multiSelect, firstFile, onClose }: ActionComponentProps) {
  return (
    <>
      <FolderVisibilityMenuItem folder={firstFile} multiSelect={multiSelect} onClose={onClose} />
      <AuditFolderMenuItem folder={firstFile} multiSelect={multiSelect} onClose={onClose} />
    </>
  )
}
