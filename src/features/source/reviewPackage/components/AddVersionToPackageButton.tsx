/**
 * "Add this version to review package" on one row of version history. Pins exactly that
 * `file_versions` row, so an older version can be sent for review on purpose.
 */

import { PackagePlus } from 'lucide-react'

import { t } from '@/lib/i18n'
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
  return (
    <button
      type="button"
      onClick={() => addVersionToReviewPackage(file, version, latestVersion)}
      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-plm-accent/15 text-plm-accent hover:bg-plm-accent/25 transition-colors"
      title={t('reviewBuilder.addVersion', { version: version.version })}
    >
      <PackagePlus size={10} />
      {t('reviewBuilder.addVersionShort')}
    </button>
  )
}
