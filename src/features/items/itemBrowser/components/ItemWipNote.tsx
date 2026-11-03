/**
 * The secondary text of a released item whose primary file has moved on (schema 509): "WIP v7",
 * with the work-in-progress revision and state in the tooltip.
 */
import { t } from '@/lib/i18n'
import type { ItemRowRelease } from '@/types/item'

export function ItemWipNote({ release, className = '' }: { release: ItemRowRelease | null | undefined; className?: string }) {
  const wip = release?.wip
  if (!release || !wip) return null
  return (
    <span
      className={`text-[10px] text-plm-fg-muted whitespace-nowrap ${className}`}
      title={t('releases.itemWipTitle', {
        version: wip.version,
        revision: wip.revision ?? '-',
        state: wip.stateName ?? '-',
        released: release.version,
      })}
    >
      {t('releases.itemWip', { version: wip.version })}
    </span>
  )
}
