/**
 * From "what to fix" to fixing it (review UX audit F5): show a review file in the vault, and
 * check it out, from the review detail and the resubmit dialog. Both act on this machine's copy
 * of the file; a file in no connected vault says so instead of doing nothing.
 */

import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { revealFileById } from '@/lib/navigation/revealFile'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

function localFileFor(fileId: string): LocalFile | null {
  return (
    usePDMStore
      .getState()
      .files.find((f) => f.pdmData?.id === fileId && f.diffStatus !== 'moved_away') ?? null
  )
}

/**
 * Check out is offered on a file this machine has on disk (not a cloud-only row, which has
 * nothing to check out into) that nobody holds, and only in the desktop app: the web has no
 * check out at all.
 */
export function canCheckOut(file: LocalFile | null, desktop: boolean): boolean {
  return (
    desktop &&
    !!file &&
    file.diffStatus !== 'cloud' &&
    !!file.pdmData &&
    !file.pdmData.checked_out_by
  )
}

/** Whether Check out is offered for a review file here. */
export function canCheckOutHere(fileId: string): boolean {
  return canCheckOut(localFileFor(fileId), hasDesktop())
}

export function showFileInVault(fileId: string): void {
  if (!revealFileById(fileId))
    usePDMStore.getState().addToast('warning', t('reviewDetail.items.notInVault'))
}

export async function checkOutFile(fileId: string): Promise<void> {
  const file = localFileFor(fileId)
  if (!file) {
    usePDMStore.getState().addToast('warning', t('reviewDetail.items.notInVault'))
    return
  }
  await executeCommand('checkout', { files: [file] })
}
