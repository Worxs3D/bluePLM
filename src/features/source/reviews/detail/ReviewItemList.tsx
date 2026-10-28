/**
 * The review's items, in order, with each one's outcome, pinned version and whether I still owe
 * a decision on it.
 */

import { CircleDot } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { ReviewItemDetail, ReviewItemOutcome } from '@/types/reviews'

const OUTCOME_CLASS: Record<ReviewItemOutcome, string> = {
  pending: 'text-plm-info',
  approved: 'text-plm-success',
  changes_requested: 'text-plm-warning',
  rejected: 'text-plm-error',
}

interface ReviewItemListProps {
  items: ReviewItemDetail[]
  activeItemId: string | null
  owedItemIds: ReadonlySet<string>
  onSelect: (itemId: string) => void
}

export function ReviewItemList({ items, activeItemId, owedItemIds, onSelect }: ReviewItemListProps) {
  return (
    <ul className="divide-y divide-plm-border/50">
      {items.map((item) => {
        const active = item.id === activeItemId
        const newer =
          item.file.latestVersion != null && item.file.latestVersion > item.version.version
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className={`w-full text-left px-2 py-1.5 ${active ? 'bg-plm-accent/10' : 'hover:bg-plm-bg-light'}`}
            >
              <div className="flex items-center gap-1.5">
                <CircleDot size={10} className={OUTCOME_CLASS[item.outcome]} />
                <span className="text-xs text-plm-fg truncate" title={item.file.filePath}>
                  {item.file.fileName}
                </span>
                {owedItemIds.has(item.id) && (
                  <span className="ml-auto text-[9px] px-1 rounded bg-plm-accent/20 text-plm-accent">
                    {t('reviewDetail.items.owed')}
                  </span>
                )}
              </div>
              <div className="ml-4 text-[10px] text-plm-fg-muted flex flex-wrap gap-x-1.5">
                <span>v{item.version.version}</span>
                {item.version.revision && (
                  <span>{t('reviewQueue.rev', { revision: item.version.revision })}</span>
                )}
                <span className={OUTCOME_CLASS[item.outcome]}>
                  {t(`reviewDetail.itemOutcome.${item.outcome}`)}
                </span>
                {newer && (
                  <span className="text-plm-warning">
                    {t('reviewDetail.items.newerExists', { version: item.file.latestVersion ?? 0 })}
                  </span>
                )}
                {item.file.deleted && <span className="text-plm-error">{t('reviewDetail.items.deleted')}</span>}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
