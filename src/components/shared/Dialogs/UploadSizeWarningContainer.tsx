/**
 * Container component for Upload Size Warning Dialog
 *
 * Reads from the global store and shows the dialog when there's a pending
 * large file upload waiting for user decision.
 */

import { usePDMStore } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { UploadSizeWarningDialog } from './UploadSizeWarningDialog'
import { useUploadSizeWarning } from '@/hooks/useUploadSizeWarning'

export function UploadSizeWarningContainer() {
  const { pendingLargeUpload } = usePDMStore(
    useShallow((s) => ({
      pendingLargeUpload: s.pendingLargeUpload,
    })),
  )
  const { handleUploadAll, handleSkipLarge, handleCancel, thresholdMB } = useUploadSizeWarning()

  if (!pendingLargeUpload) return null

  return (
    <UploadSizeWarningDialog
      largeFiles={pendingLargeUpload.largeFiles}
      totalFiles={pendingLargeUpload.files.length}
      thresholdMB={thresholdMB}
      onUploadAll={handleUploadAll}
      onSkipLarge={handleSkipLarge}
      onCancel={handleCancel}
    />
  )
}
