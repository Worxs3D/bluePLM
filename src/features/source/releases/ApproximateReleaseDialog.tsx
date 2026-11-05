/**
 * The warning before releasing assemblies or drawings whose version's references are approximate
 * (gap 12 c): the release would not freeze them. Release anyway, or cancel.
 */
import { ConfirmDialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import type { ApproximateRelease } from '@/lib/versionOpen'

/** Files named in the dialog before the list is cut off. */
const NAMED = 8

export interface ApproximateReleaseDialogProps {
  files: readonly ApproximateRelease[]
  onCancel: () => void
  onConfirm: () => void
}

export function ApproximateReleaseDialog({ files, onCancel, onConfirm }: ApproximateReleaseDialogProps) {
  const one = files.length === 1 ? files[0] : null
  const message = one
    ? t('versionOpen.releaseBodyOne', { name: one.name, version: one.version })
    : t('versionOpen.releaseBodyMany', { count: files.length })
  return (
    <ConfirmDialog
      open
      onClose={onCancel}
      title={t('versionOpen.releaseTitle')}
      message={message}
      confirmText={t('versionOpen.releaseConfirm')}
      cancelText={t('versionOpen.releaseCancel')}
      onConfirm={onConfirm}
      variant="warning"
    >
      {!one && (
        <ul className="mt-3 space-y-0.5 text-[13px] text-ui-fg-secondary">
          {files.slice(0, NAMED).map((f) => (
            <li key={f.fileId} className="truncate tabular-nums" title={f.name}>
              {f.name} · v{f.version}
            </li>
          ))}
          {files.length > NAMED && <li>…</li>}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-ui-fg-secondary">{t('versionOpen.releaseHint')}</p>
    </ConfirmDialog>
  )
}
