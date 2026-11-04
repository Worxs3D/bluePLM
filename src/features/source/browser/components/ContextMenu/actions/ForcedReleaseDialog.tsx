/**
 * The release gate's warning (schema 509): a drawing version without an approved review is being
 * released. Releasing anyway bypasses the release process, so it needs a reason, which is stored
 * with the release and shown in version history and the History view. The other way out is to
 * request a review of the drawing instead (`onRequestReview`).
 */
import { useState } from 'react'

import { Dialog } from '@/components/core/Dialog'
import { Button, TextArea } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { normalizeReason } from '@/features/source/releases/releaseModel'

export interface ForcedReleaseDialogProps {
  /** One drawing: its name and version. Several: only the count. */
  fileName: string | null
  version: number | null
  count: number
  onCancel: () => void
  onConfirm: (reason: string) => void
  /** Offer "Request a review instead"; called after the dialog closes. */
  onRequestReview?: () => void
}

export function ForcedReleaseDialog({
  fileName,
  version,
  count,
  onCancel,
  onConfirm,
  onRequestReview,
}: ForcedReleaseDialogProps) {
  const [reason, setReason] = useState('')
  const normalized = normalizeReason(reason)

  const message =
    count > 1 || !fileName
      ? t('releases.forceBodyMany', { count })
      : t('releases.forceBody', { name: fileName, version: version ?? '?' })

  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('releases.forceTitle')}
      footer={
        <>
          {onRequestReview && (
            <Button variant="secondary" className="mr-auto" onClick={onRequestReview}>
              {t('reviewBuilder.forced.requestReview')}
            </Button>
          )}
          <Button variant="secondary" onClick={onCancel}>
            {t('releases.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!normalized}
            onClick={() => normalized && onConfirm(normalized)}
          >
            {t('releases.forceConfirm')}
          </Button>
        </>
      }
    >
      <p className="text-ui-fg-secondary">{message}</p>
      <label className="mb-1 mt-4 block text-[13px] text-ui-fg-secondary" htmlFor="forced-release-reason">
        {t('releases.reasonLabel')}
      </label>
      <TextArea
        id="forced-release-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder={t('releases.reasonPlaceholder')}
        className="resize-none"
        rows={3}
        autoFocus
      />
    </Dialog>
  )
}
