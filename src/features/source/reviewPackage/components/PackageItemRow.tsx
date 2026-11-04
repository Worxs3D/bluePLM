/**
 * One file of the draft: the pinned version, its references (exact or approximate), and only the
 * things worth knowing before sending it: a missing PDF, and what the requester's own copy says.
 * The normal case (PDF ready, exact references) says nothing extra.
 */

import { X } from 'lucide-react'

import { FileKindIcon, IconButton, ListRow, StatusText } from '@/components/core/ui'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import type { ReviewPackageDraftItem } from '@/types/reviewPackageDraft'

import type { PackageItemInfo } from '../hooks/usePackageItemInfo'
import type { LocalCopyWarning } from '../lib/localCopy'

interface PackageItemRowProps {
  item: ReviewPackageDraftItem
  info: PackageItemInfo | undefined
  warnings: LocalCopyWarning[]
  /** Null while the draft is being sent: nothing can be removed then. */
  onRemove: ((fileId: string) => void) | null
}

function References({ info }: { info: PackageItemInfo | undefined }) {
  if (!info) return <span>{t('reviewBuilder.item.loading')}</span>
  if (info.dependenciesFailed || !info.dependencies) return <span>{t('reviewBuilder.item.depsUnknown')}</span>
  const { count, exact, missing } = info.dependencies
  if (count === 0 && missing === 0) return null
  return (
    <>
      {exact ? (
        <span>{count === 1 ? t('reviewBuilder.item.depsOne') : t('reviewBuilder.item.deps', { count })}</span>
      ) : (
        <span className="text-ui-warning" title={t('reviewBuilder.item.approximateHint')}>
          {count === 1
            ? t('reviewBuilder.item.depsApproximateOne')
            : t('reviewBuilder.item.depsApproximate', { count })}
        </span>
      )}
      {missing > 0 && (
        <span className="text-ui-danger">
          {' · '}
          {t('reviewBuilder.item.missing', { count: missing })}
        </span>
      )}
    </>
  )
}

export function PackageItemRow({ item, info, warnings, onRemove }: PackageItemRowProps) {
  const meta = [
    t('reviewBuilder.item.version', { version: item.version }),
    item.revision ? t('reviewBuilder.item.revision', { revision: item.revision }) : null,
    item.state,
  ].filter((part): part is string => !!part)
  const refs = <References info={info} />
  const pdfNote =
    info && (info.pdf === 'missing' || info.pdf === 'unknown') ? (
      <StatusText tone="warning" title={t('reviewBuilder.item.pdfMissingHint')}>
        {info.pdf === 'missing' ? t('reviewBuilder.item.pdfMissing') : t('reviewBuilder.item.pdfUnknown')}
      </StatusText>
    ) : null

  return (
    <ListRow
      leading={<FileKindIcon extension={item.extension} />}
      title={<span title={item.filePath}>{displayFileName(item.fileName)}</span>}
      secondary={
        <span>
          {meta.join(' · ')}
          {info?.dependencies?.count === 0 && info.dependencies.missing === 0 ? null : ' · '}
          {refs}
        </span>
      }
      actions={
        onRemove ? (
          <IconButton
            size="sm"
            label={t('reviewBuilder.item.remove', { name: displayFileName(item.fileName) })}
            icon={<X size={14} />}
            onClick={() => onRemove(item.fileId)}
          />
        ) : undefined
      }
    >
      {pdfNote}
      {warnings.map((w) => (
        <StatusText key={w} tone="warning">
          {t(`reviewBuilder.warning.${w}`, { version: item.version, latest: item.latestVersion })}
        </StatusText>
      ))}
    </ListRow>
  )
}
