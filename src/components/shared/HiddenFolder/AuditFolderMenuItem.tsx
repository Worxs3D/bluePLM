import { ScanSearch } from 'lucide-react'

import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

interface AuditFolderMenuItemProps {
  folder: LocalFile | undefined
  multiSelect: boolean
  onClose: () => void
}

/**
 * Context menu entry that opens Settings > SOLIDWORKS > Metadata Audit scoped to this folder.
 *
 * Admin-only and desktop-only, like the page it opens: the audit reads files through the local
 * SOLIDWORKS service. It only sets the scope; the admin still presses Run, because a scan takes
 * minutes and should not start from a menu click.
 */
export function AuditFolderMenuItem({ folder, multiSelect, onClose }: AuditFolderMenuItemProps) {
  const { t } = useTranslation()
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  const openVaultAuditForFolder = usePDMStore((s) => s.openVaultAuditForFolder)

  if (!isAdmin || !hasDesktop() || multiSelect || !folder?.isDirectory) return null

  return (
    <div
      className="context-menu-item"
      title={t('contextMenu.auditFolderMetadataHint')}
      onClick={() => {
        openVaultAuditForFolder(folder.relativePath)
        onClose()
      }}
    >
      <ScanSearch size={14} />
      {t('contextMenu.auditFolderMetadata')}
    </div>
  )
}
