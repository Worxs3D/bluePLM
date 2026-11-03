/**
 * The release gate's warning (schema 509): a drawing version without an approved review is being
 * released. Releasing anyway bypasses the release process, so it needs a reason, which is stored
 * with the release and shown in version history and the History view.
 */
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import { normalizeReason } from '@/features/source/releases/releaseModel'

export interface ForcedReleaseDialogProps {
  /** One drawing: its name and version. Several: only the count. */
  fileName: string | null
  version: number | null
  count: number
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function ForcedReleaseDialog({ fileName, version, count, onCancel, onConfirm }: ForcedReleaseDialogProps) {
  const [reason, setReason] = useState('')
  const normalized = normalizeReason(reason)

  const message =
    count > 1 || !fileName
      ? t('releases.forceBodyMany', { count })
      : t('releases.forceBody', { name: fileName, version: version ?? '?' })

  return (
    <Dialog open onClose={onCancel} title={t('releases.forceTitle')}>
      <div className="flex gap-3">
        <AlertTriangle size={24} className="text-plm-error flex-shrink-0" />
        <p className="text-sm text-plm-fg-muted">{message}</p>
      </div>
      <label className="block text-xs text-plm-fg-muted mt-4 mb-1" htmlFor="forced-release-reason">
        {t('releases.reasonLabel')}
      </label>
      <textarea
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
        className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm text-plm-fg resize-none focus:outline-none focus:border-plm-accent"
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-plm-fg-muted hover:bg-plm-bg-tertiary rounded"
        >
          {t('releases.cancel')}
        </button>
        <button
          type="button"
          disabled={!normalized}
          onClick={() => normalized && onConfirm(normalized)}
          className="px-4 py-2 text-sm text-white rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('releases.forceConfirm')}
        </button>
      </div>
    </Dialog>
  )
}
