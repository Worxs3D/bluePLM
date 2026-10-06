import { ArrowRightLeft, Copy } from 'lucide-react'

import { t } from '@/lib/i18n'
import { vaultTransferKey } from '@/lib/vaultTransfer/labels'
import type { LocalFile } from '@/stores/types'

import { ContextMenuGroup } from '../browser/components/ContextMenu/components'

import { useVaultTransferMenu, type VaultTransferMenuMode } from './useVaultTransferMenu'

interface VaultTransferMenuItemsProps {
  contextFiles: LocalFile[]
  onClose: () => void
}

/**
 * "Copy to Vault" and "Move to Vault" for the file context menus.
 *
 * Each opens a submenu with the same two lists of the other connected vaults: "Choose location in"
 * (the destination folder is picked in the dialog) and "Keep folder path in" (the folders the file
 * sits in come along). Choosing a vault does not transfer anything; it opens the dialog that shows
 * what would happen.
 */
export function VaultTransferMenuItems({ contextFiles, onClose }: VaultTransferMenuItemsProps) {
  const menu = useVaultTransferMenu(contextFiles, onClose)
  if (!menu) return null

  const renderVaultList = (mode: VaultTransferMenuMode, keepPath: boolean) =>
    menu.vaults.map((vault) => (
      <div
        key={`${mode}-${keepPath}-${vault.id}`}
        className="context-menu-item"
        onClick={(event) => {
          event.stopPropagation()
          menu.start(mode, vault.id, keepPath)
        }}
      >
        <span className="truncate">{vault.name}</span>
      </div>
    ))

  const renderGroup = (mode: VaultTransferMenuMode) => (
    <ContextMenuGroup
      label={t(vaultTransferKey(mode === 'copy' ? 'copyTo' : 'moveTo'))}
      icon={mode === 'copy' ? Copy : ArrowRightLeft}
      minWidth={200}
    >
      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-plm-fg-muted">
        {t(vaultTransferKey('chooseLocation'))}
      </div>
      {renderVaultList(mode, false)}
      <div className="context-menu-separator" />
      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-plm-fg-muted">
        {t(vaultTransferKey('keepFolderPath'))}
      </div>
      {renderVaultList(mode, true)}
    </ContextMenuGroup>
  )

  return (
    <>
      {renderGroup('copy')}
      {menu.canMove && renderGroup('move')}
    </>
  )
}
