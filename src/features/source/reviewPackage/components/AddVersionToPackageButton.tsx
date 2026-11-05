/**
 * "Add to draft" on one row of version history. Pins exactly that `file_versions` row, so an
 * older version can be sent for review on purpose. When the draft already holds the file at
 * another version the button says "Use in draft" and swaps it.
 */

import { Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import { selectReviewPackageDraft } from '@/stores/slices/reviewsSlice'
import type { LocalFile } from '@/stores/types'

import { addVersionToReviewPackage, type VersionRowForPackage } from '../addToPackage'

interface AddVersionToPackageButtonProps {
  file: LocalFile
  version: VersionRowForPackage
  latestVersion: number
}

export function AddVersionToPackageButton({
  file,
  version,
  latestVersion,
}: AddVersionToPackageButtonProps) {
  const fileId = file.pdmData?.id
  const inDraft = usePDMStore((s) =>
    fileId ? (selectReviewPackageDraft(s).items.find((i) => i.fileId === fileId)?.version ?? null) : null,
  )
  if (inDraft === version.version) {
    return <span className="px-2 text-[12px] text-ui-fg-secondary">{t('reviewBuilder.inDraft')}</span>
  }
  const swap = inDraft !== null
  return (
    <Button
      size="sm"
      variant="ghost"
      className="!h-6 !px-2 !text-[12px]"
      onClick={() => addVersionToReviewPackage(file, version, latestVersion)}
      title={
        swap
          ? t('reviewBuilder.useVersion', { version: version.version, current: inDraft })
          : t('reviewBuilder.addVersion', { version: version.version })
      }
    >
      {swap ? t('reviewBuilder.useVersionShort') : t('reviewBuilder.addVersionShort')}
    </Button>
  )
}
