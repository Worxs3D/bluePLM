import { useCallback, useMemo } from 'react'

import { checkOperationPermission } from '@/lib/permissions'
import { vaultFoldersOverlap } from '@/lib/vaultTransfer'
import { usePDMStore } from '@/stores/pdmStore'
import type { ConnectedVault, LocalFile } from '@/stores/types'

export type VaultTransferMenuMode = 'copy' | 'move'

export interface VaultTransferMenu {
  /** The other connected vaults a transfer can go to, in the order the vaults were connected. */
  vaults: ConnectedVault[]
  canCopy: boolean
  canMove: boolean
  /** Opens the review dialog for these files, preset to the chosen vault and path option. */
  start: (mode: VaultTransferMenuMode, destVaultId: string, keepPath: boolean) => void
}

/**
 * What the file context menus offer for Copy to Vault / Move to Vault, or `null` when they should
 * show nothing: offline, no other vault to go to, nothing in the selection that can be carried,
 * or no permission for either.
 *
 * The same answer drives both menus (the file browser's and the tree's), so they cannot disagree.
 * The command and the dialog decide the details, such as which files in the selection are left
 * out; this only decides whether the entry is worth showing.
 */
export function useVaultTransferMenu(
  contextFiles: readonly LocalFile[],
  onStarted: () => void,
): VaultTransferMenu | null {
  const connectedVaults = usePDMStore((state) => state.connectedVaults)
  const activeVaultId = usePDMStore((state) => state.activeVaultId)
  const vaultPath = usePDMStore((state) => state.vaultPath)
  const isOfflineMode = usePDMStore((state) => state.isOfflineMode)
  const hasPermission = usePDMStore((state) => state.hasPermission)
  const setPendingVaultTransfer = usePDMStore((state) => state.setPendingVaultTransfer)

  const vaults = useMemo(
    () =>
      connectedVaults.filter(
        (vault) =>
          vault.id !== activeVaultId &&
          !(vaultPath && vaultFoldersOverlap(vaultPath, vault.localPath)),
      ),
    [connectedVaults, activeVaultId, vaultPath],
  )

  const start = useCallback(
    (mode: VaultTransferMenuMode, destVaultId: string, keepPath: boolean) => {
      setPendingVaultTransfer({ files: [...contextFiles], mode, destVaultId, keepPath })
      onStarted()
    },
    [contextFiles, onStarted, setPendingVaultTransfer],
  )

  if (isOfflineMode || !window.electronAPI || vaults.length === 0) return null
  // A stub only names where a file went; if that is all that is selected there is nothing to carry.
  if (!contextFiles.some((file) => file.diffStatus !== 'moved_away')) return null

  const canCopy = checkOperationPermission('copy-to-vault', hasPermission).allowed
  const canMove = canCopy && checkOperationPermission('move-to-vault', hasPermission).allowed
  if (!canCopy) return null

  return { vaults, canCopy, canMove, start }
}
