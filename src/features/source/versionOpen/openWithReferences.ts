/**
 * "Open with references" from the UI: a progress toast (cancellable) while the version and its
 * closure are staged, then one toast saying what opened and how exact it is.
 */

import { openVersionWithReferences } from '@/lib/versionOpen'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import { describeOpenResult, progressStatus } from './openResultMessage'

export async function openWithReferences(file: {
  name: string
  version: number
  fileVersionId: string
}): Promise<void> {
  const store = usePDMStore.getState()
  const toastId = `version-open-${file.fileVersionId}-${Date.now()}`
  store.addProgressToast(toastId, t('versionOpen.progressTitle', { name: file.name, version: file.version }), 1)
  try {
    const result = await openVersionWithReferences(file.fileVersionId, {
      isCancelled: () => usePDMStore.getState().isProgressToastCancelled(toastId),
      onProgress: (p) => {
        const percent = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0
        const label = p.total > 0 ? `${p.completed}/${p.total}` : undefined
        usePDMStore.getState().updateProgressToast(toastId, p.completed, percent, undefined, label, progressStatus(p.phase))
      },
    })
    const { tone, message } = describeOpenResult(result, file)
    usePDMStore.getState().removeToast(toastId)
    usePDMStore.getState().addToast(tone, message)
  } catch {
    // openVersionWithReferences never throws; this only keeps the progress toast from sticking.
    usePDMStore.getState().removeToast(toastId)
  }
}
