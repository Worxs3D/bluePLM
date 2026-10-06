/**
 * Mounts the Copy/Move to Vault dialog once, for the whole app.
 *
 * The context menus that start a transfer unmount the moment they close, and a dialog rendered
 * inside one would go with it. They put the selection and the chosen preset in the store instead
 * (`pendingVaultTransfer`), and this container shows the dialog for it.
 */

import { memo, useCallback } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

import { VaultTransferDialog } from './VaultTransferDialog'

interface VaultTransferContainerProps {
  onRefresh?: (silent?: boolean) => void
}

export const VaultTransferContainer = memo(function VaultTransferContainer({
  onRefresh,
}: VaultTransferContainerProps) {
  const pending = usePDMStore((state) => state.pendingVaultTransfer)
  const setPending = usePDMStore((state) => state.setPendingVaultTransfer)

  const handleClose = useCallback(() => setPending(null), [setPending])

  if (!pending) return null

  // The dialog's backdrop covers the menus, so a second request cannot arrive while one is open.
  return <VaultTransferDialog pending={pending} onClose={handleClose} onRefresh={onRefresh} />
})
