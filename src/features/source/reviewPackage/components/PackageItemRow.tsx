/**
 * One item of the draft: the pinned version, its dependencies (exact or approximate), PDF status
 * and anything the requester's own copy says that they should know before sending it.
 */

import { AlertTriangle, FileCheck2, FileWarning, Layers, Loader2, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { ReviewPackageDraftItem } from '@/types/reviewPackageDraft'

import type { PackageItemInfo } from '../hooks/usePackageItemInfo'
import type { LocalCopyWarning } from '../lib/localCopy'

interface PackageItemRowProps {
  item: ReviewPackageDraftItem
  info: PackageItemInfo | undefined
  warnings: LocalCopyWarning[]
  onRemove: (fileId: string) => void
}

function DependencyBadge({ info }: { info: PackageItemInfo | undefined }) {
  if (!info) return <Loader2 size={10} className="animate-spin text-plm-fg-muted" />
  if (info.dependenciesFailed || !info.dependencies) {
    return <span className="text-plm-fg-muted">{t('reviewBuilder.item.depsUnknown')}</span>
  }
  const { count, exact, missing } = info.dependencies
  return (
    <span className="flex items-center gap-1">
      <Layers size={10} />
      {t('reviewBuilder.item.deps', { count })}
      <span
        className={`px-1 rounded ${exact ? 'bg-plm-success/15 text-plm-success' : 'bg-plm-warning/15 text-plm-warning'}`}
        title={exact ? t('reviewBuilder.item.exactHint') : t('reviewBuilder.item.approximateHint')}
      >
        {exact ? t('reviewBuilder.item.exact') : t('reviewBuilder.item.approximate')}
      </span>
      {missing > 0 && (
        <span className="text-plm-error">{t('reviewBuilder.item.missing', { count: missing })}</span>
      )}
    </span>
  )
}

function PdfBadge({ info }: { info: PackageItemInfo | undefined }) {
  if (!info || info.pdf === 'not_needed') return null
  if (info.pdf === 'ready') {
    return (
      <span className="flex items-center gap-1 text-plm-success">
        <FileCheck2 size={10} />
        {t('reviewBuilder.item.pdfReady')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-plm-warning" title={t('reviewBuilder.item.pdfMissingHint')}>
      <FileWarning size={10} />
      {info.pdf === 'missing' ? t('reviewBuilder.item.pdfMissing') : t('reviewBuilder.item.pdfUnknown')}
    </span>
  )
}

export function PackageItemRow({ item, info, warnings, onRemove }: PackageItemRowProps) {
  return (
    <div className="px-2 py-1.5 rounded border border-plm-border bg-plm-bg-light">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-plm-fg truncate" title={item.filePath}>
          {item.fileName}
        </span>
        <button
          type="button"
          onClick={() => onRemove(item.fileId)}
          className="ml-auto p-0.5 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight"
          title={t('reviewBuilder.item.remove')}
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-plm-fg-muted">
        <span>{t('reviewBuilder.item.version', { version: item.version })}</span>
        {item.revision && <span>{t('reviewBuilder.item.revision', { revision: item.revision })}</span>}
        {item.state && <span>{item.state}</span>}
        <DependencyBadge info={info} />
        <PdfBadge info={info} />
      </div>
      {warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1 text-[10px] text-plm-warning">
              <AlertTriangle size={10} className="mt-px flex-shrink-0" />
              {t(`reviewBuilder.warning.${w}`, { version: item.version, latest: item.latestVersion })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
