import { ArrowRightLeft, Copy } from 'lucide-react'
import type { ReactNode } from 'react'

import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { vaultTransferKey } from '@/lib/vaultTransfer/labels'
import type { LocalFile } from '@/stores/types'

import { ContextMenuGroup } from '../browser/components/ContextMenu/components'
import type { EntryHookResult } from '../browser/components/ContextMenu/customizable/types'

import {
  useVaultTransferMenu,
  type VaultTransferMenu,
  type VaultTransferMenuMode,
} from './useVaultTransferMenu'

interface VaultTransferMenuItemsProps {
  contextFiles: LocalFile[]
  onClose: () => void
}

function renderVaultList(menu: VaultTransferMenu, mode: VaultTransferMenuMode, keepPath: boolean) {
  return menu.vaults.map((vault) => (
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
}

function renderGroup(menu: VaultTransferMenu, mode: VaultTransferMenuMode): ReactNode {
  return (
    <ContextMenuGroup
      flyoutKey={mode === 'copy' ? 'vaultTransfer.copyTo' : 'vaultTransfer.moveTo'}
      label={t(vaultTransferKey(mode === 'copy' ? 'copyTo' : 'moveTo'))}
      icon={mode === 'copy' ? Copy : ArrowRightLeft}
      minWidth={200}
    >
      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-plm-fg-muted">
        {t(vaultTransferKey('chooseLocation'))}
      </div>
      {renderVaultList(menu, mode, false)}
      <div className="context-menu-separator" />
      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-plm-fg-muted">
        {t(vaultTransferKey('keepFolderPath'))}
      </div>
      {renderVaultList(menu, mode, true)}
    </ContextMenuGroup>
  )
}

/**
 * "Copy to Vault" and "Move to Vault" for the file context menus: the `vaultTransfer.copyTo` and
 * `vaultTransfer.moveTo` entries. Both move files on disk, so desktop only.
 *
 * Each opens a submenu with the same two lists of the other connected vaults: "Choose location in"
 * (the destination folder is picked in the dialog) and "Keep folder path in" (the folders the file
 * sits in come along). Choosing a vault does not transfer anything; it opens the dialog that shows
 * what would happen.
 */
export function useVaultTransferEntries(
  contextFiles: LocalFile[],
  onClose: () => void,
): EntryHookResult<'vaultTransfer.copyTo' | 'vaultTransfer.moveTo'> {
  const menu = useVaultTransferMenu(contextFiles, onClose)
  const shown = hasDesktop() ? menu : null
  return {
    entries: {
      'vaultTransfer.copyTo': shown ? renderGroup(shown, 'copy') : null,
      'vaultTransfer.moveTo': shown?.canMove ? renderGroup(shown, 'move') : null,
    },
  }
}

/** Both entries in their default order, for a menu not yet drawn from a layout. */
export function VaultTransferMenuItems({ contextFiles, onClose }: VaultTransferMenuItemsProps) {
  const { entries } = useVaultTransferEntries(contextFiles, onClose)
  return (
    <>
      {entries['vaultTransfer.copyTo']}
      {entries['vaultTransfer.moveTo']}
    </>
  )
}
