/**
 * "Add 2 files to <review>?": the confirm before files join an open review. Reviewers are notified
 * at once and review the files at the versions it names, so it lists them. Mounted once (AppShell);
 * `requestAddToOpenReview` opens it through `reviewAddConfirm`.
 */

import { ConfirmDialog } from '@/components/core/Dialog'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import { confirmAddToOpenReview } from '../addToPackage'

export function ReviewAddConfirmDialog() {
  const pending = usePDMStore((s) => s.reviewAddConfirm)
  const setPending = usePDMStore((s) => s.setReviewAddConfirm)
  if (!pending) return null

  const count = pending.versions.length
  return (
    <ConfirmDialog
      open
      onClose={() => setPending(null)}
      title={
        count === 1
          ? t('reviewBuilder.addConfirm.titleOne', { title: pending.title })
          : t('reviewBuilder.addConfirm.title', { count, title: pending.title })
      }
      message={count === 1 ? t('reviewBuilder.addConfirm.bodyOne') : t('reviewBuilder.addConfirm.body')}
      confirmText={t('reviewBuilder.addConfirm.confirm')}
      onConfirm={() => void confirmAddToOpenReview()}
    >
      <ul className="max-h-48 space-y-1 overflow-y-auto text-[14px] text-ui-fg">
        {pending.versions.map((v) => (
          <li key={v.fileVersionId} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{displayFileName(v.fileName)}</span>
            <span className="flex-shrink-0 text-[13px] text-ui-fg-secondary">
              {t('reviewBuilder.item.version', { version: v.version })}
            </span>
          </li>
        ))}
      </ul>
      {pending.skipped > 0 && (
        <p className="mt-2 text-[13px] text-ui-warning">
          {t('reviewBuilder.toast.noVersion', { count: pending.skipped })}
        </p>
      )}
    </ConfirmDialog>
  )
}
